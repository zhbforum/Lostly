import { DatePipe, JsonPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AdminAuditEvent } from '@lostly/contracts/admin-operations';
import type { ModerationPage } from '@lostly/contracts/moderation';
import { MODERATION_ACTION_LABELS } from '@lostly/contracts/moderation';
import { AdminApi, errorMessage } from './api';

@Component({
  imports: [FormsModule, RouterLink, DatePipe, JsonPipe],
  template: `
    <div class="page-heading">
      <h1>Audit trail</h1>
      <button (click)="load()" [disabled]="busy()">Refresh</button>
    </div>
    <form class="filters" (ngSubmit)="filter()">
      <label>Actor UUID<input name="actor" [(ngModel)]="actorId" /></label
      ><label>Target UUID<input name="target" [(ngModel)]="targetId" /></label
      ><label>Case UUID<input name="case" [(ngModel)]="caseId" /></label>
      <label
        >Action<select name="action" [(ngModel)]="action">
          <option value="">All</option>
          @for (option of actions; track option[0]) {
            <option [value]="option[0]">{{ option[1] }}</option>
          }
        </select></label
      >
      <label>From (UTC)<input type="date" name="from" [(ngModel)]="from" /></label
      ><label>Through (UTC)<input type="date" name="to" [(ngModel)]="to" /></label>
      <button>Apply</button><a routerLink="/audit">Reset</a>
    </form>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (busy()) {
      <p role="status">Loading audit…</p>
    }
    @for (event of page()?.items; track event.id) {
      <article class="panel">
        <h2>{{ labels[event.action] }}</h2>
        <p>{{ event.actorName || event.actorUserId }} · {{ event.createdAt | date: 'medium' }}</p>
        <p>{{ event.reason }}</p>
        <p>{{ event.targetType }} · {{ event.targetId }}</p>
        @if (event.caseId || event.targetType === 'case') {
          <a [routerLink]="['/cases', event.caseId || event.targetId]">Open case</a>
        }
        @if (resource(event.targetType); as resource) {
          <a [routerLink]="['/', resource, event.targetId]">Open record</a>
        }
        @if (event.parentEventId) {
          <p>Parent event {{ event.parentEventId }}</p>
        }
        <details>
          <summary>Transition details</summary>
          <pre>{{ event.metadata | json }}</pre>
          <small>Event {{ event.id }}</small>
        </details>
      </article>
    } @empty {
      @if (!busy() && !error()) {
        <p>No matching events.</p>
      }
    }
    <div class="pagination">
      <button (click)="navigate(null)" [disabled]="busy() || !hasCursor()">First page</button
      ><button
        (click)="navigate(page()?.pageInfo?.endCursor ?? null)"
        [disabled]="busy() || !page()?.pageInfo?.hasNextPage"
      >
        Next
      </button>
    </div>
  `,
})
export class Audit {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  readonly labels = MODERATION_ACTION_LABELS;
  readonly actions = Object.entries(MODERATION_ACTION_LABELS);
  readonly page = signal<ModerationPage<AdminAuditEvent> | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  actorId = '';
  targetId = '';
  caseId = '';
  action = '';
  from = '';
  to = '';
  private generation = 0;
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.actorId = params.get('actorId') ?? '';
      this.targetId = params.get('targetId') ?? '';
      this.caseId = params.get('caseId') ?? '';
      this.action = params.get('action') ?? '';
      this.from = params.get('from')?.slice(0, 10) ?? '';
      this.to = params.get('to')?.slice(0, 10) ?? '';
      void this.load();
    });
    this.destroy.onDestroy(() => this.generation++);
  }
  resource(type: string) {
    return ({ user: 'users', listing: 'listings', claim: 'claims' } as Record<string, string>)[
      type
    ];
  }
  hasCursor() {
    return this.route.snapshot.queryParamMap.has('cursor');
  }
  filter() {
    return this.router.navigate(['/audit'], {
      queryParams: {
        actorId: this.actorId || null,
        targetId: this.targetId || null,
        caseId: this.caseId || null,
        action: this.action || null,
        from: this.from ? this.from + 'T00:00:00.000Z' : null,
        to: this.to ? this.to + 'T23:59:59.999Z' : null,
      },
    });
  }
  navigate(cursor: string | null) {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      queryParams: { cursor },
    });
  }
  async load() {
    const generation = ++this.generation;
    this.busy.set(true);
    this.error.set('');
    const query = new URLSearchParams();
    for (const key of ['actorId', 'targetId', 'caseId', 'action', 'cursor', 'from', 'to']) {
      const value = this.route.snapshot.queryParamMap.get(key);
      if (value) query.set(key, value);
    }
    try {
      const page = await this.api.request<ModerationPage<AdminAuditEvent>>('/admin/audit?' + query);
      if (generation === this.generation) this.page.set(page);
    } catch (error) {
      if (generation === this.generation) {
        this.page.set(null);
        this.error.set(errorMessage(error));
      }
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
}
