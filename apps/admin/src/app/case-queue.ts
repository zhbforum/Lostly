import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ModerationCase, ModerationPage } from '@lostly/contracts/moderation';
import { AdminApi, errorMessage } from './api';

@Component({
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="page-heading">
      <h1>Reports & appeals</h1>
      <button (click)="load()" [disabled]="busy()">Refresh</button>
    </div>
    <form class="filters" (ngSubmit)="filter()">
      <label
        >Status<select name="status" [(ngModel)]="status">
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="in_review">In review</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select></label
      >
      <label
        >Type<select name="kind" [(ngModel)]="kind">
          <option value="">All</option>
          <option value="report">Report</option>
          <option value="appeal">Appeal</option>
        </select></label
      >
      <label>Assignee UUID<input name="assigneeId" [(ngModel)]="assigneeId" /></label>
      <label>Target UUID<input name="targetId" [(ngModel)]="targetId" /></label>
      <label
        ><input type="checkbox" name="unassigned" [(ngModel)]="unassigned" /> Unassigned only</label
      >
      <label
        ><input type="checkbox" name="overdue" [(ngModel)]="overdue" /> Older than 48h and
        unresolved</label
      >
      <button>Apply</button
      ><button type="button" class="secondary" (click)="mine()">Assigned to me</button
      ><a routerLink="/cases">Reset</a>
      <label><input type="checkbox" name="active" [(ngModel)]="active" /> Unresolved only</label>
    </form>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (busy()) {
      <p role="status">Loading cases…</p>
    }
    @for (record of page()?.items; track record.id) {
      <article class="panel">
        <h2>
          <a [routerLink]="['/cases', record.id]">{{ record.kind }} · {{ record.category }}</a>
        </h2>
        <p>
          {{ record.status }} · {{ record.createdAt | date: 'medium' }} ·
          {{ record.assigneeId ? 'Assigned to ' + record.assigneeId : 'Unassigned' }}
        </p>
        <p>{{ record.description }}</p>
        <small>{{ record.targetType }} · {{ record.targetId }}</small>
      </article>
    } @empty {
      @if (!busy() && !error()) {
        <p>No cases match these filters.</p>
      }
    }
    <div class="pagination">
      <button (click)="first()" [disabled]="busy() || !hasCursor()">First page</button
      ><button (click)="next()" [disabled]="busy() || !page()?.pageInfo?.hasNextPage">Next</button>
    </div>
  `,
})
export class CaseQueue {
  readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  readonly page = signal<ModerationPage<ModerationCase> | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  status = '';
  kind = '';
  assigneeId = '';
  targetId = '';
  unassigned = false;
  overdue = false;
  active = false;
  private generation = 0;
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.status = params.get('status') ?? '';
      this.kind = params.get('kind') ?? '';
      this.assigneeId = params.get('assigneeId') ?? '';
      this.targetId = params.get('targetId') ?? '';
      this.unassigned = params.get('unassigned') === 'true';
      this.overdue = params.get('overdue') === 'true';
      this.active = params.get('active') === 'true';
      void this.load();
    });
    this.destroy.onDestroy(() => this.generation++);
  }
  hasCursor() {
    return this.route.snapshot.queryParamMap.has('cursor');
  }
  async load() {
    const generation = ++this.generation;
    this.busy.set(true);
    this.error.set('');
    const query = new URLSearchParams();
    for (const key of [
      'status',
      'kind',
      'assigneeId',
      'reporterId',
      'targetId',
      'unassigned',
      'overdue',
      'active',
      'cursor',
    ]) {
      const value = this.route.snapshot.queryParamMap.get(key);
      if (value) query.set(key, value);
    }
    try {
      const result = await this.api.request<ModerationPage<ModerationCase>>(
        '/admin/cases?' + query,
      );
      if (generation === this.generation) this.page.set(result);
    } catch (error) {
      if (generation === this.generation) {
        this.page.set(null);
        this.error.set(errorMessage(error));
      }
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  filter() {
    return this.router.navigate(['/cases'], {
      queryParams: {
        status: this.status || null,
        kind: this.kind || null,
        assigneeId: this.unassigned ? null : this.assigneeId || null,
        targetId: this.targetId || null,
        unassigned: this.unassigned || null,
        overdue: this.overdue || null,
        active: this.active || null,
      },
    });
  }
  mine() {
    this.assigneeId = this.api.user()?.id ?? '';
    this.unassigned = false;
    this.status = '';
    this.active = true;
    return this.filter();
  }
  first() {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      queryParams: { cursor: null },
    });
  }
  next() {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      queryParams: { cursor: this.page()?.pageInfo.endCursor },
    });
  }
}
