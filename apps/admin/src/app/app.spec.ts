import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
  type Params,
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import type { AuthUser } from '@lostly/contracts/auth';
import type { AdminListing } from '@lostly/contracts/admin';
import { AdminApi, adminGuard, adminReturnUrl } from './api';
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
  isHidden: false,
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
      '/login?reason=forbidden&returnUrl=%2F',
    );
    const expired = guard();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(TestBed.inject(Router).serializeUrl((await expired) as never)).toBe(
      '/login?reason=expired&returnUrl=%2F',
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
    expect(navigation).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'forbidden', returnUrl: '/' },
    });
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

  it('keeps a fresh session when an old admin request fails after signing in again', async () => {
    const navigation = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const old = api.request('/admin/listings');
    const rejected = expect(old).rejects.toBeInstanceOf(HttpErrorResponse);
    const pending = http.expectOne('/api/admin/listings');
    const login = api.login({ email: admin.email, password: 'test-password' });
    http.expectOne('/api/auth/login').flush({ user: admin });
    await login;
    pending.flush({}, { status: 401, statusText: 'Unauthorized' });
    await rejected;
    expect(api.user()).toEqual(admin);
    expect(navigation).not.toHaveBeenCalled();
  });

  it('does not restore an old account after logout', async () => {
    const restore = api.restore();
    const pending = http.expectOne('/api/auth/me');
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const logout = api.logout();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    pending.flush({ user: admin });
    await restore;
    expect(api.user()).toBeNull();
  });

  it('only accepts internal admin destinations after login', () => {
    expect(adminReturnUrl('/listings?status=active&visibility=hidden')).toBe(
      '/listings?status=active&visibility=hidden',
    );
    for (const value of [
      'https://example.com',
      '//example.com',
      '/\\example.com',
      '/login',
      '/unknown',
    ])
      expect(adminReturnUrl(value)).toBe('/');
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
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let route: {
    snapshot: { data: { resource: string }; queryParamMap: ReturnType<typeof convertToParamMap> };
    queryParamMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  };
  function navigate(query: Params) {
    route.snapshot.queryParamMap = convertToParamMap(query);
    params.next(route.snapshot.queryParamMap);
  }
  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({}));
    route = {
      snapshot: { data: { resource: 'listings' }, queryParamMap: params.value },
      queryParamMap: params,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: route },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(async (_, options) => {
      const previous = Object.fromEntries(
        params.value.keys.map((key) => [key, params.value.get(key)]),
      );
      const query = {
        ...(options?.queryParamsHandling === 'merge' ? previous : {}),
        ...options?.queryParams,
      };
      navigate(Object.fromEntries(Object.entries(query).filter(([, value]) => value !== null)));
      return true;
    });
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
    expect(fixture.nativeElement.querySelector('tbody')?.textContent).not.toContain('Archive');
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

  it('restores filters and a deep-linked page and resets the cursor on filtering', async () => {
    navigate({
      q: 'backpack',
      kind: 'found',
      status: 'active',
      visibility: 'visible',
      cursor: 'saved',
      page: '3',
    });
    const fixture = TestBed.createComponent(Records);
    http
      .expectOne(
        '/api/admin/listings?q=backpack&kind=found&status=active&visibility=visible&cursor=saved',
      )
      .flush({ items: [listing], pageInfo: { endCursor: null, hasNextPage: false } });
    await fixture.whenStable();
    const view = fixture.componentInstance;
    expect(view.pageNumber()).toBe(3);
    expect(view.q).toBe('backpack');
    expect(view.hasPrevious()).toBe(false);
    view.q = '  library  ';
    void view.applyFilters();
    http
      .expectOne('/api/admin/listings?q=library&kind=found&status=active&visibility=visible')
      .flush({ items: [], pageInfo: { endCursor: null, hasNextPage: false } });
    await fixture.whenStable();
    expect(params.value.has('cursor')).toBe(false);
    expect(params.value.has('page')).toBe(false);
    expect(view.pageNumber()).toBe(1);
  });

  it('ignores an older result when URL filters change while a request is pending', async () => {
    const fixture = TestBed.createComponent(Records);
    const old = http.expectOne('/api/admin/listings');
    navigate({ status: 'archived' });
    http
      .expectOne('/api/admin/listings?status=archived')
      .flush({ items: [], pageInfo: { endCursor: null, hasNextPage: false } });
    old.flush({ items: [listing], pageInfo: { endCursor: 'stale', hasNextPage: true } });
    await fixture.whenStable();
    expect(fixture.componentInstance.rows()).toEqual([]);
    expect(fixture.componentInstance.pageInfo().hasNextPage).toBe(false);
  });

  it.each(['hide', 'restore'] as const)(
    'confirms %s with a reason and current version',
    async (action) => {
      const fixture = await open();
      const view = fixture.componentInstance;
      view.begin({ ...listing, isHidden: action === 'restore' }, action);
      view.reason = 'Moderator decision';
      const save = view.confirm();
      const command = http.expectOne('/api/admin/listings/listing/' + action);
      expect(command.request.body).toEqual({ reason: 'Moderator decision', expectedVersion: 2 });
      command.flush(null, { status: 204, statusText: 'No Content' });
      await Promise.resolve();
      await Promise.resolve();
      http.expectOne('/api/admin/listings').flush({
        items: [{ ...listing, isHidden: action === 'hide', version: 3 }],
        pageInfo: { endCursor: null, hasNextPage: false },
      });
      await save;
      expect(view.rows()[0]).toMatchObject({ isHidden: action === 'hide', version: 3 });
      expect(view.selected()).toBeNull();
    },
  );
});
