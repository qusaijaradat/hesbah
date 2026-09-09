using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>WoodPrice ("سعر الخشب") is optional — a flat per-line add-on picked from a small fixed
/// set of values (3/5/6/7/8), 0 when left unset. Not multiplied by Quantity.</summary>
public record InvoiceItemInput(string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal WoodPrice = 0);

/// <summary>
/// MerchantId/FarmerId/DriverId are optional: if omitted, the matching *Name is used to look up an
/// existing partner by name (case-insensitive) or create a new one on the fly — the market has a
/// different trader/seller/driver most days, so forcing a separate "add partner first" step for
/// every invoice would just get in the way. Exactly one of {Id, Name} must be supplied for each
/// side that's being set at all. FarmerId/DriverId are independent of each other — an invoice can
/// have either, both, or neither. TransportFee ("أجرة النقل") is optional, defaulting to 0.
///
/// There is no "paid on the spot" field. Payment normally comes AFTER the invoices are entered,
/// not during — so the shortcut asked staff to fill in something they did not know yet, and its
/// only real effect was a half-filled check line blocking an invoice that was otherwise ready.
/// Payments are recorded from the Payments page, or on the invoice's own edit screen.
/// </summary>
public record CreateInvoiceRequest(
    DateTimeOffset Date,
    int? MerchantId,
    string? MerchantName,
    int? FarmerId,
    string? FarmerName,
    int? DriverId,
    string? DriverName,
    IReadOnlyList<InvoiceItemInput> Items,
    decimal TransportFee = 0);

public record InvoiceItemDto(int Id, string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal WoodPrice, decimal LineTotal);

