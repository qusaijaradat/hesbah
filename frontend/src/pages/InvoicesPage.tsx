import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { deleteInvoice, downloadInvoicePdf, downloadInvoicesExcel, getInvoice, listInvoices, triggerBlobDownload, updateInvoiceAttributes } from "../api/invoices";
import { getFarmerAccount } from "../api/partners";
import { listSettings } from "../api/settings";
import type { InvoiceFilter, InvoiceListItemDto, InvoicePaymentStatus } from "../types";
import { buildStatementMessage, buildWhatsAppLink, formatCount, formatCurrency, formatDate, formatWeight } from "../lib/format";
import { shareFile } from "../lib/share";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSelection } from "../lib/useSelection";
import { TablePagination } from "../components/TablePagination";
import { CollapsibleRows } from "../components/CollapsibleRows";
import { runBulkDelete, summarizeBulkDelete } from "../lib/bulkDelete";
import { InvoiceLink, PartnerLink } from "../components/RecordLinks";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { BulkEditDialog } from "../components/BulkEditDialog";
import type { BulkEditField } from "../components/BulkEditDialog";

const STATUS_LABELS: Record<string, string> = { Active: "فعّالة", Cancelled: "ملغاة" };

// Where the invoice stands against what has actually been collected on it — the question the
// market asks all day, which used to need a trip to the Payments page. An uncleared check does
// NOT count as paid here, same as every balance in the app (see backend PaymentRules).
const PAYMENT_STATUS_LABELS: Record<InvoicePaymentStatus, string> = {
  Unpaid: "غير مدفوعة",
  Partial: "مدفوعة جزئياً",
  Paid: "مدفوعة",
};
const PAYMENT_STATUS_CLASS: Record<InvoicePaymentStatus, string> = {
  Unpaid: "bg-red-100 text-red-700",
  Partial: "bg-amber-100 text-amber-800",
  Paid: "bg-brand-100 text-brand-800",
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function InvoicesPage() {
  const { hasPermission } = useAuth();
  // Defaults to today (explicit request: "الفواتير لازم تنعرض بتاريخ اليوم افتراضيًا") — changing
  // either date input below then drives the same filter/refresh as any other change here.
  const [searchParams] = useSearchParams();
  // The filter carries ids; the pickers need the whole person to show a name back. Kept beside
  // the filter rather than derived from it — resolving three ids to three names on every render
  // would be three lookups to redisplay something the user just typed.
  type Pick = { id: number; name: string } | null;
  const [merchantPick, setMerchantPick] = useState<Pick>(null);
  const [farmerPick, setFarmerPick] = useState<Pick>(null);
  const [driverPick, setDriverPick] = useState<Pick>(null);
  const [filter, setFilter] = useState<InvoiceFilter>(() => {
    // Arriving from a dashboard card ("فواتير غير مسدّدة") means asking about the CURRENT
    // position, not about today — so a linked filter drops the default date window entirely,
    // otherwise the count on the card and the rows here would almost never match.
    const paymentStatus = searchParams.get("paymentStatus") as InvoicePaymentStatus | null;
    const hasUnpricedItems = searchParams.get("hasUnpricedItems") === "true";
    if (paymentStatus || hasUnpricedItems) {
      return {
        page: 1, pageSize: 25,
        paymentStatus: paymentStatus ?? undefined,
        hasUnpricedItems: hasUnpricedItems || undefined,
      };
    }
    const now = new Date();
    return { page: 1, pageSize: 25, dateFrom: startOfDay(now).toISOString(), dateTo: endOfDay(now).toISOString() };
  });
  const [result, setResult] = useState<{ items: InvoiceListItemDto[]; totalCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  // Header info for the shared Arabic WhatsApp template (lib/format.ts buildStatementMessage) —
  // same one used on the invoice detail page and the bulk-print page, so a message sent straight
  // from this list reads exactly the same.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);
  // Tracks which row's button is mid-send ("<invoiceId>-merchant" / "<invoiceId>-farmer") so only
  // that one button shows a busy state while its invoice detail is being fetched.
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  // Informational (not an error) — e.g. "your browser can't share files, downloaded it instead".
  const [notice, setNotice] = useState<string | null>(null);
  // "حذف / تحديد الكل" — same shared selection + bulk-delete plumbing every other deletable table
  // uses (lib/useSelection + lib/bulkDelete), so the toolbar, header checkbox and failure summary
  // all behave identically to the Payments/Partners/Items pages.
  const canDelete = hasPermission("invoices.delete");
  const canEdit = hasPermission("invoices.edit");
  const [bulkEditing, setBulkEditing] = useState(false);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const rows = result?.items ?? [];

  useEffect(() => {
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      // The number written inside the message, so whoever gets a statement about their money can
      // reply to it. market.whatsapp, NOT market.phone: the phone is the landline on the printed
      // header, and the two are usually different numbers — only one of them can receive a reply.
      //
      // Left empty it also turns WhatsApp off entirely on this page. A market that has not said
      // where it wants to be reached should not be sending people statements from nowhere.
      const phone = settings.find((s) => s.key === "market.whatsapp")?.value;
      if (name) setCompanyName(name);
      setCompanyPhone(phone || null);
    });
  }, []);

  async function refresh() {
    setLoading(true);
    setResult(await listInvoices(filter));
    setLoading(false);
    // Rows about to be replaced — a selection made before a filter/page change would otherwise
    // keep pointing at invoices that are no longer on screen, and "حذف المحدد" counts only what
    // it can still see, so the count and the actual deletion would disagree.
    selection.clear();
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Deleting is NOT cancelling: the invoice disappears from the list/reports/accounts entirely
  // instead of staying visible as "ملغاة" (the cancel action still lives on the detail page).
  // The confirm text spells that out so neither one gets picked by mistake.
  async function handleDelete(inv: InvoiceListItemDto) {
    if (!window.confirm(`حذف الفاتورة ${inv.invoiceNumber} (${inv.merchantName})؟\nرح تختفي من القوائم والتقارير والحسابات. لا يمكن التراجع عن هذا.`)) return;
    setBulkError(null);
    try {
      await deleteInvoice(inv.id);
      await refresh();
    } catch (err) {
      setBulkError(apiErrorMessage(err, "فشل الحذف"));
    }
  }

  async function handleBulkDelete() {
    const selectedInvoices = rows.filter((inv) => selection.selected.has(inv.id));
    if (selectedInvoices.length === 0) return;
    if (!window.confirm(`حذف ${selectedInvoices.length} فاتورة محددة؟\nرح تختفي من القوائم والتقارير والحسابات. لا يمكن التراجع عن هذا.`)) return;
    setBulkDeleting(true);
    setBulkError(null);
    // One request per invoice (same as every other bulk delete here) — a partial failure reports
    // exactly which invoices survived instead of silently rolling the whole batch back.
    const outcome = await runBulkDelete(selectedInvoices, (inv) => inv.id, (inv) => inv.invoiceNumber, deleteInvoice);
    setBulkDeleting(false);
    await refresh();
    if (outcome.failedCount > 0) setBulkError(summarizeBulkDelete(outcome));
  }

  /**
   * The two attributes an invoice may be changed by in bulk, both through the narrow PATCH rather
   * than the full PUT — see api/invoices.updateInvoiceAttributes for why that distinction is the
   * whole point.
   *
   * Not here, and not by oversight: the buyer, the seller, the items, the prices and أجرة النقل.
   * Every one of them moves somebody's balance.
   */
  const bulkEditFields: BulkEditField<InvoiceListItemDto>[] = [
    {
      // A free search over everyone, not a list of the drivers already on these invoices — those
      // are the set you are trying to CHANGE when a day went out under the wrong driver or none.
      // Sellers are searchable too: picking one grants them the driver role rather than creating a
      // second record for the same person (backend PartnerRoles).
      key: "driver", label: "السائق", kind: "partner",
      partnerTypes: ["Driver", "Farmer"],
      emptyLabel: "أو: شيل السائق من المحدد",
      current: (inv) => inv.driverName ?? "بدون سائق",
      // "none" is what the clear button puts in `value`, so an invoice that already has no driver
      // reads as unchanged instead of being sent a pointless clear.
      currentKey: (inv) => (inv.driverId ? String(inv.driverId) : "none"),
      apply: (inv, v) => updateInvoiceAttributes(inv.id, v === "none"
        ? { clearDriver: true }
        : { driverId: Number(v) }).then(() => undefined),
    },
    {
      key: "date", label: "التاريخ", kind: "date",
      current: (inv) => inv.date.slice(0, 10),
      apply: (inv, v) => updateInvoiceAttributes(inv.id, { date: new Date(v).toISOString() }).then(() => undefined),
    },
  ];

  async function handleExport() {
    const blob = await downloadInvoicesExcel(filter);
    triggerBlobDownload(blob, "invoices.xlsx");
  }

  // One click, straight from the list — no need to open the invoice's detail page first.
  // Fetches the full item-level invoice (the list rows don't carry items) then sends the same
  // template used everywhere else.
  async function handleSendWhatsApp(inv: InvoiceListItemDto, role: "merchant" | "farmer" | "driver") {
    const phone = role === "merchant" ? inv.merchantWhatsApp : role === "farmer" ? inv.farmerWhatsApp : inv.driverWhatsApp;
    const name = role === "merchant" ? inv.merchantName : role === "farmer" ? inv.farmerName : inv.driverName;
    if (!phone || !name) return;
    setSendingKey(`${inv.id}-${role}`);
    try {
      const invoice = await getInvoice(inv.id);
      // "الرصيد السابق": for the merchant it's already computed on the invoice itself (excludes
      // just this one invoice). For the farmer/driver it's their own account's current balance —
      // same "كشف حساب" figure their account page shows, per the same convention BulkPrintPage
      // uses for its per-farmer/per-driver WhatsApp sends.
      let previousBalance: number | undefined;
      if (role === "merchant") previousBalance = invoice.previousBalance;
      else if (role === "farmer" && invoice.farmerId) previousBalance = (await getFarmerAccount(invoice.farmerId)).remaining;
      else if (role === "driver" && invoice.driverId) previousBalance = (await getFarmerAccount(invoice.driverId)).remaining;
      // Commission is ONLY ever deducted on the farmer's own message — never merchant (§5), never
      // driver (no commission at all).
      const message = buildStatementMessage(companyName, companyPhone, name, [invoice], previousBalance, role);
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } finally {
      setSendingKey(null);
    }
  }

  // Shares the actual PDF as a FILE through the OS/browser's native share sheet — see
  // lib/share.ts for why there's no way to also pre-pick the recipient automatically. Falls back
  // to a plain download when the browser/OS can't share files at all. Doesn't need a known
  // WhatsApp number (unlike the text-send buttons below) since the person picks who to send it to
  // themselves in the share sheet.
  async function handleShareFile(inv: InvoiceListItemDto) {
    setSendingKey(`${inv.id}-share`);
    setNotice(null);
    try {
      const blob = await downloadInvoicePdf(inv.id, false);
      const fileName = `${inv.invoiceNumber}.pdf`;
      const result = await shareFile(blob, fileName, "application/pdf", `فاتورة ${inv.invoiceNumber}`);
      if (result === "unsupported") {
        triggerBlobDownload(blob, fileName);
        setNotice("متصفحك ما بيدعم المشاركة المباشرة — تم تنزيل ملف الفاتورة، ترفقه يدويًا بمحادثة واتساب.");
      }
    } finally {
      setSendingKey(null);
    }
  }

  /**
   * An invoice's own buttons: open it, edit it, send it, share the file, delete it.
   *
   * Defined once and rendered twice — in the desktop row and on the phone's card. They were
   * written into the row only, so on a phone the whole set was simply absent and the card
   * offered nothing but تفاصيل. A button that exists on one half is a button half the market
   * does not have, and the half that goes missing is always the phone's.
   */
  function rowActions(inv: InvoiceListItemDto) {
    return (
                    <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/invoices/${inv.id}`} className="text-brand-700 text-sm hover:underline">تفاصيل</Link>
                  {inv.status === "Active" && hasPermission("invoices.edit") && (
                    <Link to={`/invoices/${inv.id}/edit`} className="text-brand-700 text-sm hover:underline">✏️ تعديل</Link>
                  )}
                  {/* companyPhone is market.whatsapp — with no number set there is nobody for
                      the recipient to reply to, so the send options are not offered at all. */}
                  {companyPhone && inv.merchantWhatsApp && (
                    <button
                      className="btn-link text-xs text-green-700 hover:underline disabled:opacity-50"
                      title={`إرسال للمشتري ${inv.merchantName} عبر واتساب`}
                      disabled={sendingKey === `${inv.id}-merchant`}
                      onClick={() => handleSendWhatsApp(inv, "merchant")}
                    >
                      📤 مشتري
                    </button>
                  )}
                  {companyPhone && inv.farmerWhatsApp && (
                    <button
                      className="btn-link text-xs text-green-700 hover:underline disabled:opacity-50"
                      title={`إرسال للبائع ${inv.farmerName} عبر واتساب`}
                      disabled={sendingKey === `${inv.id}-farmer`}
                      onClick={() => handleSendWhatsApp(inv, "farmer")}
                    >
                      📤 بائع
                    </button>
                  )}
                  {companyPhone && inv.driverWhatsApp && (
                    <button
                      className="btn-link text-xs text-green-700 hover:underline disabled:opacity-50"
                      title={`إرسال للسائق ${inv.driverName} عبر واتساب`}
                      disabled={sendingKey === `${inv.id}-driver`}
                      onClick={() => handleSendWhatsApp(inv, "driver")}
                    >
                      📤 سائق
                    </button>
                  )}
                  <button
                    className="btn-link text-xs text-brand-700 hover:underline disabled:opacity-50"
                    title="مشاركة ملف الفاتورة (يفتح قائمة مشاركة النظام، فيها واتساب لو مثبت)"
                    disabled={sendingKey === `${inv.id}-share`}
                    onClick={() => handleShareFile(inv)}
                  >
                    📎 ملف
                  </button>
                  {canDelete && (
                    <button className="btn-link text-red-500 text-sm hover:underline" onClick={() => handleDelete(inv)}>حذف</button>
                  )}
                    </div>
    );
  }

  return (
    <div>
      {notice && <div className="text-sm text-blue-700 bg-blue-50 rounded-md p-3 mb-4">{notice}</div>}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-bold">الفواتير</h1>
        <div className="flex gap-2 flex-wrap">
          {hasPermission("reports.export") && (
            <button className="btn-secondary" onClick={handleExport}>تصدير Excel</button>
          )}
          {hasPermission("invoices.view") && (
            <Link to="/invoices/print" className="btn-secondary">🖨️ طباعة فواتير</Link>
          )}
          {hasPermission("invoices.create") && (
            <Link to="/invoices/new" className="btn-primary">+ فاتورة جديدة</Link>
          )}
        </div>
      </div>

      <div className="card p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="label">من تاريخ</label>
          <input
            type="date" className="input"
            value={filter.dateFrom ? filter.dateFrom.slice(0, 10) : ""}
            onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value ? startOfDay(new Date(e.target.value)).toISOString() : undefined, page: 1 }))}
          />
        </div>
        <div>
          <label className="label">إلى تاريخ</label>
          <input
            type="date" className="input"
            value={filter.dateTo ? filter.dateTo.slice(0, 10) : ""}
            onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value ? endOfDay(new Date(e.target.value)).toISOString() : undefined, page: 1 }))}
          />
        </div>
        <div>
          <label className="label">رقم الفاتورة</label>
          <input className="input" onChange={(e) => setFilter((f) => ({ ...f, invoiceNumber: e.target.value || undefined, page: 1 }))} />
        </div>
        <div>
          <label className="label">اسم الصنف</label>
          <input className="input" onChange={(e) => setFilter((f) => ({ ...f, itemName: e.target.value || undefined, page: 1 }))} />
        </div>
        {/* The three parties, and the amount. Every one of these was already understood by the
            list endpoint (InvoiceFilter.merchantId/farmerId/driverId, minAmount/maxAmount) and
            simply had nothing on screen to set it.

            They go in this panel rather than in a filter row under the table header, unlike every
            other table in the app: this list is paged by the SERVER, 25 rows at a time, so a
            filter that narrowed the rows already on screen would answer "كم فاتورة لأبو علي" with
            however many of his happen to be on the page you are looking at. */}
        <div>
          <label className="label">المشتري</label>
          <PartnerAutocomplete
            label="المشتري" labelHidden value={merchantPick}
            onChange={(p) => { setMerchantPick(p); setFilter((f) => ({ ...f, merchantId: p?.id, page: 1 })); }}
            types={["Merchant"]}
          />
        </div>
        <div>
          <label className="label">البائع</label>
          <PartnerAutocomplete
            label="البائع" labelHidden value={farmerPick}
            onChange={(p) => { setFarmerPick(p); setFilter((f) => ({ ...f, farmerId: p?.id, page: 1 })); }}
            types={["Farmer"]}
          />
        </div>
        <div>
          <label className="label">السائق</label>
          <PartnerAutocomplete
            label="السائق" labelHidden value={driverPick}
            onChange={(p) => { setDriverPick(p); setFilter((f) => ({ ...f, driverId: p?.id, page: 1 })); }}
            types={["Driver", "Farmer"]}
          />
        </div>
        <div>
          <label className="label">المبلغ من</label>
          <input
            type="number" className="input" step="0.01"
            onChange={(e) => setFilter((f) => ({ ...f, minAmount: e.target.value ? Number(e.target.value) : undefined, page: 1 }))}
          />
        </div>
        <div>
          <label className="label">المبلغ إلى</label>
          <input
            type="number" className="input" step="0.01"
            onChange={(e) => setFilter((f) => ({ ...f, maxAmount: e.target.value ? Number(e.target.value) : undefined, page: 1 }))}
          />
        </div>
        <div>
          <label className="label">حالة الدفع</label>
          <select className="input" value={filter.paymentStatus ?? ""}
            onChange={(e) => setFilter((f) => ({ ...f, paymentStatus: (e.target.value || undefined) as InvoicePaymentStatus | undefined, page: 1 }))}>
            <option value="">الكل</option>
            <option value="Unpaid">غير مدفوعة</option>
            <option value="Partial">مدفوعة جزئياً</option>
            <option value="Paid">مدفوعة</option>
          </select>
        </div>
        <div className="flex items-end">
          {/* The work queue for goods that went out before being priced — without it an unpriced
              invoice can sit forgotten indefinitely. */}
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
            <input type="checkbox" checked={filter.hasUnpricedItems === true}
              onChange={(e) => setFilter((f) => ({ ...f, hasUnpricedItems: e.target.checked || undefined, page: 1 }))} />
            غير مسعّرة فقط
          </label>
        </div>
        <div className="flex items-end">
          <button
            className="btn-secondary"
            onClick={() => setFilter((f) => ({ ...f, dateFrom: undefined, dateTo: undefined, page: 1 }))}
          >
            عرض كل التواريخ
          </button>
        </div>
        <div className="flex items-end">
          <button
            className="btn-secondary"
            onClick={() => {
              const now = new Date();
              setFilter((f) => ({ ...f, dateFrom: startOfDay(now).toISOString(), dateTo: endOfDay(now).toISOString(), page: 1 }));
            }}
          >
            اليوم
          </button>
        </div>
      </div>

      {bulkError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4 whitespace-pre-line">{bulkError}</div>}

      {selection.selected.size > 0 && (canDelete || canEdit) && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{selection.selected.size}</span></span>
          {canEdit && (
            <button className="btn-secondary text-sm" onClick={() => setBulkEditing(true)}>
              تعديل المحدد ({selection.selected.size})
            </button>
          )}
          {canDelete && (
            <button className="btn-danger text-sm" disabled={bulkDeleting} onClick={handleBulkDelete}>
              {bulkDeleting ? "جاري الحذف..." : `حذف المحدد (${selection.selected.size})`}
            </button>
          )}
        </div>
      )}

      {bulkEditing && (
        <BulkEditDialog
          rows={rows.filter((inv) => selection.selected.has(inv.id))}
          fields={bulkEditFields}
          label={(inv) => `${inv.invoiceNumber} — ${inv.merchantName}`}
          onClose={() => setBulkEditing(false)}
          onDone={async (message) => { setBulkError(message); selection.clear(); await refresh(); }}
        />
      )}

      <div className="card">
        {/* The busiest table in the app, and the one a phone served worst: twelve columns of which
            two were visible. The card leads with the buyer and the total — what somebody is
            looking for — and the rest is a tap away. */}
        <div className="sm:hidden">
          <CollapsibleRows
            rows={rows}
            rowKey={(inv) => inv.id}
            title={(inv) => (
              <>
                {inv.merchantName}
                <span className="block text-xs font-normal text-gray-500 font-mono">{inv.invoiceNumber}</span>
              </>
            )}
            value={(inv) => formatCurrency(inv.grandTotal)}
            leading={canDelete ? (inv) => (
              <input type="checkbox" checked={selection.selected.has(inv.id)} onChange={() => selection.toggleOne(inv.id)} />
            ) : undefined}
            details={(inv) => [
              { label: "التاريخ", value: formatDate(inv.date) },
              { label: "البائع", value: inv.farmerName || "—" },
              { label: "السائق", value: inv.driverName || "—" },
              { label: "الأصناف", value: inv.itemsSummary || "—" },
              { label: "القيمة", value: formatCurrency(inv.totalValue) },
              {
                label: "حالة الدفع",
                value: (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${PAYMENT_STATUS_CLASS[inv.paymentStatus]}`}>
                    {PAYMENT_STATUS_LABELS[inv.paymentStatus]}
                  </span>
                ),
              },
              { label: "الحالة", value: STATUS_LABELS[inv.status] ?? inv.status },
              { label: "", value: rowActions(inv) },
            ]}
            empty="لا توجد فواتير"
          />
        </div>
        <div className="hidden sm:block overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {canDelete && (
                <th className="w-8">
                  {/* "تحديد الكل" covers the rows CURRENTLY on screen (this page of this filter),
                      never the whole unfiltered table — see lib/useSelection. */}
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((inv) => selection.selected.has(inv.id))}
                    onChange={() => selection.toggleAll(rows.map((inv) => inv.id))}
                  />
                </th>
              )}
              <th>رقم الفاتورة</th>
              <th>التاريخ</th>
              <th>المشتري</th>
              <th>البائع</th>
              <th>السائق</th>
              <th>الأصناف</th>
              <th>الكمية</th>
              <th>القيمة</th>
              <th>الإجمالي</th>
              <th>حالة الدفع</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canDelete ? 13 : 12} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canDelete ? 13 : 12} className="text-center text-gray-400 py-6">لا توجد فواتير</td></tr>
            ) : (
              rows.map((inv) => (
                <tr key={inv.id}>
                  {canDelete && (
                    <td>
                      <input type="checkbox" checked={selection.selected.has(inv.id)} onChange={() => selection.toggleOne(inv.id)} />
                    </td>
                  )}
                  <td className="font-mono text-sm">
                    <InvoiceLink invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} />
                  </td>
                  <td>{formatDate(inv.date)}</td>
                  <td><PartnerLink partnerId={inv.merchantId} name={inv.merchantName} side="merchant" /></td>
                  {/* A driver's balance lives on the same account page a seller's does — they
                      share one ledger (see the backend FarmerTransaction). */}
                  <td><PartnerLink partnerId={inv.farmerId} name={inv.farmerName} side="seller" /></td>
                  <td><PartnerLink partnerId={inv.driverId} name={inv.driverName} side="seller" /></td>
                  <td className="text-gray-600 max-w-[16rem]">{inv.itemsSummary || "—"}</td>
                  <td>
                    {/* Not everything is sold by weight — a box-only invoice has totalWeightKg
                        === 0, which on its own looks like an empty/broken row, so show whichever
                        of the two actually apply instead of always printing "0.000 كغم". */}
                    {inv.totalWeightKg > 0 && <div>{formatWeight(inv.totalWeightKg)}</div>}
                    {inv.totalBoxes > 0 && <div>{formatCount(inv.totalBoxes)}</div>}
                    {inv.totalWeightKg === 0 && inv.totalBoxes === 0 && "—"}
                  </td>
                  {/* Two different figures, side by side on purpose: "القيمة" is the produce
                      alone (what the commission is taken on), "الإجمالي" is what the buyer is
                      actually charged — plus transport, wood and crate fees, net of any مرتجع
                      (see the backend InvoiceCharge). "باقي" below is measured against the
                      second one, which read as a mismatch while only the first was on screen. */}
                  <td>{formatCurrency(inv.totalValue)}</td>
                  <td className="font-semibold">{formatCurrency(inv.grandTotal)}</td>
                  <td className="whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${PAYMENT_STATUS_CLASS[inv.paymentStatus]}`}>
                      {PAYMENT_STATUS_LABELS[inv.paymentStatus]}
                    </span>
                    {inv.paidAmount > 0 && inv.remainingAmount > 0 && (
                      <div className="text-xs text-gray-500 mt-0.5">باقي: {formatCurrency(inv.remainingAmount)}</div>
                    )}
                    {inv.hasUnpricedItems && (
                      <div className="text-xs text-amber-700 mt-0.5">فيها أصناف غير مسعّرة</div>
                    )}
                  </td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${inv.status === "Active" ? "bg-brand-100 text-brand-800" : "bg-red-100 text-red-700"}`}>
                      {STATUS_LABELS[inv.status]}
                    </span>
                  </td>
                  <td>{rowActions(inv)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        {/* Paged by the BACKEND (page/pageSize go into the filter), so a year of invoices is never
            fetched just to show 25 — the shared bar just drives the server's own paging here. */}
        {result && (
          <TablePagination
            page={filter.page ?? 1}
            pageSize={filter.pageSize ?? 25}
            totalCount={result.totalCount}
            itemLabel="فاتورة"
            onPageChange={(page) => setFilter((f) => ({ ...f, page }))}
            onPageSizeChange={(pageSize) => setFilter((f) => ({ ...f, pageSize, page: 1 }))}
          />
        )}
      </div>
    </div>
  );
}
