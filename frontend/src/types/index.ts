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
  notes?: string | null;
  creditLimit?: number | null;
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

export interface StatementLineDto {
  date: string;
  description: string;
  amount: number;
  runningBalance: number;
}

export interface MerchantAccountDto {
  partnerId: number;
  name: string;
  totalPurchases: number;
  totalPaid: number;
  remaining: number;
  creditLimit?: number | null;
  isOverCreditLimit: boolean;
  statement: StatementLineDto[];
}

export interface FarmerAccountDto {
  partnerId: number;
  name: string;
  totalSalesValue: number;
  totalCommission: number;
  totalNetDue: number;
  totalPaid: number;
  remaining: number;
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
}

export interface InvoiceFilter {
  dateFrom?: string;
  dateTo?: string;
  merchantId?: number;
  farmerId?: number;
  driverId?: number;
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
  totalSalesValue: number;
  totalCommission: number;
  totalPaid: number;
  remaining: number;
}

export interface MerchantReportRow {
  merchantId: number;
  merchantName: string;
  invoiceCount: number;
  totalPurchases: number;
  totalPaid: number;
  remaining: number;
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

export interface SettingDto {
  key: string;
  value: string;
  description?: string | null;
}
