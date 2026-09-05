// Mirrors backend/src/GreenMarket.Api/DTOs — kept in one file since the two projects
// don't share code generation here; if you add a request/response shape on the API,
// add its matching type here too.

// "Farmer" displays in the UI as "بائع" (Seller); "Driver" ("سائق") is a peer type that shares
// the same optional invoice slot and ledger wiring — see the remarks on PartnerType in the backend.
export type PartnerType = "Farmer" | "Merchant" | "Both" | "Driver";
export type InvoiceStatus = "Active" | "Cancelled";
export type PaymentDirection = "FromMerchant" | "ToFarmer";
export type CheckClearanceStatus = "Pending" | "Cleared" | "Bounced";
export type UnitOfMeasure = "Kg" | "Box";

export interface UserDto {
  id: number;
  fullName: string;
  username: string;
  roleName: string;
  isActive: boolean;
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: UserDto;
  mustChangePassword: boolean;
}

export interface RoleDto {
  id: number;
  name: string;
  description?: string;
  permissions: string[];
}

export interface PartnerDto {
  id: number;
  name: string;
  type: PartnerType | null;
  whatsAppNumber?: string | null;
  /** "العنوان" — plain optional free text, purely informational. */
  address?: string | null;
  notes?: string | null;
  creditLimit?: number | null;
  /** "الرصيد الافتتاحي" — manually-entered starting balance from before this system was in use.
   * See backend Partner.OpeningBalance's doc comment for the sign convention. */
  openingBalance?: number | null;
  /** "الرصيد" on the partners list (PartnersPage) — only populated by the list endpoint, and only
   * for the side that applies to this partner's type. A Both partner (farmer+merchant) can have
   * BOTH non-null at once — two entirely separate balances, never combined into one number. */
  farmerRemaining?: number | null;
  merchantRemaining?: number | null;
}

export interface PartnerSuggestionDto {
  id: number;
  name: string;
  type: PartnerType | null;
}

export interface ItemDto {
  id: number;
  name: string;
}

// "الكشف المفصل" — every optional field is populated only when relevant to this line's kind (see
// backend StatementLineDto's doc comment): invoiceId/invoiceNumber link back to the actual invoice
// (any line type), saleValue/commission break a farmer's Sale line into gross value vs. the market's
// cut (amount = saleValue - commission), method/notes carry a payment's recorded method/free text.
export interface StatementLineDto {
  date: string;
  description: string;
  amount: number;
  runningBalance: number;
  invoiceId?: number | null;
  invoiceNumber?: string | null;
  saleValue?: number | null;
  commission?: number | null;
  method?: string | null;
  notes?: string | null;
}

/** One "empty crate return" record — see backend BoxReturn's own doc comment. */
export interface BoxReturnDto {
  id: number;
  partnerId: number;
  date: string;
  quantity: number;
  notes?: string | null;
}

export interface CreateBoxReturnRequest {
  date: string;
  quantity: number;
  notes?: string | null;
}

export interface MerchantAccountDto {
  partnerId: number;
  name: string;
  totalPurchases: number;
  totalPaid: number;
  remaining: number;
  creditLimit?: number | null;
  isOverCreditLimit: boolean;
  /** Already folded into `remaining` — shown separately so the numbers stay traceable. */
  openingBalance?: number | null;
  /** "صناديق مطلوبة من المشتري" — a crate COUNT, entirely separate from the money figures above.
   * boxesGiven is derived live from this merchant's own Active invoices; boxesRemaining =
   * boxesGiven − boxesReturned (never clamped — can legitimately go slightly negative if
   * over-returned, same tolerance as the farmer-goods "available" figure). */
  boxesGiven: number;
  boxesReturned: number;
  boxesRemaining: number;
  boxReturns: BoxReturnDto[];
  statement: StatementLineDto[];
}

export interface FarmerAccountDto {
  partnerId: number;
  name: string;
  /** Lets the page title say "بائع" or "سائق" specifically instead of a blanket "بائع/سائق". */
  type: PartnerType | null;
  totalSalesValue: number;
  totalCommission: number;
  /** Sale (farmer) + TransportFee (driver) rows combined — a pure driver has totalSalesValue/
   * totalCommission at 0 while this still reflects their transport-fee earnings. */
  totalNetDue: number;
  totalPaid: number;
  remaining: number;
  /** Already folded into `remaining` — shown separately so the numbers stay traceable. */
  openingBalance?: number | null;
  statement: StatementLineDto[];
}

