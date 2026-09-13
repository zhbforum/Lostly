import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import type { AuthUser } from '@lostly/contracts/auth';
import type { AdminListing } from '@lostly/contracts/admin';
import { AdminApi, adminGuard } from './api';
import { App } from './app';
import { Login } from './login';
import { Records } from './records';

const admin: AuthUser = {
  id: 'admin',
  email: 'admin@example.com',
  displayName: 'Moderator',
  role: 'admin',
};
const listing: AdminListing = {
  id: 'listing',
  title: 'Blue backpack',
  description: 'Found near the library',
  location: 'Berlin',
  occurredOn: '2026-09-01',
  kind: 'found',
  status: 'active',
  version: 2,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  owner: { id: 'owner', displayName: 'Finder' },
};

describe('admin access and moderation flow', () => {
  let http: HttpTestingController;
  let api: AdminApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(AdminApi);
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('checks the session role before opening an admin route', async () => {
    const guard = () => TestBed.runInInjectionContext(() => adminGuard({} as never, {} as never));
    const permitted = guard();
    http.expectOne('/api/auth/me').flush({ user: admin });
    expect(await permitted).toBe(true);
    const forbidden = guard();
    http.expectOne('/api/auth/me').flush({ user: { ...admin, role: 'user' } });
    expect(TestBed.inject(Router).serializeUrl((await forbidden) as never)).toBe(
      '/login?reason=forbidden',
    );
    const expired = guard();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(TestBed.inject(Router).serializeUrl((await expired) as never)).toBe(
      '/login?reason=expired',
    );
    expect(api.user()).toBeNull();
  });

  it('uses cookies and CSRF protection and clears access after a server denial', async () => {
    const navigation = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    api.user.set(admin);
    const command = api.request('/admin/claims/claim/reject', { reason: 'Spam claim' });
    const assertion = expect(command).rejects.toBeInstanceOf(HttpErrorResponse);
    const request = http.expectOne('/api/admin/claims/claim/reject');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Protection')).toBe('1');
    expect(request.request.method).toBe('POST');
    request.flush({}, { status: 403, statusText: 'Forbidden' });
    await assertion;
    expect(api.user()).toBeNull();
    expect(navigation).toHaveBeenCalledWith(['/login'], { queryParams: { reason: 'forbidden' } });
  });

  it('keeps a non-admin login out of the dashboard', async () => {
    const fixture = TestBed.createComponent(Login);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.email = 'member@example.com';
    fixture.componentInstance.password = 'private-password';
    const submit = fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush({ user: { ...admin, role: 'user' } });
    await submit;
    expect(fixture.componentInstance.error()).toContain('does not have administrator access');
    expect(fixture.componentInstance.password).toBe('');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders navigation only for administrators and signs out through the server', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    api.user.set(admin);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('nav a')).toHaveLength(4);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const logout = fixture.componentInstance.logout();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    expect(api.user()).toBeNull();
  });
});

describe('listing overview', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { resource: 'listings' } } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // jsdom has no modal top layer; actual dialog behavior is covered in the browser.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value() {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value() {
          this.open = false;
        },
      },
    });
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  async function open() {
    const fixture = TestBed.createComponent(Records);
    http
      .expectOne('/api/admin/listings')
      .flush({ items: [listing], pageInfo: { hasNextPage: true, endCursor: 'next-cursor' } });
    await fixture.whenStable();
    return fixture;
  }

  it('paginates and refreshes after a confirmed action, sending the displayed version', async () => {
    const fixture = await open();
    const view = fixture.componentInstance;
    const next = view.next();
    http
      .expectOne('/api/admin/listings?cursor=next-cursor')
      .flush({ items: [listing], pageInfo: { hasNextPage: false, endCursor: null } });
    await next;
    expect(view.pageNumber()).toBe(2);
    view.begin(listing);
    view.reason = '   ';
    await view.confirm();
    http.expectNone('/api/admin/listings/listing/archive');
    view.reason = '  Spam report  ';
    const confirm = view.confirm();
    const action = http.expectOne('/api/admin/listings/listing/archive');
    expect(action.request.body).toEqual({ reason: 'Spam report', expectedVersion: 2 });
    await view.confirm();
    http.expectNone('/api/admin/listings/listing/archive');
    action.flush(null, { status: 204, statusText: 'No Content' });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('/api/admin/listings?cursor=next-cursor').flush({
      items: [{ ...listing, status: 'archived' }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    await confirm;
    fixture.detectChanges();
    expect(view.notice()).toContain('Listing archived');
    expect(fixture.nativeElement.querySelector('tbody button')).toBeNull();
  });

  it('refreshes a conflict and preserves the reason after a network failure', async () => {
    const fixture = await open();
    const view = fixture.componentInstance;
    view.begin(listing);
    view.reason = 'Duplicate report';
    const conflict = view.confirm();
    http
      .expectOne('/api/admin/listings/listing/archive')
      .flush({}, { status: 409, statusText: 'Conflict' });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('/api/admin/listings').flush({
      items: [{ ...listing, version: 3 }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    await conflict;
    expect(view.error()).toContain('record changed');
    expect(view.selected()).toBeNull();
    view.begin({ ...listing, version: 3 });
    view.reason = 'Duplicate report';
    const retry = view.confirm();
    http.expectOne('/api/admin/listings/listing/archive').error(new ProgressEvent('error'));
    await retry;
    expect(view.reason).toBe('Duplicate report');
    expect(view.actionError()).toContain('Cannot reach');
    expect(view.saving()).toBe(false);
  });

  it('allows retry after a list failure and displays an empty state', async () => {
    const fixture = TestBed.createComponent(Records);
    http.expectOne('/api/admin/listings').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Cannot reach the server');
    const retry = fixture.componentInstance.load();
    http
      .expectOne('/api/admin/listings')
      .flush({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
    await retry;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No listings on this page');
  });
});
