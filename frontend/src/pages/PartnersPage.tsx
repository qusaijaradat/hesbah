import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createPartner, listPartners, updatePartner } from "../api/partners";
import type { PartnerDto, PartnerType } from "../types";
import { apiErrorMessage } from "../api/client";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../auth/AuthContext";

const TYPE_LABELS: Record<string, string> = { Farmer: "بائع", Driver: "سائق", Merchant: "تاجر", Both: "بائع/تاجر" };

export function PartnersPage() {
  const { hasPermission } = useAuth();
  const [partners, setPartners] = useState<PartnerDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PartnerDto | "new" | null>(null);

  async function refresh() {
    setLoading(true);
    const result = await listPartners({ search: search || undefined, pageSize: 100 });
    setPartners(result.items);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">الباعة والسواق والتجار</h1>
        {hasPermission("partners.manage") && (
          <button className="btn-primary" onClick={() => setEditing("new")}>+ إضافة شخص</button>
        )}
      </div>

      <input
        className="input max-w-sm mb-4"
        placeholder="بحث بالاسم..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>النوع</th>
              <th>رقم واتساب</th>
              <th>الحد الائتماني</th>
              <th>ملاحظات</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : partners.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا يوجد نتائج</td></tr>
            ) : (
              partners.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.type ? TYPE_LABELS[p.type] : "—"}</td>
                  <td>{p.whatsAppNumber || "—"}</td>
                  <td>{p.creditLimit != null ? formatCurrency(p.creditLimit) : "—"}</td>
                  <td className="text-gray-500">{p.notes || "—"}</td>
                  <td className="whitespace-nowrap">
                    {(p.type === "Farmer" || p.type === "Driver" || p.type === "Both") && (
                      <Link to={`/partners/${p.id}/farmer-account`} className="text-brand-700 text-sm hover:underline ms-2">كشف حساب (بائع/سائق)</Link>
                    )}
                    {(p.type === "Merchant" || p.type === "Both") && (
                      <Link to={`/partners/${p.id}/merchant-account`} className="text-brand-700 text-sm hover:underline ms-2">كشف حساب (تاجر)</Link>
                    )}
                    {hasPermission("partners.manage") && (
                      <button className="text-gray-500 text-sm hover:underline ms-2" onClick={() => setEditing(p)}>تعديل</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <PartnerEditModal
          partner={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          // Adding a NEW person stays open (the market often adds several in a row);
          // editing an existing one closes as before — that's always a one-off action.
          onSaved={() => { if (editing !== "new") setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function PartnerEditModal({ partner, onClose, onSaved }: {
  partner: PartnerDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(partner?.name ?? "");
  const [type, setType] = useState<PartnerType | "">(partner?.type ?? "");
  const [whatsAppNumber, setWhatsAppNumber] = useState(partner?.whatsAppNumber ?? "");
  const [notes, setNotes] = useState(partner?.notes ?? "");
  const [creditLimit, setCreditLimit] = useState(partner?.creditLimit != null ? String(partner.creditLimit) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    if (!name.trim()) { setError("الاسم مطلوب"); return; }
    setBusy(true);
    setError(null);
    try {
      const creditLimitValue = creditLimit.trim() === "" ? null : parseFloat(creditLimit);
      const payload = { name, type: type || null, whatsAppNumber: whatsAppNumber || undefined, notes: notes || undefined, creditLimit: creditLimitValue };
      if (partner) {
        await updatePartner(partner.id, payload);
        onSaved();
        return;
      }
      await createPartner(payload);
      onSaved();
      // Stay open for the next person instead of closing.
      setName(""); setType(""); setWhatsAppNumber(""); setNotes(""); setCreditLimit("");
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
        <h2 className="text-lg font-bold mb-4">{partner ? "تعديل شخص" : "إضافة شخص جديد"}</h2>
        <div className="space-y-3">
          <div>
            <label className="label">الاسم</label>
            <input ref={nameRef} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">النوع (اختياري)</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as PartnerType | "")}>
              <option value="">غير محدد</option>
              <option value="Farmer">بائع</option>
              <option value="Driver">سائق</option>
              <option value="Merchant">تاجر</option>
            </select>
          </div>
          <div>
            <label className="label">رقم واتساب (الرقم المعتمد)</label>
            <input className="input" value={whatsAppNumber} onChange={(e) => setWhatsAppNumber(e.target.value)} placeholder="9705xxxxxxxx" />
          </div>
          <div>
            <label className="label">الحد الائتماني (₪، اختياري)</label>
            <input className="input" type="number" min="0" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)}
              placeholder="اتركه فارغًا لعدم وضع حد" />
            <p className="text-xs text-gray-400 mt-1">عند تجاوز التاجر هذا الحد، سيظهر تنبيه في كشف حسابه وعند إصدار فاتورة جديدة له.</p>
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {justAdded && <div className="text-sm text-brand-700">✅ تمت الإضافة — تابع بالشخص التالي أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{partner ? "إلغاء" : "تم"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
