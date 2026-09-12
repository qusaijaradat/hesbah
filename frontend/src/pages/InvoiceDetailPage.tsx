import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cancelInvoice, downloadFarmerInvoicePdf, downloadInvoicePdf, getInvoice, printInvoicesBulkPdf } from "../api/invoices";
import { PdfActions } from "../components/PdfActions";
import { getFarmerAccount } from "../api/partners";
import { listSettings } from "../api/settings";
import type { InvoiceDto, InvoicePaymentStatus } from "../types";
import { InvoiceReturnsCard } from "../components/InvoiceReturnsCard";
import { buildStatementMessage, buildWhatsAppLink, formatCount, formatCurrency, formatDate, formatWeight } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { apiErrorMessage } from "../api/client";

const PAYMENT_STATUS_LABELS: Record<InvoicePaymentStatus, string> = {
  Unpaid: "غير مدفوعة", Partial: "مدفوعة جزئياً", Paid: "مدفوعة",
};
const PAYMENT_STATUS_CLASS: Record<InvoicePaymentStatus, string> = {
  Unpaid: "bg-red-100 text-red-700",
  Partial: "bg-amber-100 text-amber-800",
  Paid: "bg-brand-100 text-brand-800",
};

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Header info for the shared Arabic WhatsApp template (see lib/format.ts buildStatementMessage) —
  // same company name/phone the bulk-print page uses, so a single-invoice message and a bulk
  // trader statement read as the same template no matter which one gets sent.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);

  // Tracks which WhatsApp button is mid-send (fetching a farmer/driver's live account balance
  // takes a round trip) so only that one button shows a busy state.
  const [sendingRole, setSendingRole] = useState<"merchant" | "farmer" | "driver" | null>(null);

  function reloadInvoice() {
    if (id) getInvoice(Number(id)).then(setInvoice);
  }

  useEffect(() => {
    reloadInvoice();
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      // The company phone shown inside the message — the same one the printed invoice header
      // carries. It used to read a separate "whatsapp.business_number" setting that held the same
      // fact under a name promising the app sent from it, which it never did.
      const phone = settings.find((s) => s.key === "market.phone")?.value;
      if (name) setCompanyName(name);
      setCompanyPhone(phone || null);
    });
  }, [id]);

  // Sends the invoice details as a WhatsApp text message only — no PDF file, no download,
  // no manual attach step. Just the numbers, straight to WhatsApp in one click.
  // "الرصيد السابق": for the merchant it's already computed on the invoice itself (excludes just
  // this one invoice). For the farmer/driver it's their own account's current balance — same
  // "كشف حساب" figure their account page shows, per the same convention used on InvoicesPage.tsx
  // and BulkPrintPage.tsx.
  async function handleSendWhatsApp(phone: string, partnerName: string, role: "merchant" | "farmer" | "driver") {
    if (!invoice) return;
    setSendingRole(role);
    try {
      let previousBalance: number | undefined;
      if (role === "merchant") previousBalance = invoice.previousBalance;
      else if (role === "farmer" && invoice.farmerId) previousBalance = (await getFarmerAccount(invoice.farmerId)).remaining;
      else if (role === "driver" && invoice.driverId) previousBalance = (await getFarmerAccount(invoice.driverId)).remaining;
      // Commission is ONLY ever deducted on the farmer's own message — never merchant (§5), never
      // driver (no commission at all).
      const message = buildStatementMessage(companyName, companyPhone, partnerName, [invoice], previousBalance, role);
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } finally {
      setSendingRole(null);
    }
  }

  // Opens the invoice's PDF (Arabic header, no invoice number, per lib/format.ts template) in a
  // new tab rather than forcing a download — the browser's own PDF viewer has a print icon right
  // there, so one click gets you from "viewing the invoice" to "printing it".
  // Each party's own document, printable AND shareable (PdfActions): the buyer's copy, the seller's
  // نسخة البائع which shows and deducts this invoice's commission (ExportService.GenerateFarmerInvoicePdf),
  // and the driver's فاتورة سائق — the same one the bulk-print سائق tab produces, for a single invoice.
  // Sharing used to exist for the buyer's copy alone, so a seller could be handed his paper but never
  // his file.


  async function handleCancel() {
    if (!invoice) return;
    const reason = window.prompt("سبب الإلغاء:");
    if (reason === null) return; // explicit Cancel
    // Pressing "موافق" with an empty box previously fell through as a valid (blank) reason and
    // cancelled immediately — an almost-irreversible action deserves an actual typed reason, not
    // an accidental empty click.
    if (!reason.trim()) { alert("يرجى كتابة سبب الإلغاء."); return; }
    // Second, explicit confirmation step before an action that can't be undone (there is
    // deliberately no "un-cancel" — see CancelAsync's own doc comment).
    if (!window.confirm(`تأكيد إلغاء الفاتورة رقم ${invoice.invoiceNumber}؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
    setError(null);
    try {
      const updated = await cancelInvoice(invoice.id, reason);
      setInvoice(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إلغاء الفاتورة"));
    }
  }

  if (!invoice) return <div className="text-gray-500">جاري التحميل...</div>;

  // Not everything on the invoice is sold by weight — a box-unit line has its own total
  // instead of being folded into (or silently dropped from) the weight figure.
  // Every line's own عدد الصناديق, whatever it was priced by. It used to count only box-UNIT lines,
  // so crates that went out with produce sold by weight were not in this total at all.
  const totalBoxes = invoice.items.reduce((sum, it) => sum + it.boxQuantity, 0);
  const totalCartons = invoice.items.reduce((sum, it) => sum + it.cartonQuantity, 0);

  return (
    <div className="max-w-2xl">
      <Link to="/invoices" className="text-sm text-brand-700 hover:underline">← رجوع إلى قائمة الفواتير</Link>

      <div className="card p-6 mt-3">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-xl font-bold">فاتورة مشتري {invoice.invoiceNumber}</h1>
            <div className="text-sm text-gray-500">{formatDate(invoice.date)}</div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${invoice.status === "Active" ? "bg-brand-100 text-brand-800" : "bg-red-100 text-red-700"}`}>
            {invoice.status === "Active" ? "فعّالة" : "ملغاة"}
          </span>
        </div>

        {/* البائع/السائق deليberately لا يظهروا هون — هاي الفاتورة اللي بتوصل للمشتري، وما لازم
            يشوف مين جاب/وصّل البضاعة (طلب صريح). لسا ظاهرين بنموذج إدخال الفاتورة وبأزرار
            الواتساب تحت لأنها أدوات داخلية للموظف، مش عرض على الفاتورة نفسها. */}
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div><span className="text-gray-500">المطلوب من:</span> <span className="font-medium">{invoice.merchantName}</span></div>
        </div>

        {/* العدد/الوزن يحلّان محل عمود "الكمية" المدمج — مشتقّان مباشرة من الكمية/الوحدة (نفس
            منطق الفاتورة المطبوعة A4، انظر ExportService.GenerateInvoicePdf): العدد دايمًا معبّى،
            والوزن بس إذا انوزن الصنف — ووجود الوزن هو اللي بحدد كيف انحسب السطر. */}
        <div className="overflow-x-auto mb-4">
          <table className="table-base">
            <thead>
              <tr><th>الصنف</th><th>العدد</th><th>الوزن</th><th>السعر</th><th>صناديق</th><th>كرتون</th><th>سعر الخشب</th><th>الإجمالي</th></tr>
            </thead>
            <tbody>
              {/* pricePerUnit == 0 means "not priced yet", not "free" — the item can be added to
                  the invoice before it's priced and priced later via "تعديل الفاتورة" (see
                  InvoiceNewPage/InvoiceEditPage's optional price field). Flagged here instead of
                  silently showing ₪0.00 so it's obvious at a glance which lines still need a price. */}
              {invoice.items.map((item) => {
                const unpriced = item.pricePerUnit === 0;
                return (
                  <tr key={item.id} className={unpriced ? "bg-amber-50" : undefined}>
                    <td>{item.itemName}</td>
                    <td>{formatCount(item.quantity)}</td>
                    <td>{formatWeight(item.weightKg ?? 0)}</td>
                    <td className={unpriced ? "text-amber-700 font-medium" : undefined}>
                      {unpriced ? "غير مسعّر" : formatCurrency(item.pricePerUnit)}
                    </td>
                    <td>{item.boxQuantity > 0 ? formatCount(item.boxQuantity) : "—"}</td>
                    <td>{item.cartonQuantity > 0 ? formatCount(item.cartonQuantity) : "—"}</td>
                    <td>{item.woodPrice > 0 ? formatCurrency(item.woodPrice) : "—"}</td>
                    <td className={unpriced ? "text-amber-700 font-medium" : "font-medium"}>
                      {unpriced ? "غير مسعّر" : formatCurrency(item.lineTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm">
          <div className="flex flex-wrap gap-4">
            {invoice.totalWeightKg > 0 && (
              <div className="text-gray-500">إجمالي الوزن: <span className="font-semibold text-gray-900">{formatWeight(invoice.totalWeightKg)}</span></div>
            )}
            {totalBoxes > 0 && (
              <div className="text-gray-500">إجمالي الصناديق: <span className="font-semibold text-gray-900">{formatCount(totalBoxes)}</span></div>
            )}
            {totalCartons > 0 && (
              <div className="text-gray-500">إجمالي الكرتون: <span className="font-semibold text-gray-900">{formatCount(totalCartons)}</span></div>
            )}
            {invoice.woodTotal > 0 && (
              <div className="text-gray-500">إجمالي الخشب: <span className="font-semibold text-gray-900">{formatCurrency(invoice.woodTotal)}</span></div>
            )}
            {invoice.boxFeeTotal > 0 && (
              <div className="text-gray-500">رسوم الصناديق: <span className="font-semibold text-gray-900">{formatCurrency(invoice.boxFeeTotal)}</span></div>
            )}
            {/* Not part of the buyer's total — it comes off the seller and goes to the driver
                (see the backend InvoiceCharge), so the label says whose it is. */}
            {invoice.transportFee > 0 && (
              <div className="text-gray-500">أجرة النقل (على البائع، للسائق): <span className="font-semibold text-gray-900">{formatCurrency(invoice.transportFee)}</span></div>
            )}
            {/* Both are already subtracted inside grandTotal — shown so the total below never
                looks smaller than the lines add up to for no visible reason. */}

            {invoice.returnsTotal > 0 && (
              <div className="text-gray-500">مرتجع: <span className="font-semibold text-red-600">- {formatCurrency(invoice.returnsTotal)}</span></div>
            )}
          </div>
          <div className="text-end">
            <div className="text-lg font-bold text-brand-700">{formatCurrency(invoice.grandTotal)}</div>
            {/* Settlement for THIS invoice specifically — the merchant's overall balance says
                nothing about whether this one is paid. An uncleared check does not count. */}
            <div className="text-xs mt-1">
              <span className={`px-2 py-0.5 rounded-full ${PAYMENT_STATUS_CLASS[invoice.paymentStatus]}`}>
                {PAYMENT_STATUS_LABELS[invoice.paymentStatus]}
              </span>
              {invoice.paidAmount > 0 && (
                <span className="text-gray-500 ms-2">مدفوع: <span className="font-semibold text-gray-900">{formatCurrency(invoice.paidAmount)}</span></span>
              )}
              {invoice.remainingAmount > 0 && (
                <span className="text-gray-500 ms-2">باقي: <span className="font-semibold text-gray-900">{formatCurrency(invoice.remainingAmount)}</span></span>
              )}
            </div>
            {/* What the market keeps out of this one invoice — commission + رسوم الصناديق + سعر
                الخشب − أجرة صناديق السائق, net of commission handed back on any مرتجع. Computed
                by the backend's MarketEarnings, the same function the daily closing uses, so this
                and the day's profit cannot disagree. This screen is behind invoices.view and
                never reaches a buyer or a seller — the commission it is built from must not. */}
            <div className="text-xs text-gray-500 mt-2">
              ربح المصلحة من هذه الفاتورة:{" "}
              <span className={`font-semibold ${invoice.marketProfit >= 0 ? "text-brand-700" : "text-red-600"}`}>
                {formatCurrency(invoice.marketProfit)}
              </span>
            </div>
          </div>
        </div>

        {/* الرصيد السابق: ما تبقى على هذا المشتري من كل فواتيره الفعّالة الأخرى مطروحًا منه كل
            دفعاته (انظر InvoiceService.ComputePreviousBalanceAsync) — نفس السطر الظاهر على
            الفاتورة المطبوعة (ExportService.GenerateInvoicePdf). */}
        {invoice.previousBalance > 0 && (
          <div className="flex flex-wrap justify-between gap-2 border-t pt-3 mt-3 text-sm">
            <div className="text-gray-500">الرصيد السابق: <span className="font-semibold text-gray-900">{formatCurrency(invoice.previousBalance)}</span></div>
            <div className="text-lg font-bold text-red-700">الإجمالي المستحق: {formatCurrency(invoice.grandTotal + invoice.previousBalance)}</div>
          </div>
        )}

        {/* Explicit request: the invoice-details screen itself must never show the commission —
            not even in this "staff only" form. Commission only ever appears on (a) the "نسخة
            البائع" print/WhatsApp send (handlePrintFarmerCopy / handleSendWhatsApp below, both
            unaffected by this) and (b) the daily-closing/reports screens. Previously this panel
            showed a commission breakdown right here whenever a farmer was attached; removed
            entirely rather than just hiding the commission line, since showing "الصافي المستحق
            للبائع" alone still implies/backs into the same commission figure it was computed
            from. Staff can still see the farmer's own net-due total on their account page
            (كشف حساب البائع) or by printing/sending the نسخة البائع itself. */}

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mt-4">{error}</div>}

        <div className="flex justify-end gap-2 mt-6 flex-wrap">
          <PdfActions
            fetchPdf={() => downloadInvoicePdf(invoice.id, false)}
            fileName={`${invoice.invoiceNumber}.pdf`}
            shareTitle={`فاتورة ${invoice.invoiceNumber}`}
            printMode="tab"
            printLabel="🖨️ طباعة (A4)"
          />
          <PdfActions
            fetchPdf={() => downloadInvoicePdf(invoice.id, true)}
            fileName={`${invoice.invoiceNumber}-80mm.pdf`}
            shareTitle={`فاتورة ${invoice.invoiceNumber}`}
            printMode="tab"
            printLabel="🖨️ طباعة (طابعة حرارية 80mm)"
          />
          {invoice.farmerId && (
            <PdfActions
              fetchPdf={() => downloadFarmerInvoicePdf(invoice.id)}
              fileName={`${invoice.invoiceNumber}-بائع.pdf`}
              shareTitle={`فاتورة بائع ${invoice.invoiceNumber}`}
              printMode="tab"
              printLabel="🖨️ نسخة البائع (مع العمولة)"
            />
          )}
          {invoice.driverId && (
            <PdfActions
              fetchPdf={() => printInvoicesBulkPdf([invoice.id], "Driver")}
              fileName={`${invoice.invoiceNumber}-سائق.pdf`}
              shareTitle={`فاتورة سائق ${invoice.invoiceNumber}`}
              printMode="tab"
              printLabel="🖨️ نسخة السائق"
            />
          )}
          {invoice.merchantWhatsApp && (
            <button className="btn-primary" disabled={sendingRole === "merchant"} onClick={() => handleSendWhatsApp(invoice.merchantWhatsApp!, invoice.merchantName, "merchant")}>
              {sendingRole === "merchant" ? "جاري التجهيز..." : "📤 إرسال للمشتري عبر واتساب"}
            </button>
          )}
          {invoice.farmerWhatsApp && invoice.farmerName && (
            <button className="btn-primary" disabled={sendingRole === "farmer"} onClick={() => handleSendWhatsApp(invoice.farmerWhatsApp!, invoice.farmerName!, "farmer")}>
              {sendingRole === "farmer" ? "جاري التجهيز..." : "📤 إرسال للبائع عبر واتساب"}
            </button>
          )}
          {invoice.driverWhatsApp && invoice.driverName && (
            <button className="btn-primary" disabled={sendingRole === "driver"} onClick={() => handleSendWhatsApp(invoice.driverWhatsApp!, invoice.driverName!, "driver")}>
              {sendingRole === "driver" ? "جاري التجهيز..." : "📤 إرسال للسائق عبر واتساب"}
            </button>
          )}
          {invoice.status === "Active" && hasPermission("invoices.edit") && (
            <Link to={`/invoices/${invoice.id}/edit`} className="btn-secondary">
              ✏️ تعديل الفاتورة
            </Link>
          )}
          {invoice.status === "Active" && hasPermission("invoices.cancel") && (
            <button className="btn-danger" onClick={() => { setCancelling(true); handleCancel().finally(() => setCancelling(false)); }} disabled={cancelling}>
              إلغاء الفاتورة
            </button>
          )}
        </div>
      </div>

      {/* "مرتجع بضاعة" — its own card under the invoice, since a return is its own dated
          document rather than an edit to the invoice above it. */}
      <InvoiceReturnsCard
        invoice={invoice}
        canManage={hasPermission("invoices.returns")}
        onChanged={reloadInvoice}
      />
    </div>
  );
}
