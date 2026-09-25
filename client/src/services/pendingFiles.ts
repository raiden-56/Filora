/**
 * Files dropped on the home page are handed to the chosen tool through this
 * one-shot holder (tool pages call `take()` on mount).
 */
let pending: File[] | null = null;

export const pendingFiles = {
  set(files: File[]) {
    pending = files;
  },
  take(): File[] | null {
    const f = pending;
    pending = null;
    return f;
  },
  peek(): File[] | null {
    return pending;
  },
};
