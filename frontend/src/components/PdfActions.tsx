import { useState } from "react";
import { triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { canShareFiles, shareFile } from "../lib/share";

/**
 * "🖨️ طباعة" and "📤 مشاركة" for one generated PDF, together.
 *
 * They belong together because they are the same document reaching a person two ways, and keeping
 * them apart is how the app ended up printable in eighteen places and shareable in two: every
 * screen wrote its own print button, and only two ever grew the share half. A seller could be
 * handed his statement on paper but not on WhatsApp, for no reason anyone had decided.
 *
 * Sharing attaches the REAL file through the OS share sheet — a wa.me link can only carry text,
 * so this is the only way an actual PDF reaches a chat without the WhatsApp Business API (see
 * lib/share.ts). The share button hides itself where the browser cannot share files at all rather
 * than failing on click, which on a desktop without the WhatsApp app installed is most of the
 * time; printing always works.
 */
export function PdfActions({
  fetchPdf, fileName, shareTitle, disabled, printLabel = "🖨️ طباعة", printMode = "download", className = "",
}: {
  /** Generates the PDF. Called fresh on each click, so the file is never a stale copy. */
  fetchPdf: () => Promise<Blob>;
  /** With extension — what the file is called when downloaded or shared. */
  fileName: string;
  /** Shown in the share sheet, e.g. "فاتورة INV-2026-000042". Defaults to the file name. */
  shareTitle?: string;
  disabled?: boolean;
  printLabel?: string;
  /**
   * "download" saves the file; "tab" opens it in the browser's own PDF viewer, whose print icon
   * is one click from paper. The invoice screen has always used "tab" and staff print from there
   * all day — worth keeping rather than flattening every screen onto the same behaviour.
   */
  printMode?: "download" | "tab";
  className?: string;
}) {
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Probed with an empty file of the right type: the answer depends on the browser and the OS,
  // not on this particular document's contents.
  const canShare = canShareFiles(new File([], fileName, { type: "application/pdf" }));

  async function run(mode: "print" | "share") {
    setBusy(mode);
    setError(null);
    setNotice(null);
    try {
      const blob = await fetchPdf();
      if (mode === "print") {
        if (printMode === "tab") window.open(URL.createObjectURL(blob), "_blank");
        else triggerBlobDownload(blob, fileName);
        return;
      }
      const result = await shareFile(blob, fileName, "application/pdf", shareTitle ?? fileName);
      // "cancelled" is someone closing the sheet — not a failure, and not worth a message.
      if (result === "unsupported") {
        triggerBlobDownload(blob, fileName);
        setNotice("جهازك ما بيدعم المشاركة — نزّلنا الملف، ارفقه بنفسك.");
      }
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إنشاء الملف"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <button className="btn-secondary" onClick={() => run("print")} disabled={disabled || busy !== null}>
        {busy === "print" ? "جاري التجهيز..." : printLabel}
      </button>
      {canShare && (
        <button
          className="btn-secondary"
          onClick={() => run("share")}
          disabled={disabled || busy !== null}
          title="يفتح قائمة مشاركة الجهاز (واتساب وغيره) والملف مرفق"
        >
          {busy === "share" ? "جاري التجهيز..." : "📤 مشاركة"}
        </button>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
      {notice && <span className="text-sm text-gray-600">{notice}</span>}
    </div>
  );
}
