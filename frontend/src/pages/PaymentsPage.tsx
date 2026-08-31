import { useEffect, useRef, useState } from "react";
import {
  createExpense, createPayment, deleteExpense, deletePayment,
  listExpenses, listPayments, updateExpense, updatePayment,
} from "../api/payments";
import { listEmployees } from "../api/employees";
import { listInvoices } from "../api/invoices";
import type { EmployeeDto, ExpenseDto, InvoiceListItemDto, PaymentDirection, PaymentDto } from "../types";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { formatCurrency, formatDate, todayLocalDateString } from "../lib/format";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function PaymentsPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<"payments" | "expenses">("payments");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">الدفعات والمصاريف</h1>
      <div className="flex gap-2 mb-4">
        <button className={tab === "payments" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("payments")}>الدفعات</button>
        <button className={tab === "expenses" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("expenses")}>مصاريف الحسبة</button>
      </div>
      {tab === "payments" ? <PaymentsTab canManage={hasPermission("payments.create")} /> : <ExpensesTab canManage={hasPermission("expenses.manage")} />}
    </div>
  );
}

function PaymentsTab({ canManage }: { canManage: boolean }) {
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PaymentDto | null>(null);

  async function refresh() {
    const result = await listPayments({ pageSize: 50 });
    setPayments(result.items);
  }

  useEffect(() => { refresh(); }, []);

  async function handleDelete(p: PaymentDto) {
    if (!window.confirm(`حذف دفعة ${formatCurrency(p.amount)} لـ ${p.partnerName}؟`)) return;
    try {
      await deletePayment(p.id);
      refresh();
    } catch (err) {
      alert(apiErrorMessage(err, "فشل الحذف"));
    }
  }

  return (
    <div>
      {canManage && (
        <button className="btn-primary mb-4" onClick={() => setShowForm(true)}>+ تسجيل دفعة</button>
      )}
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>التاريخ</th><th>الشخص</th><th>الاتجاه</th><th>المبلغ</th><th>الفاتورة</th><th>طريقة الدفع</th><th>ملاحظات</th>{canManage && <th></th>}</tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={canManage ? 8 : 7} className="text-center text-gray-400 py-6">لا توجد دفعات</td></tr>
            ) : payments.map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.date)}</td>
                <td>{p.partnerName}</td>
                <td>{p.direction === "ToFarmer" ? "دفعة للبائع/السائق" : "دفعة من المشتري"}</td>
                <td className="font-medium">{formatCurrency(p.amount)}</td>
                <td className="text-gray-500 text-sm">{p.invoiceNumber ?? "—"}</td>
                <td>{p.method || "—"}</td>
                <td className="text-gray-500">{p.notes || "—"}</td>
                {canManage && (
                  <td className="whitespace-nowrap">
                    <button className="text-brand-700 text-sm hover:underline ms-2" onClick={() => setEditing(p)}>تعديل</button>
                    <button className="text-red-500 text-sm hover:underline ms-2" onClick={() => handleDelete(p)}>حذف</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && <PaymentFormModal onClose={() => setShowForm(false)} onSaved={refresh} />}
      {editing && <PaymentEditModal payment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

/** Shared invoice-link picker: lists the selected partner's own invoices (merchant-side or
 * farmer-side depending on direction) so a payment can optionally be tied to one specific
 * invoice instead of only reducing the partner's aggregate balance. */
function InvoiceLinkPicker({ partnerId, direction, invoiceId, onChange }: {
  partnerId: number | null;
  direction: PaymentDirection;
  invoiceId: number | null;
  onChange: (id: number | null) => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceListItemDto[]>([]);

  useEffect(() => {
    if (!partnerId) { setInvoices([]); onChange(null); return; }
    const filter = direction === "FromMerchant" ? { merchantId: partnerId, pageSize: 100 } : { farmerId: partnerId, pageSize: 100 };
    listInvoices(filter).then((r) => setInvoices(r.items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, direction]);

  if (!partnerId) return null;

  return (
    <div>
      <label className="label">ربط بفاتورة محددة (اختياري)</label>
      <select className="input" value={invoiceId ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">بدون ربط (يخفض الرصيد العام)</option>
        {invoices.map((inv) => (
          <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {formatDate(inv.date)} — {formatCurrency(inv.totalValue)}</option>
        ))}
      </select>
    </div>
  );
}

function PaymentFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [partnerText, setPartnerText] = useState("");
  const [direction, setDirection] = useState<PaymentDirection>("ToFarmer");
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  async function handleSave() {
    const partnerName = partnerText.trim();
    if (!partner && !partnerName) { setError("يرجى إدخال اسم الشخص"); return; }
    const amountValue = parseFloat(amount);
    if (!amountValue || amountValue <= 0) { setError("المبلغ يجب أن يكون أكبر من صفر"); return; }
    setBusy(true);
    setError(null);
    try {
      await createPayment({
        partnerId: partner?.id,
        partnerName: partner ? undefined : partnerName,
        direction, amount: amountValue, date: new Date(date).toISOString(),
        method: method || undefined, notes: notes || undefined,
        invoiceId: partner ? invoiceId : null,
      });
      onSaved();
      // Stay open for the next payment (direction/date/method carried over — usually the
      // same for a run of entries — only the person/amount/notes/invoice-link reset).
      setPartner(null); setPartnerText(""); setAmount(""); setNotes(""); setInvoiceId(null);
      setJustAdded(true);
      setSavedOnce(true);
      setTimeout(() => setJustAdded(false), 1200);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تسجيل الدفعة"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-bold mb-4">تسجيل دفعة</h2>
        <div className="space-y-3">
          <div>
            <label className="label">الاتجاه</label>
            <select className="input" value={direction} onChange={(e) => { setDirection(e.target.value as PaymentDirection); setInvoiceId(null); }}>
              <option value="ToFarmer">دفعة للبائع/السائق (يخفض مستحقاته)</option>
              <option value="FromMerchant">دفعة من المشتري (تخفض دينه)</option>
            </select>
          </div>
          <PartnerAutocomplete label="الشخص" value={partner} onChange={setPartner} allowNew onFreeTextChange={setPartnerText} />
          <InvoiceLinkPicker partnerId={partner?.id ?? null} direction={direction} invoiceId={invoiceId} onChange={setInvoiceId} />
          <div>
            <label className="label">المبلغ (₪)</label>
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label">التاريخ</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">طريقة الدفع</label>
            <input className="input" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="نقدي / حوالة / شيك" />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {justAdded && <div className="text-sm text-brand-700">✅ تم تسجيل الدفعة — تابع بدفعة جديدة أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{savedOnce ? "تم" : "إلغاء"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}

function PaymentEditModal({ payment, onClose, onSaved }: { payment: PaymentDto; onClose: () => void; onSaved: () => void }) {
  const [invoiceId, setInvoiceId] = useState<number | null>(payment.invoiceId ?? null);
  const [amount, setAmount] = useState(String(payment.amount));
  const [date, setDate] = useState(payment.date.slice(0, 10));
  const [method, setMethod] = useState(payment.method ?? "");
  const [notes, setNotes] = useState(payment.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    const amountValue = parseFloat(amount);
    if (!amountValue || amountValue <= 0) { setError("المبلغ يجب أن يكون أكبر من صفر"); return; }
    setBusy(true);
    setError(null);
    try {
      await updatePayment(payment.id, {
        amount: amountValue, date: new Date(date).toISOString(),
        method: method || undefined, notes: notes || undefined, invoiceId,
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-bold mb-4">تعديل دفعة — {payment.partnerName}</h2>
        <div className="space-y-3">
          <InvoiceLinkPicker partnerId={payment.partnerId} direction={payment.direction} invoiceId={invoiceId} onChange={setInvoiceId} />
          <div>
            <label className="label">المبلغ (₪)</label>
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label">التاريخ</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">طريقة الدفع</label>
            <input className="input" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="نقدي / حوالة / شيك" />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}

/** Simple dropdown of active employees for "attribute this expense/withdrawal to" — a plain
 * <select> rather than an autocomplete since the employee list is a short, internal staff
 * roster (unlike partners, which can run into the hundreds). Only active employees are offered
 * for NEW entries; an edit modal also injects the currently-linked employee even if since made
 * inactive, so switching away from them isn't forced just to save an unrelated edit. */
function EmployeeSelect({ employeeId, onChange, currentName }: {
  employeeId: number | null;
  onChange: (id: number | null) => void;
  currentName?: string | null;
}) {
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);

  useEffect(() => {
    listEmployees({ activeOnly: true }).then(setEmployees);
  }, []);

  const hasCurrentInList = employeeId != null && employees.some((e) => e.id === employeeId);

  return (
    <div>
      <label className="label">الموظف (اختياري — لتتبع كم أُعطي له)</label>
      <select className="input" value={employeeId ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">بدون موظف</option>
        {!hasCurrentInList && employeeId != null && (
          <option value={employeeId}>{currentName ?? `#${employeeId}`} (غير نشط)</option>
        )}
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>{emp.name}</option>
        ))}
      </select>
    </div>
  );
}

function ExpensesTab({ canManage }: { canManage: boolean }) {
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);

  async function refresh() {
    const result = await listExpenses({ pageSize: 50 });
    setExpenses(result.items);
  }

  useEffect(() => { refresh(); }, []);

  async function handleDelete(e: ExpenseDto) {
    if (!window.confirm(`حذف مصروف "${e.description}" بقيمة ${formatCurrency(e.amount)}؟`)) return;
    try {
      await deleteExpense(e.id);
      refresh();
    } catch (err) {
      alert(apiErrorMessage(err, "فشل الحذف"));
    }
  }

  return (
    <div>
      {canManage && <button className="btn-primary mb-4" onClick={() => setShowForm(true)}>+ إضافة مصروف</button>}
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>التاريخ</th><th>الوصف</th><th>الفئة</th><th>الموظف</th><th>المبلغ</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr><td colSpan={canManage ? 6 : 5} className="text-center text-gray-400 py-6">لا توجد مصاريف</td></tr>
            ) : expenses.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.date)}</td>
                <td>{e.description}</td>
                <td>{e.category || "—"}</td>
                <td>{e.employeeName || "—"}</td>
                <td className="font-medium">{formatCurrency(e.amount)}</td>
                {canManage && (
                  <td className="whitespace-nowrap">
                    <button className="text-brand-700 text-sm hover:underline ms-2" onClick={() => setEditing(e)}>تعديل</button>
                    <button className="text-red-500 text-sm hover:underline ms-2" onClick={() => handleDelete(e)}>حذف</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && <ExpenseFormModal onClose={() => setShowForm(false)} onSaved={refresh} />}
      {editing && <ExpenseEditModal expense={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function ExpenseFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const descRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    if (!description.trim()) { setError("الوصف مطلوب"); return; }
    const amountValue = parseFloat(amount);
    if (isNaN(amountValue) || amountValue < 0) { setError("المبلغ غير صحيح"); return; }
    setBusy(true);
    setError(null);
    try {
      await createExpense({ date: new Date(date).toISOString(), description, amount: amountValue, category: category || undefined, employeeId });
      onSaved();
      // Stay open for the next expense (category/date/employee carried over, description/amount reset).
      setDescription(""); setAmount("");
      setJustAdded(true);
      setSavedOnce(true);
      descRef.current?.focus();
      setTimeout(() => setJustAdded(false), 1200);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل حفظ المصروف"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-bold mb-4">إضافة مصروف</h2>
        <div className="space-y-3">
          <div><label className="label">الوصف</label><input ref={descRef} className="input" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus /></div>
          <div><label className="label">المبلغ (₪)</label><input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="label">الفئة</label><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="كهرباء / إيجار / صيانة / سحب..." /></div>
          <div><label className="label">التاريخ</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <EmployeeSelect employeeId={employeeId} onChange={setEmployeeId} />
          {justAdded && <div className="text-sm text-brand-700">✅ تم حفظ المصروف — تابع بمصروف جديد أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{savedOnce ? "تم" : "إلغاء"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}

function ExpenseEditModal({ expense, onClose, onSaved }: { expense: ExpenseDto; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(expense.description);
  const [amount, setAmount] = useState(String(expense.amount));
  const [category, setCategory] = useState(expense.category ?? "");
  const [date, setDate] = useState(expense.date.slice(0, 10));
  const [employeeId, setEmployeeId] = useState<number | null>(expense.employeeId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!description.trim()) { setError("الوصف مطلوب"); return; }
    const amountValue = parseFloat(amount);
    if (isNaN(amountValue) || amountValue < 0) { setError("المبلغ غير صحيح"); return; }
    setBusy(true);
    setError(null);
    try {
      await updateExpense(expense.id, { date: new Date(date).toISOString(), description, amount: amountValue, category: category || undefined, employeeId });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-bold mb-4">تعديل مصروف</h2>
        <div className="space-y-3">
          <div><label className="label">الوصف</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus /></div>
          <div><label className="label">المبلغ (₪)</label><input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="label">الفئة</label><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="كهرباء / إيجار / صيانة / سحب..." /></div>
          <div><label className="label">التاريخ</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <EmployeeSelect employeeId={employeeId} onChange={setEmployeeId} currentName={expense.employeeName} />
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
