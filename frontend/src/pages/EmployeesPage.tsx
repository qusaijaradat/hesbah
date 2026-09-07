import { useEffect, useRef, useState } from "react";
import { createEmployee, deleteEmployee, listEmployees, updateEmployee } from "../api/employees";
import type { EmployeeDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { usePagination } from "../lib/usePagination";
import { TablePagination } from "../components/TablePagination";
import { useSelection } from "../lib/useSelection";
import { runBulkDelete, summarizeBulkDelete } from "../lib/bulkDelete";

export function EmployeesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("employees.create");
  const canEdit = hasPermission("employees.edit");
  const canDelete = hasPermission("employees.delete");
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmployeeDto | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const selection = useSelection();
  const pager = usePagination(employees);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function refresh() {
    setLoading(true);
    setEmployees(await listEmployees());
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function handleDelete(e: EmployeeDto) {
    if (!window.confirm(`حذف "${e.name}"؟ لا يمكن التراجع عن هذا.`)) return;
    setDeletingId(e.id);
    setError(null);
    try {
      await deleteEmployee(e.id);
      refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحذف"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    const selected = employees.filter((e) => selection.selected.has(e.id));
    if (selected.length === 0) return;
    if (!window.confirm(`حذف ${selected.length} موظف محدد؟ لا يمكن التراجع عن هذا.`)) return;
    setBulkDeleting(true);
    setError(null);
    const outcome = await runBulkDelete(selected, (e) => e.id, (e) => e.name, deleteEmployee);
    setBulkDeleting(false);
    selection.clear();
    await refresh();
    if (outcome.failedCount > 0) setError(summarizeBulkDelete(outcome));
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-bold">الموظفون</h1>
        {canCreate && (
          <button className="btn-primary" onClick={() => setEditing("new")}>+ إضافة موظف</button>
        )}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4 whitespace-pre-line">{error}</div>}

      {canDelete && selection.selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{selection.selected.size}</span></span>
          <button className="btn-danger text-sm" disabled={bulkDeleting} onClick={handleBulkDelete}>
            {bulkDeleting ? "جاري الحذف..." : `حذف المحدد (${selection.selected.size})`}
          </button>
        </div>
      )}

      {/* عمود "إجمالي المصاريف" هو تجميع كل مصروف/سحبة تم ربطها بهذا الموظف من صفحة
          "مصاريف الحسبة" — هذا هو ما يتيح معرفة كم أُعطي لكل موظف. */}
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {canDelete && (
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={pager.pageRows.length > 0 && pager.pageRows.every((e) => selection.selected.has(e.id))}
                    onChange={() => selection.toggleAll(pager.pageRows.map((e) => e.id))}
                  />
                </th>
              )}
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
              <tr><td colSpan={canDelete ? 7 : 6} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : employees.length === 0 ? (
              <tr><td colSpan={canDelete ? 7 : 6} className="text-center text-gray-400 py-6">لا يوجد موظفون بعد</td></tr>
            ) : (
              pager.pageRows.map((e) => (
                <tr key={e.id}>
                  {canDelete && (
                    <td>
                      <input type="checkbox" checked={selection.selected.has(e.id)} onChange={() => selection.toggleOne(e.id)} />
                    </td>
                  )}
                  <td className="font-medium">{e.name}</td>
                  <td>{e.phone || "—"}</td>
                  <td className="text-gray-500">{e.notes || "—"}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${e.isActive ? "bg-brand-100 text-brand-800" : "bg-gray-100 text-gray-600"}`}>
                      {e.isActive ? "نشط" : "غير نشط"}
                    </span>
                  </td>
                  <td className="font-semibold">{formatCurrency(e.totalExpenses)}</td>
                  <td className="whitespace-nowrap">
                    {canEdit && (
                      <button className="text-gray-500 text-sm hover:underline ms-2" onClick={() => setEditing(e)}>تعديل</button>
                    )}
                    {canDelete && (
                      <button className="text-red-500 text-sm hover:underline ms-2" disabled={deletingId === e.id} onClick={() => handleDelete(e)}>
                        {deletingId === e.id ? "جاري الحذف..." : "حذف"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <TablePagination
          page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
          itemLabel="موظف" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
        />
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
      <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
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