export interface InvoiceItemInput {
  itemName: string;
  quantity: number;
  unit: UnitOfMeasure;
  pricePerUnit: number;
  /** Optional per-line "سعر الخشب" (wood/crate price) — a flat add-on, not multiplied by quantity, 0 when unset. */
  woodPrice?: number;
}

export interface InvoiceItemDto extends InvoiceItemInput {
  id: number;
  woodPrice: number;
  lineTotal: number;
}

export interface InvoiceDto {
  id: number;
  invoiceNumber: string;
  date: string;
  merchantId: number;
  merchantName: string;
  merchantWhatsApp?: string | null;
  farmerId?: number | null;
  farmerName?: string | null;
  farmerWhatsApp?: string | null;
  driverId?: number | null;
  driverName?: string | null;
  driverWhatsApp?: string | null;
  status: InvoiceStatus;
  totalWeightKg: number;
  totalValue: number;
  /** Optional "أجرة النقل" (transport fee) for this invoice, 0 when unset. */
  transportFee: number;
  /** Sum of every item's woodPrice. */
  woodTotal: number;
  /** This invoice's own box-unit item count (sum of quantity across Box-unit items). */
  totalBoxes: number;
  /** "سعر الصندوق" settings value locked in at this invoice's creation time. */
  boxPriceApplied: number;
  /** totalBoxes × boxPriceApplied — the automatic per-box fee (explicit request), separate
   * from/additive to woodTotal. Already folded into grandTotal. */
  boxFeeTotal: number;
  /** totalValue + transportFee + woodTotal + boxFeeTotal — the actual amount charged to the merchant. */
  grandTotal: number;
  /** "الرصيد السابق" — what this merchant still owed from every one of their OTHER active
   * invoices minus every payment they've made, all-time (never negative — see backend
   * InvoiceService.ComputePreviousBalanceAsync). Add to grandTotal for the actual amount due now. */
  previousBalance: number;
  /** This invoice's own commission rate (e.g. 0.07 for 7%), copied from Settings at creation time. */
  commissionRateApplied: number;
  /** commissionRateApplied × totalValue (never totalValue+woodTotal/transportFee — same base as
   * the linked FarmerTransaction.Commission). Only ever shown on farmer-facing surfaces (the
   * "نسخة البائع" print, the "إرسال للبائع" WhatsApp message) — never on anything the merchant
   * sees (requirement doc §5). Meaningless/unused when farmerId is null. */
  commission: number;
  /** totalValue − commission — what's actually due to the farmer for this one invoice. */
  netDueToFarmer: number;
  items: InvoiceItemDto[];
}

export interface InvoiceListItemDto {
  id: number;
  invoiceNumber: string;
  date: string;
  merchantId: number;
  merchantName: string;
  merchantWhatsApp?: string | null;
  /** Mirrors driverId — a stable identity to group by (two farmers can share a display name). */
  farmerId?: number | null;
  farmerName?: string | null;
  farmerWhatsApp?: string | null;
  driverId?: number | null;
  driverName?: string | null;
  driverWhatsApp?: string | null;
  status: InvoiceStatus;
  totalWeightKg: number;
  totalBoxes: number;
  totalValue: number;
  transportFee: number;
  grandTotal: number;
  /** "، "-joined distinct item names on this invoice (e.g. "طماطم، خيار") — see backend
   * InvoiceListItemDto's doc comment. */
  itemsSummary: string;
  /** Already folded into grandTotal — broken out on its own so "طباعة الفواتير" can show
   * "سعر الخشب" as an explicit visible figure instead of it disappearing into the total. */
  woodTotal: number;
  /** Same "broken out for visibility" treatment as woodTotal above, for the automatic "سعر
   * الصندوق" fee — already folded into grandTotal. */
  boxFeeTotal: number;
  /** This row's merchant's CURRENT overall account balance (same "المتبقي" their own كشف حساب
   * page shows) — shown on every one of their invoice rows on "طباعة الفواتير", not just once. */
  merchantRemaining: number;
  /** Same idea as merchantRemaining but for the farmer/driver side — null when this invoice has
   * no farmer/driver attached. */
  farmerRemaining?: number | null;
  driverRemaining?: number | null;
}

