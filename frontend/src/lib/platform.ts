/**
 * What the app is running ON, for the handful of controls that only make sense somewhere.
 *
 * Used to SHOW things where they work, never to hide the app's actual functions. A button that
 * cannot do anything on this device is worse than no button — someone presses it, nothing happens,
 * and they conclude the feature is broken rather than absent. But a screen that withholds a real
 * capability because it guessed wrong about the device is worse still, so everything here is asked
 * about a capability, not about a brand.
 */

/** Installed to a home screen and running without browser chrome, rather than in a tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS answers the first one and not the media query; everyone else is the other way round.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/**
 * A device you touch — which is the same question as "does pressing the camera button open a
 * camera, or a file browser". Asked as a capability so a touchscreen laptop gets the phone's
 * behaviour, which is the behaviour that works there too.
 */
export function hasTouch(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches === true || navigator.maxTouchPoints > 0;
}

/**
 * Whether this browser can listen on its own. Chrome can; Safari cannot and is not going to, which
 * is why the dictation box beside it exists and why the app must not offer a microphone button
 * that does nothing on an iPhone.
 */
export function hasSpeechRecognition(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}
