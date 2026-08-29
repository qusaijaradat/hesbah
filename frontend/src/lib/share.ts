/**
 * Requirement gap fix: the existing WhatsApp "send" buttons only ever sent typed-out TEXT
 * (lib/format.ts buildStatementMessage + a wa.me link) — wa.me links have no way to attach a
 * file, so getting the actual invoice PDF into the chat meant downloading it separately and
 * attaching it by hand. A fully automatic "send this exact file to this exact number" flow needs
 * an official, Meta-verified WhatsApp Business API account (a paid subscription with a dedicated
 * approved number) — real infrastructure the market owner would have to provision, not something
 * achievable from browser code alone, so that's out of scope here.
 *
 * The practical middle ground: the OS/browser's own native share sheet (Web Share API, level 2 —
 * the "share files" variant) CAN attach a real file, and WhatsApp shows up in that sheet on most
 * phones and on Windows 10/11 (if the WhatsApp app is installed) — the one thing it can't do is
 * pre-pick which contact/chat to send to; the person choose that themselves in the sheet that pops
 * up. Support varies a lot by browser/OS, so always feature-detect via canShareFiles() before
 * showing a "share file" button, and fall back to a plain download when it's not supported.
 */
export function canShareFiles(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: unknown) => Promise<void> };
  return typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] });
}

export type ShareFileResult = "shared" | "cancelled" | "unsupported";

/**
 * Opens the native share sheet with `blob` attached as a real file named `fileName`. Returns
 * "unsupported" instead of throwing when the browser/OS can't share files at all, so callers can
 * fall back to a plain download; returns "cancelled" (not an error) when the person just closed
 * the share sheet without picking anything.
 */
export async function shareFile(blob: Blob, fileName: string, mimeType: string, title?: string): Promise<ShareFileResult> {
  const file = new File([blob], fileName, { type: mimeType });
  if (!canShareFiles(file)) return "unsupported";
  try {
    await (navigator as Navigator & { share: (data: unknown) => Promise<void> }).share({ files: [file], title });
    return "shared";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    throw err;
  }
}
