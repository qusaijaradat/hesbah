// Mirrors backend/src/GreenMarket.Api/DTOs — kept in one file since the two projects
// don't share code generation here; if you add a request/response shape on the API,
// add its matching type here too.

// "Farmer" displays in the UI as "بائع" (Seller); "Driver" ("سائق") is a peer type that shares
// the same optional invoice slot and ledger wiring — see the remarks on PartnerType in the backend.
/** The roles a person holds, combined. "Both" is the old name for seller+buyer and stays because
 *  it is what the database holds; the two combinations with a driver in them had no name at all,
 *  which is how a driver whose name already existed was saved as a buyer. See backend PartnerRoles. */
export type PartnerType = "Farmer" | "Merchant" | "Both" | "Driver" | "FarmerDriver" | "MerchantDriver" | "All";

export type InvoiceStatus = "Active" | "Cancelled";
// Three separate directions — ToFarmer and ToDriver used to share one value ("ToFarmer" covered
// both), which meant the person picker searched every partner regardless of type. Now each has
// its own value so the picker can be restricted to the matching partner type — see PaymentsPage.tsx.
export type PaymentDirection = "FromMerchant" | "ToFarmer" | "ToDriver";
export type CheckClearanceStatus = "Pending" | "Cleared" | "Bounced";


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
  /** Whether that الرصيد الافتتاحي is added into the "الرصيد السابق" printed on this person's
   *  invoices. Off by default — see the backend Partner for why an old debt stays off a bill. */
  includeOpeningBalanceInInvoices: boolean;
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

/** Crates ("صندوق") and sacks ("مخلاة") are counted apart — one balance each per person. */
/** Cartons joined crates and sacks when an invoice line started counting its own عدد الكرتون —
 *  they leave with the buyer exactly the way crates do, so they are tracked the same way. */
export type ContainerType = "Box" | "Carton" | "Sack";
/** Out = the market handed them over; In = they came back. */
export type ContainerDirection = "Out" | "In";

export interface ContainerMovementDto {
  id: number;
  partnerId: number;
  type: ContainerType;
  direction: ContainerDirection;
  date: string;
  quantity: number;
  notes?: string | null;
}

export interface CreateContainerMovementRequest {
  type: ContainerType;
  direction: ContainerDirection;
  date: string;
  quantity: number;
  notes?: string | null;
}

/**
 * One kind of container's standing with one person. Two sides are derived rather than re-typed:
 * fromInvoices (crates going out with a buyer, net of produce sent back) and fromGoodsEntries
 * (wooden crates arriving with a seller's produce, counted on "إضافة بضاعة"). Both are crates
 * only; sacks are always recorded by hand.
 *
 * remaining = (fromInvoices + handedOut) − (cameBack + fromGoodsEntries). Positive = they hold
 * that many of ours; negative = we hold theirs, which is normal for a seller who brings his
 * produce in his own crates.
 */
export interface ContainerBalanceDto {
  type: ContainerType;
  fromInvoices: number;
  fromGoodsEntries: number;
  handedOut: number;
  cameBack: number;
  remaining: number;
}

/** One line of "مين ماسك صناديقي" — positive = they hold ours, negative = we hold theirs. */
export interface ContainerHolderDto {
  partnerId: number;
  partnerName: string;
  type: ContainerType;
  remaining: number;
}