/// <summary>
/// The merchant-facing view. GrandTotal/PreviousBalance stay exactly as before — requirement doc
/// §5's "the market's commission does not appear on the merchant's invoice" is honored by simply
/// never printing/messaging Commission/NetDueToFarmer below on anything that reaches the merchant
/// (see ExportService.GenerateInvoicePdf's own doc comment — still commission-free). GrandTotal =
/// TotalValue + TransportFee + WoodTotal + BoxFeeTotal — the actual amount the merchant pays,
/// including the pass-through transport/crate/box costs that are excluded from TotalValue
/// specifically so they never inflate the commission base. PreviousBalance is computed
/// (not stored) in InvoiceService — the merchant's manually-entered "الرصيد الافتتاحي"
/// (Partner.OpeningBalance) plus what they still owed from every one of their OTHER Active
/// invoices, minus every payment they've ever made, clamped to 0 (never shown negative even if
/// they're in credit). Printed on the invoice as "الرصيد السابق" added on top of GrandTotal, so
/// a newly-printed invoice always shows the full amount actually due, not just this one sale.
///
/// TotalBoxes/BoxPriceApplied/BoxFeeTotal (explicit request): TotalBoxes is this invoice's own
/// box-unit item count; BoxPriceApplied is the "سعر الصندوق" settings value locked in at this
/// invoice's creation time (Invoice.BoxPriceApplied); BoxFeeTotal = TotalBoxes × BoxPriceApplied,
/// computed fresh on every read (never stored) — same treatment as WoodTotal. Completely separate
/// from/additive to WoodTotal — both can be non-zero on the same invoice at once.
///
/// DriverBoxFeeApplied/DriverBoxFeeTotal (explicit request): the driver-side counterpart of
/// BoxPriceApplied/BoxFeeTotal above, but money owed TO the driver rather than charged to the
/// merchant — DriverBoxFeeTotal = TotalBoxes × DriverBoxFeeApplied (Invoice.DriverBoxFeeApplied,
/// the "أجرة الصناديق" settings value locked in at creation time). Deliberately excluded from
/// GrandTotal below (which stays the merchant-facing amount) — shown only on driver-facing
/// surfaces (ExportService.GenerateDriverManifestPdf), where it's added to the driver's own total.
///
/// Commission is this one invoice's own commission math (CommissionCalculator over
/// TotalValue/CommissionRateApplied — never TotalValue+WoodTotal/TransportFee/BoxFeeTotal, same
/// base the linked FarmerTransaction.Commission already uses, so this can never drift from the
/// farmer's own ledger). NetDueToFarmer = TotalValue - Commission + WoodTotal (explicit
/// requirement: the farmer is paid the FULL wood-price amount too, on top of what the merchant is
/// separately charged for it above — never reduced by the commission, same flat treatment
/// FarmerTransaction.Amount already gets) — this is the actual amount the farmer is owed for this
/// invoice, matching FarmerTransaction.Amount on their Sale row exactly. Both are computed even
/// when FarmerId is null (harmless, just meaningless/unused by the frontend then) — only ever
/// shown on farmer-facing surfaces (the "نسخة البائع" print, and the "إرسال للبائع" WhatsApp
/// message), never on anything the merchant sees.
/// </summary>
public record InvoiceDto(
    int Id, string InvoiceNumber, DateTimeOffset Date,
    int MerchantId, string MerchantName, string? MerchantWhatsApp,
    int? FarmerId, string? FarmerName, string? FarmerWhatsApp,
    int? DriverId, string? DriverName, string? DriverWhatsApp,
    InvoiceStatus Status,
    decimal TotalWeightKg, decimal TotalValue, decimal TransportFee, decimal WoodTotal,
    decimal TotalBoxes, decimal BoxPriceApplied, decimal BoxFeeTotal,
    decimal DriverBoxFeeApplied, decimal DriverBoxFeeTotal,
    decimal GrandTotal,
    decimal PreviousBalance,
    decimal CommissionRateApplied, decimal Commission, decimal NetDueToFarmer,
    // "قيمة المرتجع" — already subtracted inside GrandTotal above, broken out on its own so the
    // invoice can show WHY the total is lower than the lines add up to, same "never let a figure
    // disappear silently into a total" convention as WoodTotal/BoxFeeTotal.
    decimal ReturnsTotal,
    // What has actually been collected against THIS invoice (payments linked to it that count —
    // an uncleared check does not, see PaymentRules), what is left, and where that leaves it.
    // The merchant's overall balance says nothing about one invoice; this does.
    decimal PaidAmount, decimal RemainingAmount, InvoicePaymentStatus PaymentStatus,
    // What the MARKET keeps out of this one invoice, net of the commission it hands back on any
    // مرتجع — commission + رسوم الصناديق + سعر الخشب − أجرة صناديق السائق, plus the transport if
    // no driver was attached to pass it to. Computed by MarketEarnings, the same function the
    // daily closing and the market report use, so this figure and those can never disagree.
    // Never stored, and never shown on anything that reaches a buyer or a seller.
    decimal MarketProfit,
    // True when any line is still at price 0 — goods that went out before being priced.
    bool HasUnpricedItems,
    IReadOnlyList<InvoiceItemDto> Items,
    IReadOnlyList<GoodsReturnDto> Returns);

