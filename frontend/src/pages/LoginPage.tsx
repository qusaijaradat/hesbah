import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiErrorMessage } from "../api/client";

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate("/", { replace: true });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تسجيل الدخول"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-sm card p-8">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🥬</div>
          <h1 className="text-xl font-bold text-gray-900">الحسبة</h1>
          <p className="text-sm text-gray-500">نظام إدارة الحسبة — تسجيل الدخول</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">اسم المستخدم</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div>
            <label className="label">كلمة المرور</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "جاري الدخول..." : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
