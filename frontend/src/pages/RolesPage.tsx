import { useEffect, useRef, useState } from "react";
import { createRole, listAllPermissions, listRolesFull, updateRole } from "../api/roles";
import type { PermissionDto, RoleDto } from "../types";
import { apiErrorMessage } from "../api/client";

// Human-readable Arabic labels for the fixed, known permission keys (see PermissionKeys.All on
// the backend). A key added later without an entry here just falls back to showing its raw
// string, so nothing silently disappears from the checklist.
const PERMISSION_LABELS: Record<string, string> = {
  "invoices.create": "إنشاء فواتير",
  "invoices.edit": "تعديل فواتير",
  "invoices.cancel": "إلغاء فواتير",
  "invoices.view": "عرض الفواتير",
  "partners.manage": "إدارة الباعة والسواق والتجار",
  "partners.view": "عرض الباعة والسواق والتجار",
  "payments.create": "تسجيل/تعديل/حذف الدفعات",
  "payments.view": "عرض الدفعات",
  "expenses.manage": "إدارة مصاريف الحسبة",
  "employees.manage": "إدارة الموظفين",
  "reports.view": "عرض التقارير",
  "reports.export": "تصدير التقارير (Excel/PDF)",
  "settings.manage": "إدارة الإعدادات",
  "users.manage": "إدارة المستخدمين والأدوار",
  "audit.view": "عرض سجل التعديلات",
};

const GROUP_LABELS: Record<string, string> = {
  invoices: "الفواتير",
  partners: "الباعة والسواق والتجار",
  payments: "الدفعات",
  expenses: "المصاريف",
  employees: "الموظفون",
  reports: "التقارير",
  settings: "الإعدادات",
  users: "المستخدمون",
  audit: "سجل التعديلات",
};

function groupPermissions(permissions: PermissionDto[]) {
  const groups = new Map<string, PermissionDto[]>();
  for (const p of permissions) {
    const prefix = p.key.split(".")[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(p);
  }
  return Array.from(groups.entries());
}

export function RolesPage() {
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [editing, setEditing] = useState<RoleDto | "new" | null>(null);

  async function refresh() {
    const [r, p] = await Promise.all([listRolesFull(), listAllPermissions()]);
    setRoles(r);
    setPermissions(p);
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">الأدوار والصلاحيات</h1>
        <button className="btn-primary" onClick={() => setEditing("new")}>+ إضافة دور</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>الدور</th><th>الوصف</th><th>عدد الصلاحيات</th><th></th></tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td className="text-gray-500">{r.description || "—"}</td>
                <td>{r.permissions.length}</td>
                <td><button className="text-brand-700 text-sm hover:underline" onClick={() => setEditing(r)}>تعديل</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RoleFormModal
          role={editing === "new" ? null : editing}
          allPermissions={permissions}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function RoleFormModal({ role, allPermissions, onClose, onSaved }: {
  role: RoleDto | null;
  allPermissions: PermissionDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const groups = groupPermissions(allPermissions);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleGroup(keys: string[], checkAll: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checkAll) next.add(key); else next.delete(key);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) { setError("اسم الدور مطلوب"); return; }
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), description: description || undefined, permissionKeys: Array.from(selected) };
      if (role) {
        await updateRole(role.id, payload);
      } else {
        await createRole(payload);
      }
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">{role ? "تعديل دور" : "إضافة دور جديد"}</h2>
        <div className="space-y-3 mb-4">
          <div>
            <label className="label">اسم الدور</label>
            <input ref={nameRef} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">الوصف (اختياري)</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="font-semibold mb-3">الصلاحيات</div>
          <div className="space-y-4">
            {groups.map(([prefix, perms]) => {
              const keys = perms.map((p) => p.key);
              const allChecked = keys.every((k) => selected.has(k));
              return (
                <div key={prefix}>
                  <label className="flex items-center gap-2 text-sm font-medium mb-1">
                    <input type="checkbox" checked={allChecked} onChange={(e) => toggleGroup(keys, e.target.checked)} />
                    {GROUP_LABELS[prefix] ?? prefix}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 ps-6">
                    {perms.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 text-sm text-gray-600">
                        <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                        {PERMISSION_LABELS[p.key] ?? p.key}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-4">{error}</div>}

        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
