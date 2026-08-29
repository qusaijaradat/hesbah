// Mirrors backend/src/GreenMarket.Api/DTOs — kept in one file since the two projects
// don't share code generation here; if you add a request/response shape on the API,
// add its matching type here too.

export type PartnerType = "Farmer" | "Merchant" | "Both";
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
}

export interface InvoiceItemDto extends InvoiceItemInput {
  id: number;
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
  status: InvoiceStatus;
  totalWeightKg: number;
  totalValue: number;
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
  status: InvoiceStatus;
  totalWeightKg: number;
  totalBoxes: number;
  totalValue: number;
}

export interface InvoiceFilter {
  dateFrom?: string;
  dateTo?: string;
  merchantId?: number;
  farmerId?: number;
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
