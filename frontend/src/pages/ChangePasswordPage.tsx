import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { changePassword } from "../api/auth";
import { apiErrorMessage } from "../api/client";

const MIN_LENGTH = 8;

/**
 * Shown instead of every other screen whenever the account's password was just set or reset by
 * someone else (a brand-new account, or an admin-driven reset) — see ProtectedRoute. Also
 * reachable directly by a signed-in user who just wants to change their password voluntarily.
 */
export function ChangePasswordPage() {
  const { mustChangePassword, markPasswordChanged, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < MIN_LENGTH) {
      setError(`يجب أن تتكوّن كلمة المرور الجديدة من ${MIN_LENGTH} أحرف على الأقل.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("كلمة المرور الجديدة وتأكيدها غير متطابقين.");
      return;
    }

    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      markPasswordChanged();
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تغيير كلمة المرور"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-sm card p-8">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔒</div>
          <h1 className="text-xl font-bold text-gray-900">تغيير كلمة المرور</h1>
          <p className="text-sm text-gray-500">
            {mustChangePassword
              ? "لازم تغيّر كلمة المرور قبل ما تكمل استخدام النظام."
              : "غيّر كلمة المرور الخاصة بحسابك."}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">كلمة المرور الحالية</label>
            <input className="input" type="password" value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)} autoFocus required />
          </div>
          <div>
            <label className="label">كلمة المرور الجديدة</label>
            <input className="input" type="password" value={newPassword} minLength={MIN_LENGTH}
              onChange={(e) => setNewPassword(e.target.value)} required />
            <p className="text-xs text-gray-400 mt-1">{MIN_LENGTH} أحرف على الأقل.</p>
          </div>
          <div>
            <label className="label">تأكيد كلمة المرور الجديدة</label>
            <input className="input" type="password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} required />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "جاري الحفظ..." : "حفظ كلمة المرور"}
          </button>
          {mustChangePassword && (
            <button type="button" className="btn-secondary w-full" onClick={logout}>
              تسجيل الخروج بدل ذلك
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
