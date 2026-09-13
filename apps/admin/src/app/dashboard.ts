import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AdminOverview } from '@lostly/contracts/admin';
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
        <a class="panel metric" routerLink="/listings"
          ><span>Active listings</span><strong>{{ data.activeListings }}</strong></a
        >
        <a class="panel metric" routerLink="/claims"
          ><span>Pending claims</span><strong>{{ data.pendingClaims }}</strong></a
        >
        <a class="panel metric" routerLink="/users"
          ><span>Users</span><strong>{{ data.users }}</strong></a
        >
      </div>
    }
    <section class="panel">
      <h2>Review and act</h2>
      <p>
        Browse reports, accounts and claim summaries. Archive a report or reject a pending claim
        with a reason.
      </p>
      <p>
        Archiving removes a report from discovery and closes pending claims. Its history remains
        available.
      </p>
    </section>
  `,
})
export class Dashboard {
  private readonly api = inject(AdminApi);
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
      this.overview.set(await this.api.request<AdminOverview>('/admin/overview'));
    } catch (error) {
      this.overview.set(null);
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
