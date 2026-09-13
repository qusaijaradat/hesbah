import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

/**
 * Registering the service worker is what makes a browser offer to install this as an app. It is
 * network-first and caches nothing but the shell — see public/sw.js for why that matters on a
 * screen full of money.
 *
 * Guarded and non-fatal on purpose: a browser without service workers, or a page served over
 * plain http (which disallows them), must still run the whole app. Failing to become installable
 * is not a reason to fail to open.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
