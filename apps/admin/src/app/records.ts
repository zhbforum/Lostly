import { DatePipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import type { AdminClaim, AdminListing, AdminPage, AdminUser } from '@lostly/contracts/admin';
import type { PageInfo } from '@lostly/contracts/pagination';
import { AdminApi, errorMessage } from './api';

type Row = AdminListing | AdminClaim | AdminUser;

@Component({
  imports: [DatePipe, TitleCasePipe, FormsModule],
  templateUrl: './records.html',
})
export class Records {
  private readonly api = inject(AdminApi);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly resource = inject(ActivatedRoute).snapshot.data['resource'] as
    'listings' | 'users' | 'claims';
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
  readonly pageNumber = signal(1);
  reason = '';
  private cursors: (string | null)[] = [null];
  @ViewChild('confirmation') private dialog!: ElementRef<HTMLDialogElement>;

  constructor() {
    void this.load();
  }

  async load(cursor = this.cursors[this.pageNumber() - 1], destination = this.pageNumber()) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.selected.set(null);
    try {
      const page = await this.api.request<AdminPage<Row>>(
        '/admin/' + this.resource + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      );
      this.rows.set(page.items);
      this.pageInfo.set(page.pageInfo);
      this.cursors[destination - 1] = cursor;
      this.pageNumber.set(destination);
    } catch (error) {
      this.rows.set([]);
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  next() {
    return this.load(this.pageInfo().endCursor, this.pageNumber() + 1);
  }
  previous() {
    return this.load(this.cursors[this.pageNumber() - 2], this.pageNumber() - 1);
  }

  begin(row: AdminListing | AdminClaim) {
    this.selected.set(row);
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
      const archive = 'version' in row;
      await this.api.request(
        '/admin/' + (archive ? 'listings/' + row.id + '/archive' : 'claims/' + row.id + '/reject'),
        archive ? { reason, expectedVersion: row.version } : { reason },
      );
      this.dialog.nativeElement.close();
      this.selected.set(null);
      this.notice.set(
        archive ? 'Listing archived. Pending claims were closed.' : 'Claim rejected.',
      );
      await this.load();
    } catch (error) {
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
