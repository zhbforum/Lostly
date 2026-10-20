import { vi } from 'vitest';

export function mockIntersectionObserver() {
  const observers: TestIntersectionObserver[] = [];
  class TestIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin = '0px';
    readonly scrollMargin = '0px';
    readonly thresholds = [0, 0.1, 0.5, 1];
    readonly observed = new Set<Element>();
    readonly disconnect = vi.fn(() => this.observed.clear());
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback;
      this.root = options?.root ?? null;
      observers.push(this);
    }

    observe(element: Element) {
      this.observed.add(element);
    }
    unobserve(element: Element) {
      this.observed.delete(element);
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    intersect(target: Element, visibleHeight = 24, height = 100, isIntersecting = true) {
      this.callback(
        [
          {
            target,
            isIntersecting,
            intersectionRect: new DOMRect(0, 0, 100, visibleHeight),
            boundingClientRect: new DOMRect(0, 0, 100, height),
            intersectionRatio: visibleHeight / height,
            rootBounds: null,
            time: performance.now(),
          },
        ],
        this,
      );
    }
  }
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  return observers;
}