export interface InvoiceFilter {
  dateFrom?: string;
  dateTo?: string;
  merchantId?: number;
  farmerId?: number;
  driverId?: number;
  /** "طباعة الفواتير" per-role sections: true = only invoices that have a farmer/driver attached
   * at all — used when that section's own picker is left blank. See backend InvoiceFilterRequest. */
  hasFarmer?: boolean;
  hasDriver?: boolean;
  itemName?: string;
  invoiceNumber?: string;
  invoiceNumberFrom?: string;
  invoiceNumberTo?: string;
  minWeightKg?: number;
  maxWeightKg?: number;
  minAmount?: number;
  maxAmount?: number;
  status?: InvoiceStatus;
  page?: number;
  pageSize?: number;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaymentDto {
  id: number;
  partnerId: number;
  partnerName: string;
  direction: PaymentDirection;
  amount: number;
  date: string;
  method?: string | null;
  notes?: string | null;
  invoiceId?: number | null;
  invoiceNumber?: string | null;
  /** Set only when this payment is a check ("شيك") — its due/maturity date. */
  checkDueDate?: string | null;
  checkNumber?: string | null;
  /** Only meaningful when checkDueDate is set. */
  checkStatus?: CheckClearanceStatus | null;
  /** The date the check was ACTUALLY cashed/deposited — only ever set while checkStatus is
   * "Cleared". Distinct from checkDueDate (the nominal due date). */
  checkClearedDate?: string | null;
}

export interface ExpenseDto {
  id: number;
  date: string;
  description: string;
  amount: number;
  category?: string | null;
  employeeId?: number | null;
  employeeName?: string | null;
}

export interface EmployeeDto {
  id: number;
  name: string;
  phone?: string | null;
  notes?: string | null;
  isActive: boolean;
  totalExpenses: number;
}

export interface FarmerReportRow {
  farmerId: number;
  farmerName: string;
  invoiceCount: number;
  totalWeightKg: number;
  totalBoxes: number;
  totalSalesValue: number;
  totalCommission: number;
  netDue: number;
  totalPaid: number;
  remaining: number;
  openingBalance: number;
  lastInvoiceDate?: string | null;
}

export interface MerchantReportRow {
  merchantId: number;
  merchantName: string;
  invoiceCount: number;
  totalWeightKg: number;
  totalBoxes: number;
  totalPurchases: number;
  totalWoodTotal: number;
  totalTransportFee: number;
  grandTotal: number;
  totalPaid: number;
  remaining: number;
  openingBalance: number;
  lastInvoiceDate?: string | null;
}

// Counterpart to FarmerReportRow for the transport side of the ledger — see backend
// DriverReportRow's doc comment. No sale/commission concept for a driver: TotalTransportFee is
// everything earned across every matching invoice.
export interface DriverReportRow {
  driverId: number;
  driverName: string;
  invoiceCount: number;
  totalTransportFee: number;
  totalPaid: number;
  remaining: number;
  openingBalance: number;
  lastInvoiceDate?: string | null;
}

// Dashboard "كشف المشترين حسب الفترة" per-item breakdown — one row per (merchant, item). See backend
// MerchantItemBreakdownRow's doc comment: totalValue excludes WoodPrice (a separate flat add-on).
export interface MerchantItemBreakdownRow {
  merchantId: number;
  merchantName: string;
  itemName: string;
  unit: UnitOfMeasure;
  totalQuantity: number;
  totalValue: number;
}

// "طباعة الفواتير" → قسم البائع's "كشف بائع حسب الفترة" — farmer counterpart to
// MerchantItemBreakdownRow. See backend FarmerItemBreakdownRow's doc comment: totalValue is the
// item's raw gross sale value, not the farmer's net-after-commission figure.
export interface FarmerItemBreakdownRow {
  farmerId: number;
  farmerName: string;
  itemName: string;
  unit: UnitOfMeasure;
  totalQuantity: number;
  totalValue: number;
}

// "طباعة الفواتير" → قسم السائق's "كشف سائق حسب الفترة". No per-item price — see backend
// DriverItemBreakdownRow's doc comment: totalTransportFee is this driver's WHOLE-period transport
// fee (summed once per invoice), repeated identically across every one of that driver's rows — read
// it once per driver (e.g. from the first row), never sum it across rows.
export interface DriverItemBreakdownRow {
  driverId: number;
  driverName: string;
  itemName: string;
  unit: UnitOfMeasure;
  totalQuantity: number;
  totalTransportFee: number;
}

export interface MarketReportRow {
  period: string;
  totalSalesValue: number;
  totalCommission: number;
  totalExpenses: number;
  netProfit: number;
}

export interface AgingReportRow {
  merchantId: number;
  merchantName: string;
  current: number;
  days30To59: number;
  days60To89: number;
  days90Plus: number;
  total: number;
}

export interface AuditLogDto {
  id: number;
  at: string;
  userId?: number | null;
  userFullName?: string | null;
  entityName: string;
  entityId: string;
  action: string;
  changesJson?: string | null;
}

export interface PermissionDto {
  id: number;
  key: string;
  description?: string | null;
}

export interface DailyClosingDto {
  date: string;
  invoiceCount: number;
  totalSalesValue: number;
  totalCommission: number;
  totalExpenses: number;
  netProfit: number;
  paymentsReceivedFromMerchants: number;
  paymentsPaidToFarmers: number;
}

// "بضاعة الباعة" page — mirrors backend FarmerGoodsRow/FarmerGoodsDto. TotalQuantity is everything
// of that item the farmer brought that day; WoodQuantity is the portion of TotalQuantity that came
// from lines with a wood price (a separate figure, not a flag — e.g. 20 total boxes, 5 of them wood).
export interface FarmerGoodsRow {
  date: string;
  itemName: string;
  unit: UnitOfMeasure;
  totalQuantity: number;
  woodQuantity: number;
}

export interface FarmerGoodsDto {
  farmerId: number;
  farmerName: string;
  rows: FarmerGoodsRow[];
}

// "بضاعة الباعة" page's new "إضافة بضاعة" (goods stock intake) feature — mirrors backend
// GoodsEntryDto/GoodsStockRow/FarmerGoodsStockDto. See backend FarmerGoodsEntry's doc comment:
// Available is always computed live (TotalReceived - TotalSold), never a stored running balance.
export interface GoodsEntryDto {
  id: number;
  farmerId: number;
  farmerName: string;
  date: string;
  itemName: string;
  unit: UnitOfMeasure;
  quantity: number;
  woodQuantity: number;
  notes?: string | null;
}

export interface CreateGoodsEntryRequest {
  farmerId: number;
  date: string;
  itemName: string;
  unit: UnitOfMeasure;
  quantity: number;
  woodQuantity?: number;
  notes?: string | null;
}

export interface UpdateGoodsEntryRequest {
  date: string;
  itemName: string;
  unit: UnitOfMeasure;
  quantity: number;
  woodQuantity?: number;
  notes?: string | null;
}

export interface GoodsStockRow {
  itemName: string;
  unit: UnitOfMeasure;
  totalReceived: number;
  totalSold: number;
  available: number;
  /** Independent running total of wooden-crate counts logged against this item's intake entries
   * (GoodsEntryDto.woodQuantity) — always a plain crate count, never in this row's own `unit`
   * (Kg/Box), and never netted against totalSold (no "wood crates sold" concept exists). */
  woodReceived: number;
  /** Populated ONLY by the global "كل الباعة" stock summary (getGoodsGlobalStock/
   * getGoodsGlobalStockForReports) — each row there is scoped to one specific farmer, not summed
   * across every farmer, so the table can show whose stock it is. Both undefined on the per-farmer
   * stock list (getFarmerGoodsStock), since that page already shows the farmer's name once in its
   * own header. */
  farmerId?: number | null;
  farmerName?: string | null;
}

export interface FarmerGoodsStockDto {
  farmerId: number;
  farmerName: string;
  entries: GoodsEntryDto[];
  stock: GoodsStockRow[];
}

// "قيمة الدين" overview page — mirrors backend PartnerDebtRow/DebtsOverviewDto. Remaining uses the
// exact same sign convention as MerchantAccountDto.remaining / FarmerAccountDto.remaining (positive
// or negative depending on who owes whom); rows with remaining === 0 are already excluded server-side.
export interface PartnerDebtRow {
  partnerId: number;
  name: string;
  remaining: number;
}

export interface DebtsOverviewDto {
  farmers: PartnerDebtRow[];
  drivers: PartnerDebtRow[];
  merchants: PartnerDebtRow[];
}

// "قيمة الديون" drill-down — one item line off one of this partner's own invoices, all-time (no
// date filter). transportFee/grandTotal are INVOICE-level figures repeated identically across every
// one of that invoice's own item rows — read them once per invoice (e.g. its first row), never sum
// them across item rows, same convention as DriverItemBreakdownRow.totalTransportFee.
export interface PartnerInvoiceItemLineDto {
  invoiceId: number;
  invoiceNumber: string;
  date: string;
  itemName: string;
  unit: UnitOfMeasure;
  quantity: number;
  pricePerUnit: number;
  woodPrice: number;
  lineTotal: number;
  transportFee: number;
  grandTotal: number;
}

export interface PartnerInvoiceDetailDto {
  partnerId: number;
  partnerName: string;
  lines: PartnerInvoiceItemLineDto[];
}

export interface SettingDto {
  key: string;
  value: string;
  description?: string | null;
}
