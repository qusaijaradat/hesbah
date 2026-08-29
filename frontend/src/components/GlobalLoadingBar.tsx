import { useSyncExternalStore } from "react";
import { loadingStore } from "../lib/loadingStore";

/**
 * A slim indeterminate bar fixed to the very top of the viewport, shown automatically whenever at
 * least one API request (see api/client.ts) is in flight anywhere in the app. Mounted once at the
 * app root (App.tsx) — above the router, so it also covers the login page — so every screen gets
 * the same "something is loading" cue for free instead of each page building its own.
 */
export function GlobalLoadingBar() {
  const visible = useSyncExternalStore(loadingStore.subscribe, loadingStore.getSnapshot);

  if (!visible) return null;

  return (
    <div
      className="fixed top-0 inset-x-0 z-[100] h-1 bg-brand-100 overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="جاري التحميل"
    >
      <div className="h-full w-1/3 bg-brand-600 global-loading-bar" />
    </div>
  );
}
