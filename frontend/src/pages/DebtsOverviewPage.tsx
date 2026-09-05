import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDebtsOverview, printDebtsOverviewPdf } from "../api/partners";
import { triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import type { PartnerDebtRow } from "../types";

/// <summary>
/// "قيمة الديون" overview page: one screen, 3 sections (بائع/سائق/مشتري), each listing everyone of
/// that type who currently has a non-zero balance (see backend PartnerService.GetDebtsOverviewAsync —
/// zero-balance people are already excluded server-side). Remaining uses the exact same formula/sign
/// convention as each person's own "كشف حساب" page, so drilling into any row here matches exactly.
/// A partner of type "بائع/مشتري" (Both) can legitimately appear in BOTH the بائع and المشتري
/// sections at once, each with its own independent balance — same as their two separate كشف حساب links.
/// </summary>
export function DebtsOverviewPage() {
  const [farmers, setFarmers] = useState<PartnerDebtRow[]>([]);
  const [drivers, setDrivers] = useState<PartnerDebtRow[]>([]);
  const [merchants, setMerchants] = useState<PartnerDebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  // Explicit request: "بس لما بدي اشيك على شخص معين" — a name filter for checking one person,
  // defaulting to empty (blank = show everyone, exactly as before this filter existed). Purely
  // client-side over the already-fully-loaded arrays above — the dataset here is every non-zero-
  // balance partner, never large enough to need a server round trip just to narrow it down.
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    getDebtsOverview()
      .then((data) => {
        setFarmers(data.farmers);
        setDrivers(data.drivers);
        setMerchants(data.merchants);
      })
      .catch((err) => setError(apiErrorMessage(err, "فشل تحميل قيمة الديون")))
      .finally(() => setLoading(false));
  }, []);

  async function handlePrint() {
    setPrinting(true);
    setPrintError(null);
    try {
      const blob = await printDebtsOverviewPdf();
      triggerBlobDownload(blob, `debts-overview-${todayLocalDateString()}.pdf`);
    } catch (err) {
      setPrintError(apiErrorMessage(err, "فشل إنشاء ملف الطباعة"));
    } finally {
      setPrinting(false);
    }
  }

  if (loading) return <div className="text-gray-500">جاري التحميل...</div>;

  const q = search.trim().toLowerCase();
  const matches = (r: PartnerDebtRow) => q === "" || r.name.toLowerCase().includes(q);
  const filteredFarmers = farmers.filter(matches);
  const filteredDrivers = drivers.filter(matches);
  const filteredMerchants = merchants.filter(matches);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <h1 className="text-2xl font-bold">قيمة الديون</h1>
        <button className="btn-secondary" onClick={handlePrint} disabled={printing}>
          {printing ? "جاري التجهيز..." : "🖨️ طباعة"}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        الأشخاص اللي عندهم رصيد غير صفري حاليًا فقط — نفس الرقم الظاهر بكشف حساب كل شخص.
      </p>

      <input
        className="input max-w-sm mb-6"
        placeholder="🔍 بحث بالاسم..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {printError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-4">{printError}</div>}
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-4">{error}</div>}

      <div className="space-y-8">
        <DebtSection
          title="الباعة"
          rows={filteredFarmers}
          linkFor={(id) => `/partners/${id}/farmer-account`}
          detailLinkFor={(id) => `/partners/${id}/farmer-invoice-detail`}
          owedToThemLabel="له من السوق"
          owedByThemLabel="عليه للسوق"
          emptyText={search ? "لا يوجد باعة مطابقين للبحث" : "لا يوجد باعة عليهم أو لهم رصيد حاليًا"}
        />
        <DebtSection
          title="السواق"
          rows={filteredDrivers}
          linkFor={(id) => `/partners/${id}/farmer-account`}
          detailLinkFor={(id) => `/partners/${id}/farmer-invoice-detail`}
          owedToThemLabel="له من السوق"
          owedByThemLabel="عليه للسوق"
          emptyText={search ? "لا يوجد سواق مطابقين للبحث" : "لا يوجد سواق عليهم أو لهم رصيد حاليًا"}
        />
        <DebtSection
          title="المشترين"
          rows={filteredMerchants}
          linkFor={(id) => `/partners/${id}/merchant-account`}
          detailLinkFor={(id) => `/partners/${id}/merchant-invoice-detail`}
          owedToThemLabel="له رصيد زائد (دفع أكتر)"
          owedByThemLabel="عليه دين للسوق"
          emptyText={search ? "لا يوجد مشترين مطابقين للبحث" : "لا يوجد مشترين عليهم أو لهم رصيد حاليًا"}
        />
      </div>
    </div>
  );
}

function DebtSection({
  title, rows, linkFor, detailLinkFor, owedToThemLabel, owedByThemLabel, emptyText,
}: {
  title: string;
  rows: PartnerDebtRow[];
  linkFor: (id: number) => string;
  /** Opens (in a new tab, per explicit request) the full invoice/item-level breakdown behind this
   * person's amount — see PartnerInvoiceDetailPage. */
  detailLinkFor: (id: number) => string;
  /** Shown when remaining > 0 — for باعة/سواق that means the market owes them; for مشتري that means they owe the market. */
  owedByThemLabel: string;
  /** Shown when remaining < 0 — the mirror-image case of the above. */
  owedToThemLabel: string;
  emptyText: string;
}) {
  const total = rows.reduce((sum, r) => sum + r.remaining, 0);

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">{title} <span className="text-sm font-normal text-gray-400">({rows.length})</span></h2>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>المبلغ</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-gray-400 py-6">{emptyText}</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.partnerId}>
                  <td className="font-medium">
                    <Link to={linkFor(r.partnerId)} className="hover:underline">{r.name}</Link>
                  </td>
                  <td className={r.remaining > 0 ? "text-red-700 font-semibold" : "text-brand-700 font-semibold"}>
                    {formatCurrency(Math.abs(r.remaining))}
                  </td>
                  <td className="text-xs text-gray-400">{r.remaining > 0 ? owedByThemLabel : owedToThemLabel}</td>
                  <td>
                    <a href={detailLinkFor(r.partnerId)} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline whitespace-nowrap">
                      عرض التفاصيل ↗
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-semibold border-t">
                <td className="text-gray-500">الصافي الإجمالي</td>
                <td colSpan={3} className={total > 0 ? "text-red-700" : total < 0 ? "text-brand-700" : ""}>
                  {formatCurrency(total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
