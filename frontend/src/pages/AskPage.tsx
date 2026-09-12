import { useEffect, useState } from "react";
import { apiClient, apiErrorMessage } from "../api/client";
import { formatCurrency } from "../lib/format";

/**
 * "اسأل" — a question in Arabic, answered from figures the app already computes.
 *
 * Nothing here costs anything. The question is read on the server by matching words and the names
 * already on file (backend KeywordAskPlanner) — no model, no request off the machine — and every
 * number comes from the same service the matching report screen calls.
 *
 * A wrong answer here is therefore a wrong QUESTION, never a wrong figure, which is why what it
 * understood is printed above the answer and the dates it used beside it. A misread question is
 * invisible otherwise.
 *
 * A question the words cannot place says so. If a model key is ever configured on the server, only
 * those unplaced questions are sent to it — the ones already understood never are.
 */

interface AskRow { label: string; detail?: string | null; amount?: number | null }
interface AskAnswer { intent: string; understood?: string | null; text: string; rows: AskRow[]; period?: string | null }

const EXAMPLES = [
  "كم على أبو علي؟",
  "مين أكتر واحد عليه دين؟",
  "كم باع سامي هالشهر؟",
  "شو أكتر صنف بينباع؟",
  "كم ربحت المصلحة هالشهر؟",
  "شو الشيكات المستحقة؟",
  "مين ماسك صناديقي؟",
];

export function AskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether a model is ALSO configured for the questions keywords cannot place. The feature itself
  // always works, so this only changes the hint shown when a question is not understood.
  const [modelAssist, setModelAssist] = useState(false);

  useEffect(() => {
    apiClient.get<{ configured: boolean; modelAssist: boolean }>("/ask/status")
      .then((r) => setModelAssist(r.data.modelAssist))
      .catch(() => setModelAssist(false));
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const { data } = await apiClient.post<AskAnswer>("/ask", { question: q });
      setAnswer(data);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل السؤال"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-bold">اسأل</h1>
          <p className="text-sm text-gray-500 mt-1">
            اسأل بالعربي عن أي إشي بالنظام. السؤال بينقرا على السيرفر بدون أي خدمة خارجية،
            والأرقام بتيجي من نفس التقارير.
          </p>
        </div>
        <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-3 py-1 font-medium">تجريبي</span>
      </div>


      <div className="card p-4 mb-4">
        <div className="flex gap-2 flex-wrap">
          <input
            className="input flex-1 min-w-64"
            placeholder="مثال: كم على أبو علي؟"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(question); } }}
          />
          <button className="btn-primary" onClick={() => ask(question)} disabled={busy || !question.trim()}>
            {busy ? "جاري..." : "اسأل"}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap mt-3">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              className="text-xs bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1"
                onClick={() => { setQuestion(e); ask(e); }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</div>}

      {answer && (
        <div className="card p-4">
          {/* What it thought you asked, and over which dates. A question read wrongly is the failure
              mode here, and it is invisible unless both are printed next to the answer. */}
          {(answer.understood || answer.period) && (
            <div className="text-xs text-gray-500 border-b pb-2 mb-3">
              {answer.understood && <span>فهمت: {answer.understood}</span>}
              {answer.understood && answer.period && <span> — </span>}
              {answer.period && <span>الفترة: {answer.period}</span>}
            </div>
          )}

          <div className="font-semibold mb-3">{answer.text}</div>

          {/* A phrasing the words did not cover is a gap to fill, not a failure — say so plainly,
              and mention the one thing that would have changed the outcome. */}
          {answer.intent === "Unknown" && (
            <div className="text-xs text-gray-500">
              {modelAssist
                ? "جرّب تكتبه بصيغة تانية."
                : "جرّب تكتبه بصيغة تانية — أو احكيلي الصيغة وبنضيفها، وبتشتغل بعدها دايمًا وببلاش."}
            </div>
          )}

          {answer.rows.length > 0 && (
            <table className="table-base">
              <tbody>
                {answer.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="font-medium">{r.label}</td>
                    <td className="text-gray-500 text-sm">{r.detail || ""}</td>
                    <td className="text-end font-semibold whitespace-nowrap">
                      {r.amount != null ? formatCurrency(r.amount) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
