import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AdminCaseDetail, AdminEvidence } from '@lostly/contracts/admin-operations';
import { AdminApi, errorMessage } from './api';
import { Action } from './action';

@Component({
  imports: [FormsModule, RouterLink, DatePipe, Action],
  template: `
    <div class="page-heading">
      <h1>Case details</h1>
      <button (click)="load()" [disabled]="busy()">Refresh</button>
    </div>
    <p>
      <a routerLink="/cases">Case queue</a> ·
      <a routerLink="/audit" [queryParams]="{ caseId: id }">Case audit</a>
    </p>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (busy()) {
      <p role="status">Loading case…</p>
    }
    @if (detail(); as data) {
      <section class="panel">
        <h2>{{ data.case.kind }} · {{ data.case.category }}</h2>
        <p>{{ data.case.description }}</p>
        <p>
          {{ data.case.status }} · {{ data.case.createdAt | date: 'medium' }} · version
          {{ data.case.version }}
        </p>
        <p>Target: {{ data.case.targetType }} · {{ data.case.targetId }}</p>
        <p>Assignee: {{ data.case.assigneeId || 'Unassigned' }}</p>
        @if (data.case.reporterId) {
          <p>
            Submitted by
            <a [routerLink]="['/users', data.case.reporterId]">{{ data.case.reporterId }}</a>
          </p>
        }
        @if (targetRoute(data.case.targetType); as resource) {
          <a [routerLink]="['/', resource, data.case.targetId]" [queryParams]="{ caseId: id }"
            >Open target</a
          >
        }
        @if (data.related.listingId) {
          <p>
            <a [routerLink]="['/listings', data.related.listingId]" [queryParams]="{ caseId: id }"
              >Related listing</a
            >
          </p>
        }
        @if (data.related.userId) {
          <p>
            <a [routerLink]="['/users', data.related.userId]" [queryParams]="{ caseId: id }"
              >Affected user</a
            >
          </p>
        }
        @if (data.case.parentEventId) {
          <p>Appealed decision: {{ data.case.parentEventId }}</p>
          <a routerLink="/audit" [queryParams]="{ targetId: data.case.targetId }"
            >Target decisions</a
          >
        }
        @if (data.case.publicResolution) {
          <p>Public resolution: {{ data.case.publicResolution }}</p>
        }
      </section>
      <section class="panel">
        <h2>Private evidence</h2>
        <p>
          Only evidence captured for this case is available. Each reveal requires a reason and is
          audited.
        </p>
        <form (ngSubmit)="reveal()">
          <label
            >Access reason<textarea
              name="evidenceReason"
              required
              minlength="3"
              maxlength="500"
              [(ngModel)]="evidenceReason"
              [disabled]="working()"
            ></textarea></label
          ><button [disabled]="working() || evidenceReason.trim().length < 3">
            Reveal case evidence
          </button>
        </form>
        @if (evidence(); as captured) {
          <pre>{{ captured.text || 'No text evidence captured.' }}</pre>
          @for (image of captured.images; track image.id) {
            <img [src]="image.url" alt="Captured case evidence" width="280" loading="lazy" />
            <p>Access expires {{ image.expiresAt | date: 'medium' }}</p>
          }
          <button class="secondary" (click)="evidence.set(null)">Conceal evidence</button>
        }
      </section>
      @if (data.case.status === 'open' || data.case.status === 'in_review') {
        <section class="panel">
          <h2>Assignment</h2>
          <label
            >Administrator<select [(ngModel)]="assignee">
              <option value="">Unassigned</option>
              @for (admin of administrators(); track admin.id) {
                <option [value]="admin.id">{{ admin.displayName }}</option>
              }
            </select></label
          >
          <app-action
            [endpoint]="'/admin/cases/' + id + '/assign'"
            label="Update assignment"
            [publicMessage]="false"
            [payload]="{ expectedVersion: data.case.version, assigneeId: assignee || null }"
            (changed)="load()"
          />
        </section>
        @if (!data.case.assigneeId || data.case.assigneeId === api.user()?.id) {
          @if (data.case.kind === 'appeal' && data.reversibleListing; as listing) {
            <app-action
              [endpoint]="'/admin/cases/' + id + '/reverse-decision'"
              label="Reverse archive or rejection"
              description="Reopens only claims closed by the appealed decision. A later change or ownership approval prevents reversal."
              [payload]="{ expectedVersion: listing.version }"
              (changed)="load()"
            />
          }
          @if (data.case.targetType === 'message') {
            <app-action
              [endpoint]="'/admin/messages/' + data.case.targetId + '/visibility'"
              label="Hide reported message"
              [payload]="{ caseId: id, hidden: true }"
              (changed)="load()"
            />
            <app-action
              [endpoint]="'/admin/messages/' + data.case.targetId + '/visibility'"
              label="Restore reported message"
              [payload]="{ caseId: id, hidden: false }"
              (changed)="load()"
            />
          }
          @if (data.related.conversationId) {
            <app-action
              [endpoint]="'/admin/cases/' + id + '/conversation'"
              label="Pause conversation"
              [payload]="{ closed: true }"
              (changed)="load()"
            />
            <app-action
              [endpoint]="'/admin/cases/' + id + '/conversation'"
              label="Resume conversation"
              [payload]="{ closed: false }"
              (changed)="load()"
            />
          }
          <section class="panel">
            <h2>Internal notes</h2>
            <form (ngSubmit)="note()">
              <label
                >Private note<textarea
                  name="note"
                  [(ngModel)]="noteBody"
                  minlength="3"
                  maxlength="2000"
                  required
                  [disabled]="working()"
                ></textarea></label
              ><button [disabled]="working() || noteBody.trim().length < 3">Add note</button>
            </form>
          </section>
          <section class="panel">
            <h2>Decision</h2>
            <p>
              Apply any corrective action above or in the linked record before resolving the case.
            </p>
            <form (ngSubmit)="decide()">
              <label
                >Outcome<select name="outcome" [(ngModel)]="outcome">
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select></label
              >
              <label
                >Public resolution<textarea
                  name="resolution"
                  [(ngModel)]="resolution"
                  required
                  minlength="3"
                  maxlength="1000"
                  [disabled]="working()"
                ></textarea>
              </label>
              <label
                >Internal reason<textarea
                  name="reason"
                  [(ngModel)]="reason"
                  required
                  minlength="3"
                  maxlength="500"
                  [disabled]="working()"
                ></textarea>
              </label>
              <button
                [disabled]="working() || resolution.trim().length < 3 || reason.trim().length < 3"
              >
                Save decision & notify reporter
              </button>
            </form>
          </section>
        } @else {
          <p>Assigned to another administrator. Reassign this case before taking action.</p>
        }
      }
      <section class="panel">
        <h2>Note history</h2>
        @for (note of data.notes.items; track note.id) {
          <article>
            <p>{{ note.body }}</p>
            <small>{{ note.actorUserId }} · {{ note.createdAt | date: 'medium' }}</small>
          </article>
        } @empty {
          <p>No internal notes.</p>
        }
        @if (data.notes.pageInfo.hasNextPage) {
          <button (click)="olderNotes()" [disabled]="working()">Older notes</button>
        }
      </section>
    }
  `,
})
export class CaseDetail {
  readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  id = this.route.snapshot.paramMap.get('id')!;
  readonly detail = signal<AdminCaseDetail | null>(null);
  readonly evidence = signal<AdminEvidence | null>(null);
  readonly administrators = signal<{ id: string; displayName: string }[]>([]);
  readonly busy = signal(false);
  readonly working = signal(false);
  readonly error = signal('');
  assignee = '';
  evidenceReason = '';
  noteBody = '';
  resolution = '';
  reason = '';
  outcome = 'resolved';
  private generation = 0;
  constructor() {
    this.destroy.onDestroy(() => this.generation++);
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.id = params.get('id')!;
      this.detail.set(null);
      this.evidence.set(null);
      this.reason = '';
      this.resolution = '';
      this.evidenceReason = '';
      this.noteBody = '';
      void this.load();
    });
  }
  targetRoute(type: string) {
    return (
      { listing: 'listings', user: 'users', avatar: 'users', claim: 'claims' } as Record<
        string,
        string
      >
    )[type];
  }
  async load() {
    const generation = ++this.generation;
    this.busy.set(true);
    this.error.set('');
    this.evidence.set(null);
    try {
      const [data, administrators] = await Promise.all([
        this.api.request<AdminCaseDetail>('/admin/cases/' + this.id),
        this.api.request<{ id: string; displayName: string }[]>('/admin/administrators'),
      ]);
      if (generation !== this.generation) return;
      this.detail.set(data);
      this.assignee = data.case.assigneeId ?? '';
      this.administrators.set(administrators);
    } catch (error) {
      if (generation === this.generation) {
        this.detail.set(null);
        this.error.set(errorMessage(error));
      }
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  private async perform(task: () => Promise<void>) {
    const id = this.id;
    if (this.working()) return;
    this.working.set(true);
    this.error.set('');
    try {
      await task();
    } catch (error) {
      if (!this.destroy.destroyed && this.id === id) this.error.set(errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }
  reveal() {
    const id = this.id;
    return this.perform(async () => {
      const evidence = await this.api.request<AdminEvidence>(
        '/admin/cases/' + this.id + '/evidence',
        { reason: this.evidenceReason.trim() },
      );
      if (!this.destroy.destroyed && this.id === id) {
        this.evidence.set(evidence);
        this.evidenceReason = '';
      }
    });
  }
  note() {
    return this.perform(async () => {
      await this.api.request('/admin/cases/' + this.id + '/notes', { body: this.noteBody.trim() });
      this.noteBody = '';
      if (!this.destroy.destroyed) await this.load();
    });
  }
  decide() {
    return this.perform(async () => {
      await this.api.request('/admin/cases/' + this.id + '/decision', {
        expectedVersion: this.detail()!.case.version,
        status: this.outcome,
        publicResolution: this.resolution.trim(),
        reason: this.reason.trim(),
      });
      this.reason = '';
      this.resolution = '';
      if (!this.destroy.destroyed) await this.load();
    });
  }
  olderNotes() {
    const id = this.id;
    return this.perform(async () => {
      const before = this.detail()!;
      const data = await this.api.request<AdminCaseDetail>(
        '/admin/cases/' +
          this.id +
          '?cursor=' +
          encodeURIComponent(before.notes.pageInfo.endCursor!),
      );
      if (!this.destroy.destroyed && this.id === id)
        this.detail.set({
          ...before,
          notes: { ...data.notes, items: [...before.notes.items, ...data.notes.items] },
        });
    });
  }
}
