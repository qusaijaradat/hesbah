import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { deleteInvoice, downloadInvoicePdf, downloadInvoicesExcel, getInvoice, listInvoices, triggerBlobDownload } from "../api/invoices";
import { getFarmerAccount } from "../api/partners";
import { listSettings } from "../api/settings";
import type { InvoiceFilter, InvoiceListItemDto, InvoicePaymentStatus } from "../types";
import { buildStatementMessage, buildWhatsAppLink, formatCurrency, formatDate, formatQuantity, formatWeight } from "../lib/format";
import { shareFile } from "../lib/share";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSelection } from "../lib/useSelection";
import { TablePagination } from "../components/TablePagination";
import { runBulkDelete, summarizeBulkDelete } from "../lib/bulkDelete";
import { InvoiceLink, PartnerLink } from "../components/RecordLinks";

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
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const rows = result?.items ?? [];

  useEffect(() => {
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      // The company phone shown inside the message — the same one the printed invoice header
      // carries. It used to read a separate "whatsapp.business_number" setting that held the same
      // fact under a name promising the app sent from it, which it never did.
      const phone = settings.find((s) => s.key === "market.phone")?.value;
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

  return (
    <div>
      {notice && <div className="text-sm text-blue-700 bg-blue-50 rounded-md p-3 mb-4">{notice}</div>}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-bold">الفواتير</h1>
        <div className="flex gap-2">
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

      {canDelete && selection.selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{selection.selected.size}</span></span>
          <button className="btn-danger text-sm" disabled={bulkDeleting} onClick={handleBulkDelete}>
            {bulkDeleting ? "جاري الحذف..." : `حذف المحدد (${selection.selected.size})`}
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
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
                    {inv.totalBoxes > 0 && <div>{formatQuantity(inv.totalBoxes, "Box")}</div>}
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
                  <td>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/invoices/${inv.id}`} className="text-brand-700 text-sm hover:underline">تفاصيل</Link>
                      {inv.status === "Active" && hasPermission("invoices.edit") && (
                        <Link to={`/invoices/${inv.id}/edit`} className="text-brand-700 text-sm hover:underline">✏️ تعديل</Link>
                      )}
                      {inv.merchantWhatsApp && (
                        <button
                          className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          title={`إرسال للمشتري ${inv.merchantName} عبر واتساب`}
                          disabled={sendingKey === `${inv.id}-merchant`}
                          onClick={() => handleSendWhatsApp(inv, "merchant")}
                        >
                          📤 مشتري
                        </button>
                      )}
                      {inv.farmerWhatsApp && (
                        <button
                          className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          title={`إرسال للبائع ${inv.farmerName} عبر واتساب`}
                          disabled={sendingKey === `${inv.id}-farmer`}
                          onClick={() => handleSendWhatsApp(inv, "farmer")}
                        >
                          📤 بائع
                        </button>
                      )}
                      {inv.driverWhatsApp && (
                        <button
                          className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          title={`إرسال للسائق ${inv.driverName} عبر واتساب`}
                          disabled={sendingKey === `${inv.id}-driver`}
                          onClick={() => handleSendWhatsApp(inv, "driver")}
                        >
                          📤 سائق
                        </button>
                      )}
                      <button
                        className="text-xs text-brand-700 hover:underline disabled:opacity-50"
                        title="مشاركة ملف الفاتورة (يفتح قائمة مشاركة النظام، فيها واتساب لو مثبت)"
                        disabled={sendingKey === `${inv.id}-share`}
                        onClick={() => handleShareFile(inv)}
                      >
                        📎 ملف
                      </button>
                      {canDelete && (
                        <button className="text-red-500 text-sm hover:underline" onClick={() => handleDelete(inv)}>حذف</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

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
