import { useEffect, useRef, useState } from "react";
import { shareFile } from "../lib/share";
import { hasTouch } from "../lib/platform";

interface Props {
  /**
   * Called with one sentence, typed or dictated. The caller decides what a sentence means on its
   * own screen — a whole row on the ledger page, one item line on the invoice form — because only
   * the caller knows what fields it has.
   *
   * Returns a message to show when it could not make anything of the sentence, or null when it
   * could. Saying "سمعت كذا بس ما فهمت" is the difference between a tool that ignores you and one
   * that tells you to say it differently.
   */
  onSentence: (said: string) => string | null;
  placeholder: string;
  /** The line under the box: what to say, in the words of the screen it sits on. */
  hint: React.ReactNode;
}

/**
 * "قول أو صوّر" — the two ways to get what is on paper into the app without typing it twice.
 *
 * Shared by the ledger-entry screen and the invoice form. Both wanted the same two controls and
 * the same three warnings around them, and the second copy of something like this is where the
 * two versions start quietly disagreeing about what a photo is for.
 *
 * What it does NOT do is read the photo. Nothing free reads handwritten Arabic, and a version of
 * this that filled fields with guesses would look like it worked. The photo stays on screen to be
 * read BY A PERSON while they enter the rows, and can be shared on in one tap to something that
 * can read it.
 */
export function CaptureBar({ onSentence, placeholder, hint }: Props) {
  const [said, setSaid] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [page, setPage] = useState<{ file: File; url: string } | null>(null);
  const [big, setBig] = useState(false);
  const camera = useRef<HTMLInputElement | null>(null);

  // The object URL is the only thing here that outlives a render, so it is the only thing to clean
  // up. Without this, photographing ten pages in a session leaks ten images.
  useEffect(() => () => { if (page) URL.revokeObjectURL(page.url); }, [page]);

  function submit() {
    const text = said.trim();
    if (text === "") return;
    const problem = onSentence(text);
    setNote(problem);
    if (!problem) setSaid("");
  }

  function capture(file: File | undefined) {
    if (!file) return;
    setPage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { file, url: URL.createObjectURL(file) };
    });
    setNote(null);
  }

  async function share() {
    if (!page) return;
    const result = await shareFile(page.file, page.file.name || "page.jpg", page.file.type || "image/jpeg");
    if (result === "unsupported") setNote("متصفحك ما بدعم المشاركة المباشرة — نزّل الصورة وابعتها يدويًا.");
  }

  return (
    <div className="card p-3 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          // 16rem plus two buttons overflows a 320px phone. Full width on its own line there,
          // sharing the line from the first breakpoint up.
          className="input w-full sm:w-auto sm:flex-1 sm:min-w-[14rem]"
          placeholder={placeholder}
          value={said}
          onChange={(e) => setSaid(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        />
        <button className="btn-secondary" onClick={submit} disabled={said.trim() === ""}>أضف</button>
        {/* capture="environment" opens the back camera straight away on a phone instead of the
            photo library. On a desktop the same control is an ordinary "choose a file". */}
        <input
          ref={camera} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { capture(e.target.files?.[0]); e.target.value = ""; }}
        />
        {/* Same control, honestly labelled: on a phone it opens the camera, on a desktop it opens
            a file browser — which is still the right button there, since that is where a scanner
            puts its output. Hiding it on desktop would take away the scanner path. */}
        <button className="btn-secondary whitespace-nowrap" onClick={() => camera.current?.click()}>
          {hasTouch() ? "📷 صوّر" : "🖼️ صورة الصفحة"}
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-2">{hint}</p>

      {note && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2 mt-2">{note}</div>}

      {page && (
        <div className="mt-3">
          <div className="flex items-center gap-3 flex-wrap mb-2 text-xs">
            <span className="font-semibold text-sm">الصفحة المصوّرة</span>
            <button className="btn-link text-brand-700 hover:underline" onClick={() => setBig((v) => !v)}>
              {big ? "تصغير" : "تكبير"}
            </button>
            <button className="btn-link text-brand-700 hover:underline" onClick={share}>مشاركة الصورة</button>
            <button
              className="btn-link text-red-600 hover:underline ms-auto"
              onClick={() => { setPage(null); setBig(false); }}
            >
              شيل الصورة
            </button>
          </div>
          {/* Stays on screen while the rows are entered: the point is to stop somebody holding a
              notebook open with one hand. Tap it when a line is too faint to read small. */}
          <img
            src={page.url}
            alt="الصفحة المصوّرة"
            className={`w-full object-contain rounded border border-gray-200 cursor-zoom-in ${big ? "max-h-[80vh]" : "max-h-56"}`}
            onClick={() => setBig((v) => !v)}
          />
          <p className="text-xs text-gray-500 mt-2">
            الصورة بتضل قدامك وأنت بتعبّي، وما بتنرفع ولا بتنحفظ بأي مكان.
          </p>
        </div>
      )}
    </div>
  );
}
