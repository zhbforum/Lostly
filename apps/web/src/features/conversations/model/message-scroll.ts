export const isNearMessageBottom = (height: number, top: number, viewport: number) =>
  height - top - viewport <= 64;
export const anchoredScrollTop = (oldHeight: number, oldTop: number, newHeight: number) =>
  oldTop + newHeight - oldHeight;
