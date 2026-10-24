import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AdminApi, adminReturnUrl } from './api';
import { CaseDetail } from './case-detail';
import { Action } from './action';

const id = '550e8400-e29b-41d4-a716-446655440001';
const actor = {
  id: 'admin',
  role: 'admin' as const,
  email: 'admin@example.test',
  displayName: 'Moderator',
};
const record = {
  case: {
    id,
    kind: 'report',
    targetType: 'message',
    targetId: id,
    reporterId: 'reporter',
    assigneeId: null,
    category: 'other',
    description: 'Reported message.',
    status: 'open',
    version: 1,
    parentEventId: null,
    publicResolution: null,
    createdAt: '2026-10-24T12:00:00Z',
    updatedAt: '2026-10-24T12:00:00Z',
  },
  reversibleListing: null,
  related: { listingId: null, userId: null, conversationId: id },
  notes: { items: [], pageInfo: { endCursor: null, hasNextPage: false } },
};
describe('moderation operations', () => {
  let http: HttpTestingController;
  let api: AdminApi;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id }) } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(AdminApi);
    api.user.set(actor);
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });
  it('accepts only internal admin deep links after signing in', () => {
    for (const url of ['/cases/' + id, '/users/' + id + '?caseId=' + id, '/audit?targetId=' + id])
      expect(adminReturnUrl(url)).toBe(url);
    for (const url of [
      '//example.test',
      '/cases/../../login',
      '/auth/google/start',
      'https://example.test',
    ])
      expect(adminReturnUrl(url)).toBe('/');
  });
  it('keeps the admin session when a case belongs to someone else', async () => {
    const navigation = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const pending = api.request('/admin/cases/' + id + '/notes', { body: 'Private note' });
    const assertion = expect(pending).rejects.toBeInstanceOf(HttpErrorResponse);
    http
      .expectOne('/api/admin/cases/' + id + '/notes')
      .flush({ error: { code: 'CASE_ASSIGNED' } }, { status: 403, statusText: 'Forbidden' });
    await assertion;
    expect(api.user()).toEqual(actor);
    expect(navigation).not.toHaveBeenCalled();
  });
  it('never reveals private evidence on page load and requires an audited reason', async () => {
    const fixture = TestBed.createComponent(CaseDetail);
    fixture.detectChanges();
    http.expectOne('/api/admin/cases/' + id).flush(record);
    http.expectOne('/api/admin/administrators').flush([actor]);
    await fixture.whenStable();
    fixture.detectChanges();
    http.expectNone('/api/admin/cases/' + id + '/evidence');
    expect(fixture.nativeElement.textContent).not.toContain('Sensitive captured message');
    fixture.componentInstance.evidenceReason = 'Investigating the reported harassment';
    const reveal = fixture.componentInstance.reveal();
    const command = http.expectOne('/api/admin/cases/' + id + '/evidence');
    expect(command.request.method).toBe('POST');
    expect(command.request.body.reason).toBe('Investigating the reported harassment');
    command.flush({ text: 'Sensitive captured message', images: [] });
    await reveal;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sensitive captured message');
  });
  it('separates internal reason from the public notification text', async () => {
    const fixture = TestBed.createComponent(Action);
    fixture.componentRef.setInput('endpoint', '/admin/listings/' + id + '/hide');
    fixture.componentRef.setInput('label', 'Hide listing');
    fixture.componentRef.setInput('payload', { expectedVersion: 2, caseId: id });
    fixture.componentInstance.reason = 'Internal evidence reference';
    fixture.componentInstance.publicReason = 'This report violates the content rules.';
    const submit = fixture.componentInstance.submit();
    const command = http.expectOne('/api/admin/listings/' + id + '/hide');
    expect(command.request.body).toEqual({
      expectedVersion: 2,
      caseId: id,
      reason: 'Internal evidence reference',
      publicReason: 'This report violates the content rules.',
    });
    command.flush({ ok: true });
    await submit;
    expect(fixture.componentInstance.notice()).toBe('Saved.');
    expect(fixture.componentInstance.reason).toBe('');
  });
});