export interface PartnerContainersDto {
  partnerId: number;
  partnerName: string;
  balances: ContainerBalanceDto[];
  movements: ContainerMovementDto[];
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
  /** Containers live on their own screen (see PartnerContainersDto) — they are counts, they
   *  apply to sellers and drivers too, and there is more than one kind of them. */
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

/** One invoice line. See the backend InvoiceItem: العدد is always there, الوزن is optional, and
 *  whether the weight is there is what decides how the line is priced — a Kg/Box unit used to
 *  carry that, which meant a line could be counted or weighed but never both, and crates on a
 *  weighed line had nowhere to live. */
export interface InvoiceItemInput {
  itemName: string;
  /** "العدد" — required on every line. Prices the line when there is no weight. */
  quantity: number;
  /** "الوزن" بالكيلو, or null/undefined when this line was not weighed. Prices the line when set. */
  weightKg?: number | null;
  pricePerUnit: number;
  /** "عدد الصناديق" — the only count رسوم الصناديق and the driver's أجرة الصناديق are charged on. */
  boxQuantity?: number;
  /** "عدد الكرتون" — counted and tracked on the containers screen, never charged for. */
  cartonQuantity?: number;
  /** Optional per-line "سعر الخشب" (wood/crate price) — a flat add-on, not multiplied by anything, 0 when unset. */
  woodPrice?: number;
}

export interface InvoiceItemDto extends InvoiceItemInput {
  id: number;
  boxQuantity: number;
  cartonQuantity: number;
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
  /** "أجرة الصناديق" settings value locked in at this invoice's creation time — the driver-side
   * counterpart of boxPriceApplied, but money owed TO the driver, not charged to the merchant. */
  driverBoxFeeApplied: number;
  /** totalBoxes × driverBoxFeeApplied — the automatic per-box driver handling fee (explicit
   * request). Deliberately NOT included in grandTotal (merchant-facing) — only shown/added on the
   * driver's own manifest print (كشف أجرة نقل السائق). */
  driverBoxFeeTotal: number;
  /** totalValue + woodTotal + boxFeeTotal, net of returns — the actual amount charged to the
   *  merchant. أجرة النقل is NOT in it: that comes off the seller and goes to the driver. */
  grandTotal: number;
  /** "الرصيد السابق" — what this merchant still owed from every one of their OTHER active
   * invoices minus every payment they've made, all-time (never negative — see backend
   * InvoiceService.ComputePreviousBalanceAsync). Add to grandTotal for the actual amount due now. */
  previousBalance: number;
  /** This invoice's own commission rate (e.g. 0.10 for 7%), copied from Settings at creation time. */
  commissionRateApplied: number;
  /** commissionRateApplied × totalValue (never totalValue+woodTotal/transportFee — same base as
   * the linked FarmerTransaction.Commission). Only ever shown on farmer-facing surfaces (the
   * "نسخة البائع" print, the "إرسال للبائع" WhatsApp message) — never on anything the merchant
   * sees (requirement doc §5). Meaningless/unused when farmerId is null. */
  commission: number;
  /** totalValue − commission − transportFee (backend InvoiceCharge.ForSeller) — what is actually
   * due to the seller for this one invoice. Not the wood or the crate fees: the buyer pays those
   * and the market keeps them. */
  netDueToFarmer: number;
  /** transportFee + driverBoxFeeTotal (backend InvoiceCharge.ForDriver) — what is due to the
   * driver, and the only figure a driver-facing print or message may total up. */
  driverDue: number;
  /** "قيمة المرتجع" — already subtracted inside grandTotal, broken out so the screen can show
   * why the total is lower than the lines add up to. */
  returnsTotal: number;
  /** Collected against THIS invoice (uncleared checks don't count), what's left, and the state
   * that follows from the two. */
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: InvoicePaymentStatus;
  /** What the market keeps out of this invoice — commission + رسوم الصناديق + سعر الخشب −
   *  أجرة صناديق السائق, net of commission handed back on any مرتجع. Computed by the backend's
   *  MarketEarnings, the same function the daily closing uses, so the two cannot disagree. */
  marketProfit: number;
  /** Any line still at price 0 — goods that went out before being priced. */
  hasUnpricedItems: boolean;
  items: InvoiceItemDto[];
  returns: GoodsReturnDto[];
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
  /** Seller-side money for this invoice — the same figures its printed "فاتورة بائع" shows.
   * netDueToFarmer = totalValue − commission − transportFee (backend InvoiceCharge.ForSeller).
   * سعر الخشب is NOT in it: the buyer pays it and the market keeps it. */
  commission: number;
  netDueToFarmer: number;
  /** Driver-side money — same figures its printed "فاتورة سائق" and the driver's كشف أجرة نقل
   * show. driverDue = transportFee + driverBoxFeeTotal (backend InvoiceCharge.ForDriver). No wood:
   * that stopped being the driver's. */
  driverBoxFeeTotal: number;
  driverDue: number;
  /** "قيمة المرتجع" — already subtracted inside grandTotal, broken out so the screen can show
   * why the total is lower than the lines add up to. */
  returnsTotal: number;
  /** Collected against THIS invoice (uncleared checks don't count), what's left, and the state
   * that follows from the two. */
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: InvoicePaymentStatus;
  /** Any line still at price 0 — goods that went out before being priced. */
  hasUnpricedItems: boolean;
}

/** Where an invoice stands against what has actually been collected on it — see backend
 * InvoicePaymentStatus. Derived from GrandTotal vs. the payments linked to that invoice. */
export type InvoicePaymentStatus = "Unpaid" | "Partial" | "Paid";

export interface GoodsReturnItemDto {
  itemName: string;
  quantity: number;
  weightKg?: number | null;
  boxQuantity: number;
  cartonQuantity: number;
  pricePerUnit: number;
  lineTotal: number;
}

/** "مرتجع بضاعة" — goods sent back off an invoice. Reduces what the buyer owes AND, net of the
 * commission charged on it, what the seller is due. See backend GoodsReturn. */
export interface GoodsReturnDto {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  date: string;
  reason?: string | null;
  totalValue: number;
  commissionRateApplied: number;
  items: GoodsReturnItemDto[];
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
  /** "طباعة الفواتير" per-section "استثناء أسماء": drop invoices belonging to these people. One
   * list per role — each section only ever fills its own, so excluding a name as a مشتري can't
   * also drop invoices where that person is the بائع. See backend InvoiceFilterRequest. */
  /** "الفواتير غير المدفوعة" — narrows to one payment state, computed server-side. */
  paymentStatus?: InvoicePaymentStatus;
  /** true = only invoices with at least one line still unpriced (price 0). */
  hasUnpricedItems?: boolean;
  excludeMerchantIds?: number[];
  excludeFarmerIds?: number[];
  excludeDriverIds?: number[];
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
  totalCartons: number;
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
  totalCartons: number;
  totalPurchases: number;
  totalWoodTotal: number;
  /** رسوم الصناديق — broken out so purchases + wood + this adds up to grandTotal. No transport:
   *  a buyer is not charged for it. */
  totalBoxFee: number;
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
  /** The containers he handled — crates are what his أجرة الصناديق is paid on. */
  totalBoxes: number;
  totalCartons: number;
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
  totalQuantity: number;
  totalWeightKg: number;
  totalValue: number;
}

// "طباعة الفواتير" → قسم البائع's "كشف بائع حسب الفترة" — farmer counterpart to
// MerchantItemBreakdownRow. See backend FarmerItemBreakdownRow's doc comment: totalValue is the
// item's raw gross sale value, not the farmer's net-after-commission figure.
export interface FarmerItemBreakdownRow {
  farmerId: number;
  farmerName: string;
  itemName: string;
  totalQuantity: number;
  totalWeightKg: number;
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
  totalQuantity: number;
  totalWeightKg: number;
  totalTransportFee: number;
}

export interface MarketReportRow {
  period: string;
  totalSalesValue: number;
  totalCommission: number;
  /** Containers that went out over the period — crates carry the fee shown beside them. */
  totalBoxes: number;
  totalCartons: number;
  /** See DailyClosingDto below — the same four terms, over a period instead of a day. */
  boxFeeIncome: number;
  woodIncome: number;
  driverBoxFeeCost: number;
  keptPassThrough: number;
  returnsCommissionCredit: number;
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
  /** The counts behind the fee below, so a day's رسوم الصناديق reads back to something countable. */
  totalBoxes: number;
  /** Cartons that went out. Counted, charged to nobody. */
  totalCartons: number;
  /** رسوم الصناديق charged to buyers — the market keeps it. */
  boxFeeIncome: number;
  /** سعر الخشب charged to buyers — the market keeps this too. */
  woodIncome: number;
  /** أجرة الصناديق paid out to drivers — a real cost. */
  driverBoxFeeCost: number;
  /** أجرة النقل taken off the seller on invoices with no driver to pass it to. Normally 0;
   *  anything here usually means a driver was left off an invoice. */
  keptPassThrough: number;
  /** Commission handed back on goods returned that day. */
  returnsCommissionCredit: number;
  totalExpenses: number;
  /** commission + boxFee − driverBoxFee + keptPassThrough − returnsCredit − expenses. */
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
  totalQuantity: number;
  totalWeightKg: number;
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
  /** "العدد" brought in — same pair as an invoice line, so intake and sales can be netted. */
  quantity: number;
  /** "الوزن" brought in, or null when this delivery was not weighed. */
  weightKg?: number | null;
  woodQuantity: number;
  /** "مخالات" — the same kind of plain container count as woodQuantity, tracked in the same
   *  ledger and kept on its own balance (see ContainerBalanceDto). */
  sackQuantity: number;
  notes?: string | null;
}

export interface CreateGoodsEntryRequest {
  farmerId: number;
  date: string;
  itemName: string;
  quantity: number;
  weightKg?: number | null;
  woodQuantity?: number;
  sackQuantity?: number;
  notes?: string | null;
}

export interface UpdateGoodsEntryRequest {
  date: string;
  itemName: string;
  quantity: number;
  weightKg?: number | null;
  woodQuantity?: number;
  sackQuantity?: number;
  notes?: string | null;
}

/** Counted BOTH ways — العدد and الوزن, each netted against its own kind. A row used to be keyed
 *  by item + Kg/Box unit and carry one number, so produce taken in by weight and sold by the
 *  crate became two rows that never subtracted from each other. */
export interface GoodsStockRow {
  itemName: string;
  totalReceived: number;
  totalSold: number;
  available: number;
  weightReceived: number;
  weightSold: number;
  weightAvailable: number;
  /** Independent running total of wooden-crate counts logged against this item's intake entries
   * (GoodsEntryDto.woodQuantity) — always a plain crate count, and never netted against
   * totalSold (no "wood crates sold" concept exists). */
  woodReceived: number;
  /** Same, for "مخالات" — its own running total, never pooled with the crates. */
  sackReceived: number;
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
  /** The person's الرصيد الافتتاحي — debt carried over from before this system. */
  oldDebt: number;
  /** Everything since: invoices and payments recorded here. */
  currentDebt: number;
  /** oldDebt + currentDebt. The authoritative figure — never re-add the halves to it. */
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
  quantity: number;
  weightKg?: number | null;
  pricePerUnit: number;
  woodPrice: number;
  lineTotal: number;
  transportFee: number;
  grandTotal: number;
}

/**
 * A manual "تسوية/تعويض" line posted to a seller's or driver's account. amount is signed:
 * positive = the market owes them more (the case this exists for — compensating a seller whose
 * item collapsed in price), negative = less. It never touches the commission, which stays on the
 * sale value as originally invoiced.
 */
export interface AdjustmentDto {
  id: number;
  partnerId: number;
  date: string;
  amount: number;
  reason: string;
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

/** One person on a "من علينا / علينا لمين" list — see backend PartnerDebtRow. */
export interface PartnerDebtRow {
  partnerId: number;
  name: string;
  oldDebt: number;
  currentDebt: number;
  remaining: number;
}

/** The whole dashboard in one payload. "today" figures are today's activity; every balance and
 * count below is the CURRENT position, all-time. See backend DashboardSummaryDto. */
export interface DashboardSummaryDto {
  todayInvoiceCount: number;
  todaySalesValue: number;
  todayCommission: number;
  /** Containers that went out today — crates carry the fee, cartons are counted only. */
  todayBoxes: number;
  todayCartons: number;
  todayCashIn: number;
  todayCashOut: number;
  merchantsOwe: number;
  owedToSellers: number;
  checksDueTodayCount: number; checksDueTodayAmount: number;
  checksOverdueCount: number; checksOverdueAmount: number;
  checksDueSoonCount: number; checksDueSoonAmount: number;
  unpaidInvoiceCount: number; unpaidInvoiceAmount: number;
  unpricedInvoiceCount: number;
  topMerchantDebts: PartnerDebtRow[];
  topSellerDues: PartnerDebtRow[];
}

/** What a top-of-page alert is about — see backend AlertKind. The backend returns the fact;
 * the wording and the link live in AlertsBanner.tsx alongside every other user-facing string. */
export type AlertKind = "OverdueChecks" | "ChecksDueToday" | "UnpricedInvoices";
export type AlertSeverity = "Info" | "Warning" | "Critical";

export interface AlertDto {
  kind: AlertKind;
  severity: AlertSeverity;
  count: number;
  /** 0 where a sum is meaningless — an unpriced invoice has no reliable total yet. */
  amount: number;
  /** A capped sample of who is involved, so the banner can say who without copying the page. */
  names: string[];
}
