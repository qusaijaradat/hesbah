// Mirrors backend/src/GreenMarket.Api/DTOs — kept in one file since the two projects
// don't share code generation here; if you add a request/response shape on the API,
// add its matching type here too.

// "Farmer" displays in the UI as "بائع" (Seller); "Driver" ("سائق") is a peer type that shares
// the same optional invoice slot and ledger wiring — see the remarks on PartnerType in the backend.
export type PartnerType = "Farmer" | "Merchant" | "Both" | "Driver";
export type InvoiceStatus = "Active" | "Cancelled";
export type PaymentDirection = "FromMerchant" | "ToFarmer";
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
  /** totalValue + transportFee + woodTotal — the actual amount charged to the merchant. */
  grandTotal: number;
  /** "الرصيد السابق" — what this merchant still owed from every one of their OTHER active
   * invoices minus every payment they've made, all-time (never negative — see backend
   * InvoiceService.ComputePreviousBalanceAsync). Add to grandTotal for the actual amount due now. */
  previousBalance: number;
  items: InvoiceItemDto[];
}

export interface InvoiceListItemDto {
  id: number;
  invoiceNumber: string;
  date: string;
  merchantId: number;
  merchantName: string;
  merchantWhatsApp?: string | null;
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

export interface SettingDto {
  key: string;
  value: string;
  description?: string | null;
}