/// <summary>
/// MerchantId/MerchantWhatsApp let the bulk-print page group the filtered list by trader
/// identity (not just by display name, which two different partners could share) and offer
/// a per-trader "send via WhatsApp" action without a second round trip just to look those up.
/// FarmerWhatsApp/DriverWhatsApp mirror it for the seller/driver sides, so the plain invoices list
/// can also offer a one-click WhatsApp send per row without navigating into the invoice's detail
/// page first. DriverId mirrors MerchantId for the same reason — grouping by driver identity for
/// the "طباعة كشف السائق" (driver manifest) print, rather than by display name alone, which two
/// different drivers could share. TotalBoxes sits alongside TotalWeightKg because not everything
/// is sold by weight — an invoice made entirely of box-unit items has TotalWeightKg == 0, which on
/// its own looks like a broken/empty invoice in a list view; showing the box count too tells the
/// real story.
/// </summary>
public record InvoiceListItemDto(
    int Id, string InvoiceNumber, DateTimeOffset Date,
    int MerchantId, string MerchantName, string? MerchantWhatsApp,
    // FarmerId mirrors DriverId — the bulk-print page's farmer WhatsApp grouping needs a stable
    // identity to group by (two farmers can share a display name), not just FarmerName/WhatsApp.
    int? FarmerId, string? FarmerName, string? FarmerWhatsApp,
    int? DriverId, string? DriverName, string? DriverWhatsApp,
    InvoiceStatus Status,
    decimal TotalWeightKg, decimal TotalBoxes, decimal TotalValue, decimal TransportFee, decimal GrandTotal,
    // "، "-joined distinct item names on this invoice (e.g. "طماطم، خيار، بندورة") so the list view
    // answers "ايش الاصناف" without opening the invoice — see InvoiceService.ListAsync.
    string ItemsSummary,
    // GrandTotal already folds this in — broken out on its own too so a print/list view can show
    // "سعر الخشب" as its own visible figure instead of it disappearing silently into GrandTotal.
    decimal WoodTotal,
    // Same "broken out for visibility" treatment as WoodTotal above, for the automatic "سعر
    // الصندوق" fee (see InvoiceDto's own doc comment) — already folded into GrandTotal.
    decimal BoxFeeTotal,
    // Bulk-print page's per-type sections ("قسم بائع/سائق/مشتري"): each person's CURRENT overall
    // account balance (same Remaining figure their own كشف حساب page shows — already includes their
    // opening balance and, for a merchant, every invoice's own wood total) shown alongside every one
    // of their invoices, not just one. FarmerRemaining/DriverRemaining are null when the invoice has
    // no farmer/driver attached — see InvoiceService.ListAsync for how these are batch-computed.
    decimal MerchantRemaining, decimal? FarmerRemaining, decimal? DriverRemaining,
    // Each bulk-print section shows only its OWN side's money (explicit request: "بكل قسم بدي
    // اطبع الفواتير الخاصة فيه"), so the list row has to carry the farmer's and the driver's
    // figures too — not just the merchant-facing TotalValue/GrandTotal it used to. These are the
    // exact same numbers the matching printed copy shows (see ExportService.InvoiceCard), so the
    // screen and the paper can't disagree:
    //   Commission / NetDueToFarmer — TotalValue × the invoice's own locked-in rate, and
    //     InvoiceCharge.ForSeller: TotalValue − Commission − TransportFee. No wood — that is the
    //     market's. Same math as InvoiceService.ToDto.
    //   DriverBoxFeeTotal / DriverDue — TotalBoxes × the invoice's own locked-in أجرة الصناديق
    //     rate, and TransportFee + that, matching the driver's own ledger row. No wood either:
    //     the buyer pays سعر الخشب and the market keeps it.
    // All four are computed even when no farmer/driver is attached (harmless and unused then),
    // same convention as InvoiceDto's own Commission/NetDueToFarmer.
    decimal Commission, decimal NetDueToFarmer,
    // Per-invoice settlement, so the list can answer "مين دافع؟" at a glance and be filtered by
    // it — see InvoicePaymentStatus. ReturnsTotal is already inside GrandTotal.
    decimal DriverBoxFeeTotal, decimal DriverDue,
    decimal ReturnsTotal,
    decimal PaidAmount, decimal RemainingAmount, InvoicePaymentStatus PaymentStatus,
    bool HasUnpricedItems);

/// <summary>Requirement doc §7 filters: date range, merchant, farmer/driver, item, user, invoice number, weight, amount.</summary>
public class InvoiceFilterRequest
{
    public DateTimeOffset? DateFrom { get; set; }
    public DateTimeOffset? DateTo { get; set; }
    public int? MerchantId { get; set; }
    public int? FarmerId { get; set; }
    public int? DriverId { get; set; }

    /// <summary>Bulk-print page's "قسم بائع"/"قسم سائق": true = only invoices that HAVE a
    /// farmer/driver attached (any one), used when that section's own farmer/driver picker is left
    /// blank — so the section still only ever shows بائع/سائق invoices instead of silently falling
    /// back to every invoice. Ignored (no extra filtering) when null/false.</summary>
    public bool? HasFarmer { get; set; }
    public bool? HasDriver { get; set; }

