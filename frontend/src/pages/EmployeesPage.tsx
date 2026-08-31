import { useEffect, useRef, useState } from "react";
import { createEmployee, listEmployees, updateEmployee } from "../api/employees";
import type { EmployeeDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../auth/AuthContext";

export function EmployeesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("employees.manage");
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmployeeDto | "new" | null>(null);

  async function refresh() {
    setLoading(true);
    setEmployees(await listEmployees());
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">الموظفون</h1>
        {canManage && (
          <button className="btn-primary" onClick={() => setEditing("new")}>+ إضافة موظف</button>
        )}
      </div>

      {/* عمود "إجمالي المصاريف" هو تجميع كل مصروف/سحبة تم ربطها بهذا الموظف من صفحة
          "مصاريف الحسبة" — هذا هو ما يتيح معرفة كم أُعطي لكل موظف. */}
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>رقم الهاتف</th>
              <th>ملاحظات</th>
              <th>الحالة</th>
              <th>إجمالي المصاريف والسحوبات</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : employees.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا يوجد موظفون بعد</td></tr>
            ) : (
              employees.map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.name}</td>
                  <td>{e.phone || "—"}</td>
                  <td className="text-gray-500">{e.notes || "—"}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${e.isActive ? "bg-brand-100 text-brand-800" : "bg-gray-100 text-gray-600"}`}>
                      {e.isActive ? "نشط" : "غير نشط"}
                    </span>
                  </td>
                  <td className="font-semibold">{formatCurrency(e.totalExpenses)}</td>
                  <td>
                    {canManage && (
                      <button className="text-gray-500 text-sm hover:underline" onClick={() => setEditing(e)}>تعديل</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EmployeeEditModal
          employee={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { if (editing !== "new") setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function EmployeeEditModal({ employee, onClose, onSaved }: {
  employee: EmployeeDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(employee?.name ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [notes, setNotes] = useState(employee?.notes ?? "");
  const [isActive, setIsActive] = useState(employee?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    if (!name.trim()) { setError("الاسم مطلوب"); return; }
    setBusy(true);
    setError(null);
    try {
      if (employee) {
        await updateEmployee(employee.id, { name, phone: phone || undefined, notes: notes || undefined, isActive });
        onSaved();
        return;
      }
      await createEmployee({ name, phone: phone || undefined, notes: notes || undefined });
      onSaved();
      // Stay open for the next employee instead of closing.
      setName(""); setPhone(""); setNotes("");
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
        <h2 className="text-lg font-bold mb-4">{employee ? "تعديل موظف" : "إضافة موظف جديد"}</h2>
        <div className="space-y-3">
          <div>
            <label className="label">الاسم</label>
            <input ref={nameRef} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">رقم الهاتف (اختياري)</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">ملاحظات (اختياري)</label>
            <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {employee && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              نشط (يظهر في قائمة اختيار الموظف عند إضافة مصروف)
            </label>
          )}
          {justAdded && <div className="text-sm text-brand-700">✅ تمت الإضافة — تابع بالموظف التالي أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{employee ? "إلغاء" : "تم"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
