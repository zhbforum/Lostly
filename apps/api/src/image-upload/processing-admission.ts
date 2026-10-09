export const IMAGE_PROCESSING_CAPACITY = 2;

export interface ImageProcessingAdmission {
  tryAcquire(): (() => void) | null;
}

// Callers choose the permit's lifetime; the app shares this capacity across upload use cases.
export function createImageProcessingAdmission(): ImageProcessingAdmission {
  let running = 0;
  return {
    tryAcquire() {
      if (running >= IMAGE_PROCESSING_CAPACITY) return null;
      running++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        running--;
      };
    },
  };
}
