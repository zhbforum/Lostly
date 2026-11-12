import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import type { AdminReview } from '@lostly/contracts/admin';
import { MODERATION_ACTION_LABELS } from '@lostly/contracts/moderation';
import { AdminApi, errorMessage } from './api';

@Component({
  selector: 'app-review',
  imports: [DatePipe],
  template: `
    <details #details (toggle)="details.open && !review() && load()">
      <summary>
        {{ resource() === 'listings' ? 'Photos and moderation history' : 'Moderation history' }}
      </summary>
      @if (busy()) {
        <p role="status">Loading review…</p>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (review(); as data) {
        @if (resource() === 'listings') {
          @if (!data.images.length) {
            <p>No photos attached.</p>
          }
          <div class="review-photos">
            @for (photo of data.images; track photo.id) {
              @if (failedPhotos().includes(photo.id)) {
                <p>Photo unavailable. Reload the review to retry.</p>
              } @else {
                <a [href]="photo.url" target="_blank" rel="noopener noreferrer">
                  <img
                    [src]="photo.url"
                    [alt]="'Report photo ' + (photo.position + 1) + ' (opens in new tab)'"
                    [width]="photo.width"
                    [height]="photo.height"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    (error)="failedPhotos.set([...failedPhotos(), photo.id])"
                  />
                </a>
              }
            }
          </div>
        }
        <p>Moderation history · newest first</p>
        @if (!data.events.items.length) {
          <p>No moderation events on this page.</p>
        }
        <ol class="review-history">
          @for (event of data.events.items; track event.id) {
            <li>
              <strong>{{ actionLabels[event.action] }}</strong>
              <small
                >{{ event.createdAt | date: 'medium' }} ·
                {{ event.actorName ?? 'Deleted administrator' }}</small
              >
              <small>Actor: {{ event.actorUserId }}</small>
              <p>{{ event.reason }}</p>
            </li>
          }
        </ol>
        @if (data.events.pageInfo.hasNextPage) {
          <button
            type="button"
            class="secondary"
            [disabled]="busy()"
            (click)="load(data.events.pageInfo.endCursor)"
          >
            Older events
          </button>
        }
      }
      <button type="button" class="secondary" [disabled]="busy()" (click)="load()">
        Reload review
      </button>
    </details>
  `,
})
export class Review {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly resource = input.required<'listings' | 'claims'>();
  readonly recordId = input.required<string>();
  readonly review = signal<AdminReview | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly failedPhotos = signal<string[]>([]);
  readonly actionLabels = MODERATION_ACTION_LABELS;

  async load(cursor: string | null = null) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const data = await this.api.request<AdminReview>(
        '/admin/' +
          this.resource() +
          '/' +
          this.recordId() +
          '/review' +
          (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      );
      if (this.destroyRef.destroyed) return;
      this.review.set(data);
      this.failedPhotos.set([]);
    } catch (error) {
      if (!this.destroyRef.destroyed) this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
