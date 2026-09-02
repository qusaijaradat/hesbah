import { useEffect, useRef, useState } from "react";
import { createUser, listRoles, listUsers, updateUser } from "../api/users";
import type { RoleDto, UserDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function UsersPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("users.create");
  const canEdit = hasPermission("users.edit");
  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [editing, setEditing] = useState<UserDto | "new" | null>(null);

  async function refresh() {
    const [u, r] = await Promise.all([listUsers(), listRoles()]);
    setUsers(u);
    setRoles(r);
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">المستخدمون</h1>
        {canCreate && <button className="btn-primary" onClick={() => setEditing("new")}>+ إضافة مستخدم</button>}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.fullName}</td>
                <td className="font-mono text-sm">{u.username}</td>
                <td>{u.roleName}</td>
                <td>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.isActive ? "bg-brand-100 text-brand-800" : "bg-gray-100 text-gray-500"}`}>
                    {u.isActive ? "مفعّل" : "معطّل"}
                  </span>
                </td>
                <td>{canEdit && <button className="text-brand-700 text-sm hover:underline" onClick={() => setEditing(u)}>تعديل</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserFormModal
          user={editing === "new" ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          // Adding a NEW user stays open (handy when setting up several accounts at
          // once); editing an existing one closes as before.
          onSaved={() => { if (editing !== "new") setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function UserFormModal({ user, roles, onClose, onSaved }: {
  user: UserDto | null;
  roles: RoleDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<number | "">(roles.find((r) => r.name === user?.roleName)?.id ?? "");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    if (!fullName.trim() || !roleId) { setError("الاسم والدور مطلوبان"); return; }
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await updateUser(user.id, { fullName, roleId: Number(roleId), isActive, newPassword: password || undefined });
        onSaved();
        return;
      }
      if (!username.trim() || !password) { setError("اسم المستخدم وكلمة المرور مطلوبان"); setBusy(false); return; }
      await createUser({ fullName, username, password, roleId: Number(roleId) });
      onSaved();
      // Stay open for the next account instead of closing (role selection stays as-is —
      // adding several staff with the same role in a row is the common case).
      setFullName(""); setUsername(""); setPassword("");
      setJustAdded(true);
      nameRef.current?.focus();
      setTimeout(() => setJustAdded(false), 1200);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-bold mb-4">{user ? "تعديل مستخدم" : "إضافة مستخدم"}</h2>
        <div className="space-y-3">
          <div><label className="label">الاسم الكامل</label><input ref={nameRef} className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus /></div>
          {!user && (
            <div><label className="label">اسم المستخدم</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          )}
          <div>
            <label className="label">{user ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"}</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} />
            <p className="text-xs text-gray-400 mt-1">
              {user ? "٨ أحرف على الأقل — وسيُطلب من المستخدم تغييرها عند أول دخول." : "٨ أحرف على الأقل — سيُطلب من المستخدم تغييرها عند أول دخول."}
            </p>
          </div>
          <div>
            <label className="label">الدور</label>
            <select className="input" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
              <option value="">اختر دور</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {user && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              الحساب مفعّل
            </label>
          )}
          {justAdded && <div className="text-sm text-brand-700">✅ تمت الإضافة — تابع بمستخدم جديد أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{user ? "إلغاء" : "تم"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
