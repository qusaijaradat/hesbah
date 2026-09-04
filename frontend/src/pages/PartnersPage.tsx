import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { createPartner, deletePartner, listPartners, updatePartner } from "../api/partners";
import type { PartnerDto, PartnerType } from "../types";
import { apiErrorMessage } from "../api/client";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { CREDIT_LIMIT_UI_ENABLED } from "../lib/featureFlags";

const TYPE_LABELS: Record<string, string> = { Farmer: "بائع", Driver: "سائق", Merchant: "مشتري", Both: "بائع/مشتري" };

export function PartnersPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("partners.create");
  const canEdit = hasPermission("partners.edit");
  const canDelete = hasPermission("partners.delete");
  const [partners, setPartners] = useState<PartnerDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PartnerDto | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  // "الرصيد" column: a Both partner (farmer+merchant) has TWO independent balances — shown one
  // under the other, each labeled, rather than combined into one misleading number. A single-role
  // partner just shows their one figure with no label. Red when negative (mirrors every other
  // "remaining" figure in the app — e.g. BulkPrintPage's SectionTable).
  function renderRemaining(p: PartnerDto) {
    const farmerLabel = p.type === "Driver" ? "سائق" : "بائع";
    const isBoth = p.type === "Both";
    const lines: ReactNode[] = [];
    if (p.farmerRemaining != null) {
      lines.push(
        <div key="farmer" className={p.farmerRemaining < 0 ? "text-red-600" : ""}>
          {isBoth && `${farmerLabel}: `}{formatCurrency(p.farmerRemaining)}
        </div>
      );
    }
    if (p.merchantRemaining != null) {
      lines.push(
        <div key="merchant" className={p.merchantRemaining < 0 ? "text-red-600" : ""}>
          {isBoth && "مشتري: "}{formatCurrency(p.merchantRemaining)}
        </div>
      );
    }
    return lines.length > 0 ? <div className="font-semibold text-sm">{lines}</div> : <span className="text-gray-400">—</span>;
  }

  async function handleDelete(p: PartnerDto) {
    if (!window.confirm(`حذف "${p.name}"؟ لا يمكن التراجع عن هذا.`)) return;
    setDeletingId(p.id);
    setError(null);
    try {
      await deletePartner(p.id);
      refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحذف"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">الباعة والسواق والمشترين</h1>
        {canCreate && (
          <button className="btn-primary" onClick={() => setEditing("new")}>+ إضافة شخص</button>
        )}
      </div>

      <input
        className="input max-w-sm mb-4"
        placeholder="بحث بالاسم..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>النوع</th>
              <th>رقم واتساب</th>
              <th>العنوان</th>
              {CREDIT_LIMIT_UI_ENABLED && <th>الحد الائتماني</th>}
              <th>الرصيد</th>
              <th>ملاحظات</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={CREDIT_LIMIT_UI_ENABLED ? 8 : 7} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : partners.length === 0 ? (
              <tr><td colSpan={CREDIT_LIMIT_UI_ENABLED ? 8 : 7} className="text-center text-gray-400 py-6">لا يوجد نتائج</td></tr>
            ) : (
              partners.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.type ? TYPE_LABELS[p.type] : "—"}</td>
                  <td>{p.whatsAppNumber || "—"}</td>
                  <td className="text-gray-500">{p.address || "—"}</td>
                  {CREDIT_LIMIT_UI_ENABLED && <td>{p.creditLimit != null ? formatCurrency(p.creditLimit) : "—"}</td>}
                  <td>{renderRemaining(p)}</td>
                  <td className="text-gray-500">{p.notes || "—"}</td>
                  <td className="whitespace-nowrap">
                    {/* Label reflects this person's ACTUAL type — not a blanket "بائع/سائق" for
                        everyone, since a Driver never has a farmer side and vice versa. A Both
                        partner is farmer+merchant (never a driver), so their farmer-side link
                        always reads "بائع". */}
                    {(p.type === "Farmer" || p.type === "Driver" || p.type === "Both") && (
                      <Link to={`/partners/${p.id}/farmer-account`} className="text-brand-700 text-sm hover:underline ms-2">
                        كشف حساب ({p.type === "Driver" ? "سائق" : "بائع"})
                      </Link>
                    )}
                    {(p.type === "Merchant" || p.type === "Both") && (
                      <Link to={`/partners/${p.id}/merchant-account`} className="text-brand-700 text-sm hover:underline ms-2">كشف حساب (مشتري)</Link>
                    )}
                    {canEdit && (
                      <button className="text-gray-500 text-sm hover:underline ms-2" onClick={() => setEditing(p)}>تعديل</button>
                    )}
                    {canDelete && (
                      <button className="text-red-500 text-sm hover:underline ms-2" disabled={deletingId === p.id} onClick={() => handleDelete(p)}>
                        {deletingId === p.id ? "جاري الحذف..." : "حذف"}
                      </button>
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
  const [address, setAddress] = useState(partner?.address ?? "");
  const [notes, setNotes] = useState(partner?.notes ?? "");
  const [creditLimit, setCreditLimit] = useState(partner?.creditLimit != null ? String(partner.creditLimit) : "");
  const [openingBalance, setOpeningBalance] = useState(partner?.openingBalance != null ? String(partner.openingBalance) : "");
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
      const openingBalanceValue = openingBalance.trim() === "" ? null : parseFloat(openingBalance);
      const payload = { name, type: type || null, whatsAppNumber: whatsAppNumber || undefined, address: address || undefined, notes: notes || undefined, creditLimit: creditLimitValue, openingBalance: openingBalanceValue };
      if (partner) {
        await updatePartner(partner.id, payload);
        onSaved();
        return;
      }
      await createPartner(payload);
      onSaved();
      // Stay open for the next person instead of closing.
      setName(""); setType(""); setWhatsAppNumber(""); setAddress(""); setNotes(""); setCreditLimit(""); setOpeningBalance("");
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
              <option value="Merchant">مشتري</option>
            </select>
          </div>
          <div>
            <label className="label">رقم واتساب (الرقم المعتمد)</label>
            <input className="input" value={whatsAppNumber} onChange={(e) => setWhatsAppNumber(e.target.value)} placeholder="9705xxxxxxxx" />
          </div>
          <div>
            <label className="label">العنوان (اختياري)</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="اتركه فارغًا إذا لا يوجد" />
          </div>
          {CREDIT_LIMIT_UI_ENABLED && (
            <div>
              <label className="label">الحد الائتماني (₪، اختياري)</label>
              <input className="input" type="number" min="0" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="اتركه فارغًا لعدم وضع حد" />
              <p className="text-xs text-gray-400 mt-1">عند تجاوز المشتري هذا الحد، سيظهر تنبيه في كشف حسابه وعند إصدار فاتورة جديدة له.</p>
            </div>
          )}
          <div>
            <label className="label">الرصيد الافتتاحي (₪، اختياري)</label>
            <input className="input" type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="مبلغ كان مستحقًا قبل استخدام البرنامج — اتركه فارغًا إذا لا يوجد" />
            <p className="text-xs text-gray-400 mt-1">
              للمشتري: مبلغ كان عليه قبل هيك. للبائع/السائق: مبلغ كان مستحق إلو من السوق قبل هيك.
              بيضاف تلقائيًا على كل كشف حساب وعلى "الرصيد السابق" بالفاتورة المطبوعة.
            </p>
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