    /// <summary>
    /// Bulk-print page's per-section "استثناء أسماء" filter: drop every invoice whose
    /// merchant/farmer/driver is one of these people, so a print run can cover "everyone this
    /// week EXCEPT these two" without picking the rest one by one. Each section only ever fills
    /// the list matching its OWN role (the بائع section excludes باعة, the مشتري section
    /// مشترين, the سائق section سواق — explicit request), which is exactly why these are three
    /// separate lists instead of one shared "exclude these partners": excluding a name on the
    /// مشتري section must not also drop invoices where that same person happens to be the بائع.
    /// Null/empty = no exclusion. Excluding a partner never drops invoices that simply have no
    /// farmer/driver attached — only ones actually belonging to an excluded person.
    /// </summary>
    public List<int>? ExcludeMerchantIds { get; set; }
    public List<int>? ExcludeFarmerIds { get; set; }
    public List<int>? ExcludeDriverIds { get; set; }

    /// <summary>"الفواتير غير المدفوعة" — narrows to invoices in one payment state. Computed
    /// server-side from this invoice's own linked payments (see InvoicePaymentStatus), because
    /// the list is paged by the backend and filtering it in the browser would only ever filter
    /// the page you can already see.</summary>
    public InvoicePaymentStatus? PaymentStatus { get; set; }

    /// <summary>"فواتير فيها أصناف غير مسعّرة" — true = only invoices carrying at least one line
    /// still at price 0. Goods go out unpriced and get priced later; without this there is no
    /// list of what is still waiting, and an invoice can sit unpriced indefinitely.</summary>
    public bool? HasUnpricedItems { get; set; }

    public string? ItemName { get; set; }
    public int? CreatedByUserId { get; set; }
    public string? InvoiceNumber { get; set; }

    /// <summary>Bulk-print page (requirement: "print invoices from # to #") — an inclusive range on
    /// InvoiceNumber. Compared as plain strings: since invoice numbers are zero-padded within a
    /// year (INV-2026-000123), string order matches numeric order as long as both bounds share a
    /// year; a range spanning a year boundary is a rare enough edge case not worth the extra complexity.</summary>
    public string? InvoiceNumberFrom { get; set; }
    public string? InvoiceNumberTo { get; set; }

    public decimal? MinWeightKg { get; set; }
    public decimal? MaxWeightKg { get; set; }
    public decimal? MinAmount { get; set; }
    public decimal? MaxAmount { get; set; }
    public InvoiceStatus? Status { get; set; }

    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
}

/// <summary>
/// Whose copy of an invoice a bulk print run produces (explicit request: "عند الضغط على طباعة
/// فاتورة سائق أو بائع أو مشتري، تتم طباعة فاتورة السائق إذا كان نوعه سائق ... وليس فاتورة نوع
/// آخر"). The bulk-print page's three sections each print their OWN side's document: the same
/// invoices, but with that side's counterparty, its own money, and nothing that belongs to the
/// other two (no commission on a driver's copy, no merchant grand total on a farmer's, and so on)
/// — see ExportService.InvoiceCard for exactly what each one shows.
/// </summary>
/// <summary>
/// Where an invoice stands against what has actually been collected on it — the answer to the
/// question a market asks all day ("هاي الفاتورة انسدّدت؟"), which used to need a trip to the
/// Payments page because a merchant's balance is global and says nothing about one invoice.
/// Derived, never stored: it is purely GrandTotal vs. the payments linked to this invoice that
/// actually count (an uncleared check does not — see Domain.Services.PaymentRules).
/// </summary>
public enum InvoicePaymentStatus
{
    /// <summary>Nothing collected on it yet.</summary>
    Unpaid = 1,
    /// <summary>Something collected, but less than the invoice charges.</summary>
    Partial = 2,
    /// <summary>Settled in full (or overpaid).</summary>
    Paid = 3
}

public enum InvoicePrintRole
{
    Merchant,
    Farmer,
    Driver
}

public record CancelInvoiceRequest(string Reason);

