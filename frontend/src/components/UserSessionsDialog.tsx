import { useEffect, useState } from "react";
import { endAllUserSessions, endUserSession, listUserSessions } from "../api/users";
import { apiErrorMessage } from "../api/client";
import { formatDateTime } from "../lib/format";
import type { SessionDto, UserDto } from "../types";

/**
 * Where one person is signed in, and the buttons that put them out.
 *
 * Accounts here never sign themselves out — that was the market's own decision, so that somebody
 * entering invoices all day never meets the login screen. This dialog is the other half of that
 * decision, and the reason it is safe: a lost phone, a person who left, a device somebody does not
 * recognise, all end here, and they stop working on their very next request rather than whenever a
 * token happens to lapse.
 *
 * Ended sessions stay on the list. "When did that phone stop working, and who stopped it" is a
 * question asked after the fact, and a list that only shows live devices cannot answer it.
 */

const REASON_LABEL: Record<string, string> = {
  SignedOut: "سجّل خروج",
  EndedByAdmin: "أنهاها المسؤول",
  PasswordChanged: "غيّر كلمة المرور",
  TokenReused: "أُنهيت تلقائيًا — اشتباه بسرقة الجلسة",
};

export function UserSessionsDialog({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setSessions(await listUserSessions(user.id));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تحميل الجلسات"));
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user.id]);

  const live = sessions?.filter((s) => !s.revokedAt) ?? [];

  async function end(id: number) {
    setBusy(true);
    try {
      await endUserSession(id);
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إنهاء الجلسة"));
    } finally {
      setBusy(false);
    }
  }

  async function endAll() {
    if (!window.confirm(`إنهاء كل جلسات ${user.fullName}؟ رح يضطر يسجّل دخول من جديد على كل أجهزته.`)) return;
    setBusy(true);
    try {
      await endAllUserSessions(user.id);
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إنهاء الجلسات"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card sm:max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold">الأجهزة المسجّلة — {user.fullName}</h2>
          <button className="btn-link text-sm text-gray-500 hover:underline" onClick={onClose}>إغلاق</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          الحساب بيضل داخل لحد ما حدا ينهي الجلسة. لما تنهيها، الجهاز بيوقف من أول حركة بيعملها — مش
          بعد ساعات.
        </p>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-3">{error}</div>}

        {sessions === null ? (
          <div className="text-sm text-gray-400 py-6 text-center">جاري التحميل...</div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">ما سجّل دخول من أي جهاز بعد</div>
        ) : (
          <ul className="divide-y divide-gray-100 -mx-1">
            {sessions.map((s) => (
              <li key={s.id} className="px-1 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${s.revokedAt ? "text-gray-400" : "font-medium"}`}>
                    {describe(s.userAgent)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    آخر استعمال: {formatDateTime(s.lastUsedAt)}
                  </div>
                  {s.revokedAt && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      انتهت {formatDateTime(s.revokedAt)}
                      {s.revokedReason && ` — ${REASON_LABEL[s.revokedReason] ?? s.revokedReason}`}
                    </div>
                  )}
                </div>
                {!s.revokedAt && (
                  <button
                    className="btn-link text-sm text-red-600 hover:underline shrink-0"
                    disabled={busy}
                    onClick={() => end(s.id)}
                  >
                    إنهاء
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {live.length > 1 && (
          <button className="btn-danger w-full mt-4" disabled={busy} onClick={endAll}>
            إنهاء كل الجلسات ({live.length})
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The browser's self-description, shortened to the two facts somebody scanning a list needs: what
 * kind of device, and which browser. The raw string is a paragraph of version numbers nobody reads,
 * and a list of those tells one device from another about as well as an empty list does.
 */
function describe(userAgent: string | null): string {
  if (!userAgent) return "جهاز غير معروف";
  const ua = userAgent;
  const device =
    /iPhone/i.test(ua) ? "آيفون" :
    /iPad/i.test(ua) ? "آيباد" :
    /Android/i.test(ua) ? "أندرويد" :
    /Windows/i.test(ua) ? "ويندوز" :
    /Mac OS X|Macintosh/i.test(ua) ? "ماك" :
    /Linux/i.test(ua) ? "لينكس" : "جهاز";
  // Order matters: Edge and Chrome both claim to be Safari, and Chrome claims to be Safari too.
  const browser =
    /Edg\//i.test(ua) ? "Edge" :
    /OPR\/|Opera/i.test(ua) ? "Opera" :
    /Firefox/i.test(ua) ? "Firefox" :
    /Chrome|CriOS/i.test(ua) ? "Chrome" :
    /Safari/i.test(ua) ? "Safari" : null;
  return browser ? `${device} — ${browser}` : device;
}
