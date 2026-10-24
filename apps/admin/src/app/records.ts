import { DatePipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectorRef,
  DestroyRef,
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AdminClaim, AdminListing, AdminPage, AdminUser } from '@lostly/contracts/admin';
import type { PageInfo } from '@lostly/contracts/pagination';
import { AdminApi, errorMessage } from './api';
import { Review } from './review';

type Row = AdminListing | AdminClaim | AdminUser;
type ModerationAction = 'archive' | 'hide' | 'restore' | 'reject';

@Component({
  imports: [DatePipe, TitleCasePipe, FormsModule, Review, RouterLink],
  templateUrl: './records.html',
})
export class Records {
  private readonly api = inject(AdminApi);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly resource = this.route.snapshot.data['resource'] as 'listings' | 'users' | 'claims';
  readonly rows = signal<Row[]>([]);
  readonly listings = computed(() =>
    this.rows().filter((row): row is AdminListing => 'owner' in row),
  );
  readonly users = computed(() => this.rows().filter((row): row is AdminUser => 'email' in row));
  readonly claims = computed(() =>
    this.rows().filter((row): row is AdminClaim => 'claimant' in row),
  );
  readonly pageInfo = signal<PageInfo>({ endCursor: null, hasNextPage: false });
  readonly busy = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly notice = signal('');
  readonly selected = signal<AdminListing | AdminClaim | null>(null);
  readonly action = signal<ModerationAction>('archive');
  readonly actionCopy = {
    archive: {
      title: 'Archive listing?',
      description:
        'This removes the listing from discovery and rejects its pending claims. History remains accessible unless hidden. This cannot be undone here.',
      success: 'Listing archived. Pending claims were closed.',
    },
    hide: {
      title: 'Hide listing?',
      description:
        'Only administrators will be able to access this listing. Owner actions and claims are paused. Its status and claim history are preserved for restoration.',
      success: 'Listing hidden from ordinary access.',
    },
    restore: {
      title: 'Restore listing?',
      description:
        'This restores ordinary access with the existing listing status and claim history. Archived or resolved listings will not return to active discovery.',
      success: 'Listing visibility restored.',
    },
    reject: {
      title: 'Reject claim?',
      description:
        'This permanently rejects the pending claim. The listing status and visibility stay unchanged.',
      success: 'Claim rejected.',
    },
  };
  readonly pageNumber = signal(1);
  readonly hasPrevious = signal(false);
  q = '';
  kind = '';
  status = '';
  visibility = '';
  reason = '';
  private cursors = new Map<number, string | null>([[1, null]]);
  private filterKey = '';
  private loadId = 0;
  @ViewChild('confirmation') private dialog!: ElementRef<HTMLDialogElement>;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.dialog?.nativeElement.close();
      this.q = params.get('q') ?? '';
      this.kind = params.get('kind') ?? '';
      this.status = params.get('status') ?? '';
      this.visibility = params.get('visibility') ?? '';
      const key = JSON.stringify([this.q, this.kind, this.status, this.visibility]);
      if (key !== this.filterKey) {
        this.cursors = new Map([[1, null]]);
        this.notice.set('');
      }
      this.filterKey = key;
      const page = Number(params.get('page') ?? 1);
      this.pageNumber.set(
        Number.isSafeInteger(page) && page > 0 && params.has('cursor') ? page : 1,
      );
      this.cursors.set(this.pageNumber(), params.get('cursor'));
      this.hasPrevious.set(this.cursors.has(this.pageNumber() - 1));
      void this.load();
    });
    this.destroyRef.onDestroy(() => this.loadId++);
  }

  async load() {
    const loadId = ++this.loadId;
    this.busy.set(true);
    this.error.set('');
    this.selected.set(null);
    try {
      const query = new URLSearchParams();
      for (const key of [
        'q',
        'kind',
        'status',
        'visibility',
        'cursor',
        'userId',
        'listingId',
        'from',
        'to',
      ]) {
        const value = this.route.snapshot.queryParamMap.get(key);
        if (value) query.set(key, value);
      }
      const page = await this.api.request<AdminPage<Row>>(
        '/admin/' + this.resource + (query.size ? '?' + query : ''),
      );
      if (loadId !== this.loadId) return;
      this.rows.set(page.items);
      this.pageInfo.set(page.pageInfo);
    } catch (error) {
      if (loadId !== this.loadId) return;
      this.rows.set([]);
      this.error.set(errorMessage(error));
    } finally {
      if (loadId === this.loadId) this.busy.set(false);
    }
  }

  applyFilters() {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: this.q.trim() || null,
        kind: this.resource === 'listings' ? this.kind || null : null,
        status: this.resource !== 'users' ? this.status || null : null,
        visibility: this.resource === 'listings' ? this.visibility || null : null,
      },
    });
  }
  resetFilters() {
    return this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }
  next() {
    return this.navigatePage(this.pageInfo().endCursor, this.pageNumber() + 1);
  }
  previous() {
    return this.navigatePage(
      this.cursors.get(this.pageNumber() - 1) ?? null,
      this.hasPrevious() ? this.pageNumber() - 1 : 1,
    );
  }
  private navigatePage(cursor: string | null, page: number) {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      queryParams: { cursor, page: page === 1 ? null : page },
    });
  }

  begin(
    row: AdminListing | AdminClaim,
    action: ModerationAction = 'version' in row ? 'archive' : 'reject',
  ) {
    this.selected.set(row);
    this.action.set(action);
    this.reason = '';
    this.actionError.set('');
    // Render the selected record and autofocus field before opening the native dialog.
    this.changeDetector.detectChanges();
    this.dialog.nativeElement.showModal();
  }

  cancel(event?: Event) {
    if (this.saving()) {
      event?.preventDefault();
      return;
    }
    this.dialog.nativeElement.close();
    this.selected.set(null);
  }

  async confirm() {
    const row = this.selected();
    const reason = this.reason.trim();
    if (!row || this.saving() || reason.length < 3 || reason.length > 500) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      const isListing = 'version' in row;
      await this.api.request(
        '/admin/' + (isListing ? 'listings/' : 'claims/') + row.id + '/' + this.action(),
        isListing ? { reason, expectedVersion: row.version } : { reason },
      );
      if (this.destroyRef.destroyed) return;
      this.dialog.nativeElement.close();
      this.selected.set(null);
      this.notice.set(this.actionCopy[this.action()].success);
      await this.load();
    } catch (error) {
      if (this.destroyRef.destroyed) return;
      if (error instanceof HttpErrorResponse && [404, 409].includes(error.status)) {
        this.dialog.nativeElement.close();
        await this.load();
        this.error.set(errorMessage(error));
      } else this.actionError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
