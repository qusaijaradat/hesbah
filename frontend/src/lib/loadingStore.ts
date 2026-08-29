/**
 * Tracks how many API requests (see api/client.ts) are currently in flight, app-wide, so a single
 * global loading bar (components/GlobalLoadingBar.tsx) can show "something is loading" for every
 * request everywhere — not just the handful of pages that already had their own "جاري التحميل..."
 * text. A plain module-level counter + listener set (no external state library needed) — read via
 * React's useSyncExternalStore.
 */

type Listener = () => void;

let activeCount = 0;
let visible = false;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

// Keeps the bar visible for a short moment after the last request finishes instead of hiding the
// instant it does — two requests fired back-to-back (very common: a page loading its settings
// then its list) would otherwise flicker the bar off and straight back on between them.
const HIDE_GRACE_MS = 200;

function emit() {
  listeners.forEach((listener) => listener());
}

function setVisible(next: boolean) {
  if (visible === next) return;
  visible = next;
  emit();
}

export const loadingStore = {
  /** Call when a request starts. */
  start() {
    activeCount += 1;
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    setVisible(true);
  },

  /** Call exactly once per start(), whether the request succeeded or failed. */
  finish() {
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0) {
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => setVisible(false), HIDE_GRACE_MS);
    }
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): boolean {
    return visible;
  },
};
