import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  AdminUserDetail,
  AdminListingDetail,
  AdminClaimDetail,
} from '@lostly/contracts/admin-operations';
import { AdminApi, errorMessage } from './api';
import { Action } from './action';

@Component({
  imports: [RouterLink, DatePipe, FormsModule, Action],
  template: `
    <div class="page-heading">
      <h1>{{ resource }} details</h1>
      <button (click)="load()" [disabled]="busy()">Refresh</button>
    </div>
    <p>
      <a [routerLink]="['/', resource]">Back to records</a> ·
      <a routerLink="/audit" [queryParams]="{ targetId: id }">Audit history</a> ·
      <a routerLink="/cases" [queryParams]="{ targetId: id }">Related cases</a>
    </p>
    @if (caseId) {
      <p>
        Working on <a [routerLink]="['/cases', caseId]">case {{ caseId }}</a
        >. Actions will be linked to it.
      </p>
    }
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (busy()) {
      <p role="status">Loading record…</p>
    }
    @if (user(); as data) {
      <section class="panel">
        <h2>{{ data.user.displayName }}</h2>
        <p>{{ data.user.email }} · {{ data.user.role }}</p>
        <p>@{{ data.user.username }}</p>
        <p>{{ data.user.bio }}</p>
        @if (data.user.avatar; as avatar) {
          <img [src]="avatar.staticUrl" alt="Current profile avatar" width="128" height="128" />
        }
        <p>
          Joined {{ data.user.createdAt | date: 'medium' }} · {{ data.activeSessions }} active
          sessions
        </p>
        @for (identity of data.identities; track identity.provider) {
          <p>{{ identity.provider }} identity linked {{ identity.createdAt | date: 'medium' }}</p>
        }
        <p>
          <a routerLink="/listings" [queryParams]="{ userId: id }">Listings</a> ·
          <a routerLink="/claims" [queryParams]="{ userId: id }">Claims involving this user</a>
        </p>
        @if (data.user.restriction; as restriction) {
          <p class="error">
            Restricted: {{ restriction.reason }} ·
            {{ restriction.until ? (restriction.until | date: 'medium') : 'No expiry' }}
          </p>
        }
      </section>
      @if (data.user.role !== 'admin') {
        <section class="panel">
          <h2>Account restriction</h2>
          <p>
            Revokes existing sessions. The user can sign in to read decisions and appeal. Listings
            and claims are preserved.
          </p>
          <label><input type="checkbox" [(ngModel)]="permanent" /> No expiry</label>
          @if (!permanent) {
            <label>Restriction expiry<input type="datetime-local" [(ngModel)]="until" /></label>
          }
          @if (restrictionPayload(data); as payload) {
            <app-action
              [endpoint]="'/admin/users/' + id + '/restriction'"
              label="Restrict account"
              [payload]="payload"
              (changed)="load()"
            />
          }
          @if (data.user.restriction) {
            <app-action
              [endpoint]="'/admin/users/' + id + '/restriction'"
              label="Remove restriction"
              [payload]="{
                expectedVersion: data.user.moderationVersion,
                permanent: false,
                remove: true,
                caseId,
              }"
              (changed)="load()"
            />
          }
        </section>
        <app-action
          [endpoint]="'/admin/users/' + id + '/revoke-sessions'"
          label="Revoke all sessions"
          [payload]="{ expectedVersion: data.user.moderationVersion, caseId }"
          (changed)="load()"
        />
        <section class="panel">
          <h2>Profile moderation</h2>
          <p>Reset only the offending fields. The user can edit their profile again.</p>
          <label
            >Field<select [(ngModel)]="profileField">
              <option value="bio">Bio</option>
              <option value="avatar">Avatar</option>
              <option value="displayName">Display name</option>
              <option value="username">Username</option>
            </select></label
          >
          <app-action
            [endpoint]="'/admin/users/' + id + '/profile'"
            label="Reset profile field"
            [payload]="{ expectedVersion: data.user.version, fields: [profileField], caseId }"
            (changed)="load()"
          />
        </section>
      } @else {
        <p>Administrator accounts are managed by project owners.</p>
      }
    }
    @if (listing(); as data) {
      <section class="panel">
        <h2>{{ data.listing.title }}</h2>
        <p>{{ data.listing.description }}</p>
        <p>{{ data.listing.location }} · {{ data.listing.occurredOn }}</p>
        <p>
          {{ data.listing.status }} · {{ data.listing.isHidden ? 'Hidden' : 'Visible' }} · version
          {{ data.listing.version }}
        </p>
        <p>
          Owner:
          <a [routerLink]="['/users', data.listing.owner.id]" [queryParams]="{ caseId }">{{
            data.listing.owner.displayName
          }}</a>
        </p>
        <a routerLink="/claims" [queryParams]="{ listingId: id }">{{ data.claimCount }} claims</a>
      </section>
      <app-action
        [endpoint]="'/admin/listings/' + id + (data.listing.isHidden ? '/restore' : '/hide')"
        [label]="data.listing.isHidden ? 'Restore visibility' : 'Hide listing'"
        [payload]="{ expectedVersion: data.listing.version, caseId }"
        (changed)="load()"
      />
      @if (data.listing.status !== 'archived') {
        <app-action
          [endpoint]="'/admin/listings/' + id + '/archive'"
          label="Archive listing"
          description="Removes this listing from discovery and rejects pending claims. Each affected claim receives a linked audit event."
          [payload]="{ expectedVersion: data.listing.version, caseId }"
          (changed)="load()"
        />
      }
      <h2>Listing photos</h2>
      @for (image of data.images; track image.id) {
        <section class="panel">
          <img [src]="image.url" alt="Listing evidence photo" width="240" loading="lazy" />
          <p>{{ image.isHidden ? 'Hidden' : 'Visible' }} · {{ image.id }}</p>
          <app-action
            [endpoint]="'/admin/images/' + image.id + '/visibility'"
            [label]="image.isHidden ? 'Restore photo' : 'Hide photo'"
            [payload]="{ expectedVersion: data.listing.version, hidden: !image.isHidden, caseId }"
            (changed)="load()"
          />
        </section>
      }
    }
    @if (claim(); as data) {
      <section class="panel">
        <h2>Claim {{ data.claim.id }}</h2>
        <p>{{ data.claim.status }} · {{ data.claim.createdAt | date: 'medium' }}</p>
        <p>
          Listing:
          <a [routerLink]="['/listings', data.claim.listing.id]" [queryParams]="{ caseId }">{{
            data.claim.listing.title
          }}</a>
        </p>
        <p>
          Claimant:
          <a [routerLink]="['/users', data.claim.claimant.id]" [queryParams]="{ caseId }">{{
            data.claim.claimant.displayName
          }}</a>
        </p>
        <p>
          Owner:
          <a [routerLink]="['/users', data.claim.listing.ownerId]" [queryParams]="{ caseId }">{{
            data.claim.listing.ownerId
          }}</a>
        </p>
        <p>
          Verification details and messages require a related case and an audited evidence reveal.
        </p>
        @if (data.claim.conversation; as conversation) {
          <p>
            Conversation {{ conversation.id }} ·
            {{ conversation.moderationClosed ? 'Paused by moderation' : 'Not paused' }}
          </p>
        }
      </section>
      @if (data.claim.status === 'pending' && data.claim.listing.status === 'active') {
        <app-action
          [endpoint]="'/admin/claims/' + id + '/reject'"
          label="Reject claim"
          [payload]="{ caseId }"
          (changed)="load()"
        />
      }
    }
  `,
})
export class Entity {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  readonly resource = this.route.snapshot.data['resource'] as 'users' | 'listings' | 'claims';
  id = this.route.snapshot.paramMap.get('id')!;
  caseId = this.route.snapshot.queryParamMap.get('caseId') ?? undefined;
  readonly user = signal<AdminUserDetail | null>(null);
  readonly listing = signal<AdminListingDetail | null>(null);
  readonly claim = signal<AdminClaimDetail | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  permanent = false;
  until = '';
  profileField = 'bio';
  private generation = 0;
  constructor() {
    this.destroy.onDestroy(() => this.generation++);
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed())
      .subscribe(([params, query]) => {
        this.id = params.get('id')!;
        this.caseId = query.get('caseId') ?? undefined;
        this.user.set(null);
        this.listing.set(null);
        this.claim.set(null);
        void this.load();
      });
  }
  restrictionPayload(data: AdminUserDetail): Record<string, unknown> | null {
    const expiry = new Date(this.until);
    if (!this.permanent && !Number.isFinite(expiry.getTime())) return null;
    return {
      expectedVersion: data.user.moderationVersion,
      permanent: this.permanent,
      until: this.permanent ? null : expiry.toISOString(),
      caseId: this.caseId,
    };
  }
  async load() {
    const generation = ++this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const data = await this.api.request<AdminUserDetail | AdminListingDetail | AdminClaimDetail>(
        '/admin/' + this.resource + '/' + this.id,
      );
      if (generation !== this.generation) return;
      if ('user' in data) this.user.set(data);
      else if ('listing' in data) this.listing.set(data);
      else this.claim.set(data);
    } catch (error) {
      if (generation === this.generation) {
        this.user.set(null);
        this.listing.set(null);
        this.claim.set(null);
        this.error.set(errorMessage(error));
      }
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
}
