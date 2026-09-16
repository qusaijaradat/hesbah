import { useEffect, useState } from "react";
import { endMySession, mySessions } from "../api/auth";
import { apiErrorMessage } from "../api/client";
import { formatDateTime } from "../lib/format";
import type { SessionDto } from "../types";

/**
 * Where MY account is signed in, and the button that signs a device out.
 *
 * Accounts here never sign themselves out — that was the market's choice, and it is what makes
 * this necessary rather than nice. Until now only an admin could end a session, so somebody who
 * left their phone in a taxi had to find an admin before anything could be done about it, and
 * meanwhile the phone was signed in with no expiry at all.
 *
 * No permission: everyone may see where their own account is, and end any of it. users.sessions is
 * for doing that to SOMEBODY ELSE, which is a different question entirely.
 *
 * Ended ones stay on the list, for the same reason they do on the admin's: "when did that phone
 * stop working, and who stopped it" is asked afterwards, and an empty list cannot answer it.
 */

const REASON_LABEL: Record<string, string> = {
  SignedOut: "سجّل خروج",
  EndedByAdmin: "أنهاها المسؤول",
  PasswordChanged: "غيّر كلمة المرور",
  TokenReused: "أُنهيت تلقائيًا — اشتباه بسرقة الجلسة",
};

export function MySessionsCard() {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setSessions(await mySessions());
    } catch {
      // The card simply does not appear. A failure to list devices is not worth a red box on a
      // settings page somebody opened to do something else.
      setSessions([]);
    }
  }

  useEffect(() => { refresh(); }, []);

  if (sessions === null || sessions.length === 0) return null;

  const live = sessions.filter((s) => !s.revokedAt);

  async function end(id: number) {
    if (!window.confirm("إنهاء الجلسة على هذا الجهاز؟")) return;
    setBusyId(id);
    setError(null);
    try {
      await endMySession(id);
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إنهاء الجلسة"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card p-4 mb-4">
      <h2 className="font-semibold mb-1">أجهزتي</h2>
      <p className="text-sm text-gray-500 mb-3">
        حسابك بيضل داخل على كل جهاز سجّلت منه لحد ما تنهي الجلسة. إذا ضاع جوالك أو دخلت من جهاز
        مش إلك، أنهِ جلسته من هون — <span className="font-medium">بيوقف من أول حركة بيعملها</span>.
      </p>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-3">{error}</div>}

      <ul className="divide-y divide-gray-100">
        {sessions.map((s) => (
          <li key={s.id} className="py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className={`text-sm ${s.revokedAt ? "text-gray-400" : "font-medium"}`}>
                {describe(s.userAgent)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">آخر استعمال: {formatDateTime(s.lastUsedAt)}</div>
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
                disabled={busyId === s.id}
                onClick={() => end(s.id)}
              >
                إنهاء
              </button>
            )}
          </li>
        ))}
      </ul>

      {live.length > 0 && (
        <p className="text-xs text-gray-400 mt-3">
          {live.length === 1 ? "جهاز واحد داخل حالياً" : `${live.length} أجهزة داخلة حالياً`}.
          الجهاز اللي أنت عليه هو الآخر استعمالاً.
        </p>
      )}
    </div>
  );
}

/**
 * The browser's self-description, shortened to the two facts somebody scanning a list needs: what
 * kind of device, and which browser. The raw string is a paragraph of version numbers nobody
 * reads, and a list of those tells one device from another about as well as an empty list does.
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