/// <summary>
/// Bulk-print page's merchant-section print button: "several invoices for the same merchant on
/// the same calendar day print as ONE combined invoice, regardless of which farmer/driver
/// supplied each one" (explicit request) — see InvoicesController.PrintMerchantMergedPdf for how
/// invoices are grouped by (MerchantId, Date.Date) and folded into one of these per group before
/// ExportService.GenerateMergedInvoicesPdf renders it. Items is every constituent invoice's own
/// item rows concatenated (not re-merged by name) so each line still traces back to what was
/// actually entered; the totals below are the group's own sums, same components as
/// InvoiceDto.GrandTotal. PreviousBalance is the group's own — computed once, excluding every
/// invoice in the WHOLE group at once (IInvoiceService.GetMerchantGroupPreviousBalanceAsync),
/// never a single invoice's own PreviousBalance.
/// </summary>
public record MergedInvoiceGroupDto(
    string MerchantName, DateTimeOffset Date,
    IReadOnlyList<InvoiceItemDto> Items,
    decimal TotalWeightKg, decimal TotalValue, decimal WoodTotal, decimal BoxFeeTotal, decimal TransportFee, decimal GrandTotal,
    decimal PreviousBalance);

/// <summary>
/// One row of the bulk-print page's new "كشف بائع" (farmer statement) section — a single item
/// line pulled off one of the farmer's own Active invoices within the picked date range. Date is
/// that owning invoice's date, not a separate per-item date: a farmer can appear across many
/// different invoices within the range, and every one of their item lines becomes its own row
/// here (see InvoiceService.GetFarmerStatementAsync). LineTotal mirrors InvoiceItemDto.LineTotal
/// (Quantity * PricePerUnit only — WoodPrice is a separate flat add-on, same convention as every
/// other item table in this app).
/// </summary>
/// <summary>CommissionRateApplied is that line's OWNING invoice's own rate (copied straight
/// through) — lets ExportService.GenerateFarmerStatementPdf compute this line's own commission
/// (CommissionCalculator.Calculate(LineTotal, CommissionRateApplied)) even though a farmer's
/// statement spans many invoices that could in principle carry different historical rates.</summary>
public record FarmerStatementLineDto(DateTimeOffset Date, string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal WoodPrice, decimal LineTotal, decimal CommissionRateApplied);

/// <summary>Wraps the itemized lines above with the farmer's own name, resolved once in
/// InvoiceService so the PDF header can show "البائع: ..." without a second round trip.</summary>
public record FarmerStatementDto(int FarmerId, string FarmerName, IReadOnlyList<FarmerStatementLineDto> Lines);

/// <summary>
/// One row of the standalone "بضاعة الباعة" page — aggregated by day + item + unit across all of
/// this farmer's Active invoices within the (optional) date range: how much of that item he
/// brought that day (TotalQuantity), and how much of that same quantity came in wood crates
/// (WoodQuantity) — a SEPARATE figure, not a yes/no flag, since a farmer can bring e.g. 20 boxes
/// of tomatoes on the same day with only 5 of them in wood crates. That split is entered on the
/// invoice itself as two separate lines for the same item/day (one with a WoodPrice, one without —
/// exactly how staff already price a mixed wood/non-wood delivery); this just aggregates it back
/// up into WoodQuantity = sum of Quantity across only the lines that had WoodPrice > 0, out of
/// TotalQuantity = sum of Quantity across every line for that day+item+unit.
/// </summary>
public record FarmerGoodsRow(DateTime Date, string ItemName, UnitOfMeasure Unit, decimal TotalQuantity, decimal WoodQuantity);

public record FarmerGoodsDto(int FarmerId, string FarmerName, IReadOnlyList<FarmerGoodsRow> Rows);


/// <summary>One "مرتجع بضاعة" document raised against an invoice — see Domain GoodsReturn.</summary>
public record GoodsReturnDto(
    int Id, int InvoiceId, string InvoiceNumber, DateTimeOffset Date, string? Reason,
    decimal TotalValue, decimal CommissionRateApplied,
    IReadOnlyList<GoodsReturnItemDto> Items);

public record GoodsReturnItemDto(string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal LineTotal);

/// <summary>
/// Recording a return. Quantities are validated against what the invoice actually sold minus what
/// has already come back on it, so the same goods can never be returned twice (see
/// GoodsReturnService). PricePerUnit is NOT taken from the caller — it is read off the invoice
/// line, so a return is always credited at the price actually charged.
/// </summary>
public record CreateGoodsReturnRequest(
    DateTimeOffset Date, string? Reason, IReadOnlyList<GoodsReturnLineInput> Items);

public record GoodsReturnLineInput(string ItemName, UnitOfMeasure Unit, decimal Quantity);
