import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AdminOverview } from '@lostly/contracts/admin';
import type { AdminWorkload } from '@lostly/contracts/admin-operations';
import { AdminApi, errorMessage } from './api';

@Component({
  imports: [RouterLink],
  template: `
    <div class="page-heading">
      <div>
        <p class="eyebrow">Overview</p>
        <h1>Moderation dashboard</h1>
      </div>
      <button class="secondary" (click)="load()" [disabled]="busy()">Refresh</button>
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (busy()) {
      <p role="status">Loading overview…</p>
    }
    @if (overview(); as data) {
      <div class="metrics">
        <a class="panel metric" routerLink="/listings"
          ><span>All listings</span><strong>{{ data.listings }}</strong></a
        >
        <a
          class="panel metric"
          routerLink="/listings"
          [queryParams]="{ status: 'active', visibility: 'visible' }"
          ><span>Active listings</span><strong>{{ data.activeListings }}</strong></a
        >
        <a class="panel metric" routerLink="/claims" [queryParams]="{ status: 'pending' }"
          ><span>Pending claims</span><strong>{{ data.pendingClaims }}</strong></a
        >
        <a class="panel metric" routerLink="/users"
          ><span>Users</span><strong>{{ data.users }}</strong></a
        >
      </div>
    }
    @if (workload(); as queue) {
      <section class="panel">
        <h2>Moderation workload</h2>
        <div class="metrics">
          <a routerLink="/cases" [queryParams]="{ status: 'open' }">Open: {{ queue.open }}</a>
          <a routerLink="/cases" [queryParams]="{ status: 'in_review' }"
            >In review: {{ queue.inReview }}</a
          >
          <a routerLink="/cases" [queryParams]="{ assigneeId: api.user()?.id }"
            >Assigned to me: {{ queue.mine }}</a
          >
          <a routerLink="/cases" [queryParams]="{ unassigned: true }"
            >Unassigned: {{ queue.unassigned }}</a
          >
          <a routerLink="/cases" [queryParams]="{ overdue: true }"
            >Unresolved over 48h: {{ queue.overdue }}</a
          >
          <a routerLink="/cases" [queryParams]="{ kind: 'appeal' }"
            >Open appeals: {{ queue.appeals }}</a
          >
          <a routerLink="/users" [queryParams]="{ restriction: 'active' }"
            >Restricted accounts: {{ queue.restrictedUsers }}</a
          >
        </div>
      </section>
    }
    <section class="panel">
      <h2>Review and act</h2>
      <p>
        Review reports, photos and moderation history. Hide or restore a report, archive it, or
        reject a pending claim with a reason.
      </p>
      <p>
        Archiving removes a report from discovery and closes pending claims. Its history remains
        available unless the report is hidden. Hiding preserves history and pauses ordinary access.
      </p>
    </section>
  `,
})
export class Dashboard {
  readonly api = inject(AdminApi);
  readonly workload = signal<AdminWorkload | null>(null);
  readonly overview = signal<AdminOverview | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');

  constructor() {
    void this.load();
  }

  async load() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const [overview, workload] = await Promise.all([
        this.api.request<AdminOverview>('/admin/overview'),
        this.api.request<AdminWorkload>('/admin/operations'),
      ]);
      this.overview.set(overview);
      this.workload.set(workload);
    } catch (error) {
      this.overview.set(null);
      this.workload.set(null);
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
