import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Review } from './review';

describe('moderation review', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('loads on demand, pages history and retries failures without discarding the current review', async () => {
    const fixture = TestBed.createComponent(Review);
    fixture.componentRef.setInput('resource', 'listings');
    fixture.componentRef.setInput('recordId', 'listing');
    fixture.detectChanges();
    http.expectNone('/api/admin/listings/listing/review');
    const view = fixture.componentInstance;
    const load = view.load();
    const data = {
      images: [],
      events: {
        items: [
          {
            id: 'event',
            actorUserId: 'former',
            actorName: null,
            action: 'hide_listing',
            reason: '<script>bad()</script>',
            createdAt: '2026-09-01T12:00:00Z',
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: 'older' },
      },
    };
    http.expectOne('/api/admin/listings/listing/review').flush(data);
    await load;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Deleted administrator');
    expect(fixture.nativeElement.textContent).toContain('<script>bad()</script>');
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    const next = view.load('older');
    http
      .expectOne('/api/admin/listings/listing/review?cursor=older')
      .error(new ProgressEvent('error'));
    await next;
    expect(view.review()?.events.items).toHaveLength(1);
    expect(view.error()).toContain('Cannot reach');
    const retry = view.load('older');
    http.expectOne('/api/admin/listings/listing/review?cursor=older').flush({
      images: [],
      events: { items: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });
    await retry;
    expect(view.error()).toBe('');
    expect(view.review()?.events.items).toEqual([]);
  });
});
