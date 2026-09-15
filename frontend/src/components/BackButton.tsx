import { useLocation, useNavigate } from "react-router-dom";

/**
 * Back to the screen you were just on.
 *
 * The browser has this button; an app added to the home screen does not. Installed to an iPhone
 * the app runs with no browser chrome at all — no back arrow, no gesture that goes anywhere — so
 * a person who taps into an invoice from the search box, or into somebody's account from the
 * debts page, has no way back except the menu, and the menu does not remember where they were.
 *
 * It is the history's own back, so it always means the same thing as the browser's: the previous
 * screen, not a guessed-at parent. "Where I just was" is what somebody means when they reach for
 * this, and any rule about what SHOULD be above the current page is a rule that will be wrong.
 */
export function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  // React Router numbers its entries in history.state. Zero means this is the first screen of the
  // session — somebody opened the app here, or came straight from the login screen — and going
  // back from there leaves the app entirely, which is never what the arrow is understood to mean.
  const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  // On the landing page there is nothing above to go to either, whatever history says.
  if (index <= 0 || location.pathname === "/") return null;

  return (
    <button
      type="button"
      aria-label="رجوع"
      title="رجوع"
      className="rounded-md p-1.5 hover:bg-brand-800 shrink-0"
      onClick={() => navigate(-1)}
    >
      {/* Points right: in an RTL page, back is the direction the text comes from. */}
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
