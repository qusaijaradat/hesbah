using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IPartnerService
{
    Task<PagedResult<PartnerDto>> ListAsync(string? search, PartnerType? type, int page, int pageSize);

    /// <summary>
    /// <paramref name="types"/> optionally restricts suggestions to specific partner types (e.g. the
    /// invoice's "بائع / سائق" field only wants Farmer/Driver/Both, not Merchant) — null/empty means
    /// no restriction, matching the previous behavior.
    /// </summary>
    Task<IReadOnlyList<PartnerSuggestionDto>> SuggestAsync(string? query, IReadOnlyCollection<PartnerType>? types = null);
    Task<PartnerDto> GetAsync(int id);
    Task<PartnerDto> CreateAsync(CreatePartnerRequest request);
    Task<PartnerDto> UpdateAsync(int id, UpdatePartnerRequest request);

    /// <summary>
    /// Only ever succeeds on a partner with NO history at all (no invoice as merchant/farmer/
    /// driver, no ledger transaction, no payment) — see the implementation for why. A partner
    /// with real history should simply stop being picked for new invoices/payments; deleting them
    /// would either silently break every query that joins Invoice → Merchant/Farmer/Driver (the
    /// global soft-delete filter turns that into an inner join) or, worse, make their trace history
    /// look like it belongs to no one.
    /// </summary>
    Task DeleteAsync(int id);

    /// <summary>
    /// Requirement doc §3: names are typed fresh most days (a different trader/farmer, not fixed
    /// people), with suggestions shown for names used before. This is the "or create" half of that:
    /// looks up an existing partner by exact name (case-insensitive, trimmed); if found, and this
    /// side's type isn't already covered, upgrades them to Both (the same person can be a farmer on
    /// one invoice and a merchant on another). If no match exists, creates a brand new partner.
    /// </summary>
    Task<Partner> FindOrCreateAsync(string name, PartnerType type);
    Task<MerchantAccountDto> GetMerchantAccountAsync(int id);
    Task<FarmerAccountDto> GetFarmerAccountAsync(int id);

    /// <summary>The "قيمة الدين" overview page: everyone with a non-zero balance right now, split
    /// into بائع/سائق/مشتري. Uses the exact same Remaining formulas as GetFarmerAccountAsync /
    /// GetMerchantAccountAsync (bulk-aggregated instead of one DB round-trip per partner) so the
    /// numbers here always match what you'd see drilling into any one person's own account page.</summary>
    Task<DebtsOverviewDto> GetDebtsOverviewAsync();

    /// <summary>"قيمة الديون" drill-down, seller side (see PartnerInvoiceDetailDto's doc comment).
    /// Shares FarmerAccountPage's own farmer-and-driver-on-one-page convention: a Driver partner is
    /// matched by Invoice.DriverId, a Farmer/Both partner by Invoice.FarmerId.</summary>
    Task<PartnerInvoiceDetailDto> GetFarmerInvoiceDetailAsync(int id);

    /// <summary>Buyer-side counterpart of GetFarmerInvoiceDetailAsync — matched by Invoice.MerchantId.</summary>
    Task<PartnerInvoiceDetailDto> GetMerchantInvoiceDetailAsync(int id);
}

public class PartnerService : IPartnerService
{
    private readonly AppDbContext _db;

    public PartnerService(AppDbContext db) => _db = db;

    public async Task<PagedResult<PartnerDto>> ListAsync(string? search, PartnerType? type, int page, int pageSize)
    {
        var query = _db.Partners.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(p => p.Name.Contains(search));
        if (type is not null)
            query = query.Where(p => p.Type == type);

        var total = await query.CountAsync();
        var pageItems = await query.OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        // "الرصيد" column on this list: same bulk-aggregated Remaining formulas as
        // GetDebtsOverviewAsync (one grouped query across this page's ids, not one DB round trip
        // per row) — see PartnerDto's doc comment for why Farmer/Merchant sides stay separate.
        var sellerIds = pageItems.Where(p => p.Type is PartnerType.Farmer or PartnerType.Driver or PartnerType.Both).Select(p => p.Id).ToList();
        var merchantIds = pageItems.Where(p => p.Type is PartnerType.Merchant or PartnerType.Both).Select(p => p.Id).ToList();

        var netAmountBySeller = await _db.FarmerTransactions
            .Where(t => sellerIds.Contains(t.FarmerId))
            .GroupBy(t => t.FarmerId)
            .Select(g => new { FarmerId = g.Key, Total = g.Sum(t => t.Amount) })
            .ToDictionaryAsync(x => x.FarmerId, x => x.Total);

        var purchasesByMerchant = await _db.Invoices
            .Where(i => merchantIds.Contains(i.MerchantId) && i.Status == InvoiceStatus.Active)
            .GroupBy(i => i.MerchantId)
            .Select(g => new { MerchantId = g.Key, Total = g.Sum(i => i.TotalValue) })
            .ToDictionaryAsync(x => x.MerchantId, x => x.Total);

        // A check that bounced never actually paid anything — excluded here (and everywhere else
        // "paid" is summed from Payments) so a bounced check doesn't silently understate what a
        // merchant still owes. See CheckClearanceStatus.Bounced's doc comment.
        var paidByMerchant = await _db.Payments
            .Where(p => merchantIds.Contains(p.PartnerId) && p.Direction == PaymentDirection.FromMerchant && p.CheckStatus != CheckClearanceStatus.Bounced)
            .GroupBy(p => p.PartnerId)
            .Select(g => new { PartnerId = g.Key, Total = g.Sum(p => p.Amount) })
            .ToDictionaryAsync(x => x.PartnerId, x => x.Total);

        var items = pageItems.Select(p =>
        {
            decimal? farmerRemaining = p.Type is PartnerType.Farmer or PartnerType.Driver or PartnerType.Both
                ? (p.OpeningBalance ?? 0) + netAmountBySeller.GetValueOrDefault(p.Id)
                : null;
            decimal? merchantRemaining = p.Type is PartnerType.Merchant or PartnerType.Both
                ? (p.OpeningBalance ?? 0) + purchasesByMerchant.GetValueOrDefault(p.Id) - paidByMerchant.GetValueOrDefault(p.Id)
                : null;
            return ToDto(p, farmerRemaining, merchantRemaining);
        }).ToList();

        return new PagedResult<PartnerDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    /// <summary>
    /// Requirement doc §3: "while typing a name, suggestions of existing names appear." An empty/blank
    /// query returns a full pick-list instead of nothing, so the field behaves like a real dropdown
    /// the moment it's focused (click it and see everyone), not just a typeahead you must start typing
    /// into first.
    /// </summary>
    public async Task<IReadOnlyList<PartnerSuggestionDto>> SuggestAsync(string? query, IReadOnlyCollection<PartnerType>? types = null)
    {
        var trimmed = query?.Trim() ?? string.Empty;
        var q = _db.Partners.AsQueryable();
        if (!string.IsNullOrEmpty(trimmed))
            q = q.Where(p => p.Name.Contains(trimmed));
        if (types is { Count: > 0 })
            q = q.Where(p => p.Type != null && types.Contains(p.Type.Value));

        return await q
            .OrderBy(p => p.Name)
            .Take(string.IsNullOrEmpty(trimmed) ? 100 : 10)
            .Select(p => new PartnerSuggestionDto(p.Id, p.Name, p.Type))
            .ToListAsync();
    }

    public async Task<PartnerDto> GetAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);
        return ToDto(partner);
    }

    public async Task<PartnerDto> CreateAsync(CreatePartnerRequest request)
    {
        var partner = new Partner
        {
            Name = request.Name.Trim(),
            Type = request.Type,
            WhatsAppNumber = request.WhatsAppNumber,
            Address = request.Address,
            Notes = request.Notes,
            CreditLimit = request.CreditLimit,
            OpeningBalance = request.OpeningBalance
        };
        _db.Partners.Add(partner);
        await _db.SaveChangesAsync();
        return ToDto(partner);
    }

    public async Task<Partner> FindOrCreateAsync(string name, PartnerType type)
    {
        var trimmed = name.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            throw new ValidationAppException("A name is required.");

        // Case-insensitive exact match. EF/Npgsql translates ToLower() to the SQL `lower()`
        // function, so this runs as a proper server-side query rather than pulling the whole
        // Partners table into memory.
        var normalized = trimmed.ToLower();
        var existing = await _db.Partners.SingleOrDefaultAsync(p => p.Name.ToLower() == normalized);

        if (existing is not null)
        {
            if (existing.Type is not null && existing.Type != type && existing.Type != PartnerType.Both)
            {
                existing.Type = PartnerType.Both;
                await _db.SaveChangesAsync();
            }
            else if (existing.Type is null)
            {
                existing.Type = type;
                await _db.SaveChangesAsync();
            }
            return existing;
        }

        var partner = new Partner { Name = trimmed, Type = type };
        _db.Partners.Add(partner);
        await _db.SaveChangesAsync();
        return partner;
    }

    public async Task<PartnerDto> UpdateAsync(int id, UpdatePartnerRequest request)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);
        partner.Name = request.Name.Trim();
        partner.Type = request.Type;
        partner.WhatsAppNumber = request.WhatsAppNumber;
        partner.Address = request.Address;
        partner.Notes = request.Notes;
        partner.CreditLimit = request.CreditLimit;
        partner.OpeningBalance = request.OpeningBalance;
        await _db.SaveChangesAsync();
        return ToDto(partner);
    }

    /// <summary>Requirement doc §6: merchant account = invoices, total purchases, paid, remaining + statement.</summary>
    public async Task<MerchantAccountDto> GetMerchantAccountAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        var invoices = await _db.Invoices
            .Where(i => i.MerchantId == id && i.Status == InvoiceStatus.Active)
            .Select(i => new { i.Id, i.Date, i.InvoiceNumber, i.TotalValue })
            .ToListAsync();

        // Method/Notes/linked invoice number: a payment can optionally be tied to one specific
        // invoice (InvoiceLinkPicker on the Payments page) — shown so "أي فاتورة سُدِّدت بهاي الدفعة"
        // is visible right on the statement line, not just on the Payments page. A bounced check
        // never actually paid anything — excluded here too, same reasoning as ListAsync's
        // paidByMerchant above — but it's still shown on the statement (Amount=0, a Description
        // noting it bounced) rather than silently disappearing, so the trader can see it was
        // recorded and then reversed rather than never having existed.
        var payments = await _db.Payments
            .Where(p => p.PartnerId == id && p.Direction == PaymentDirection.FromMerchant)
            .Select(p => new { p.Date, p.Amount, p.Method, p.Notes, p.InvoiceId, p.CheckStatus, LinkedInvoiceNumber = p.Invoice != null ? p.Invoice.InvoiceNumber : null })
            .ToListAsync();

        var entries = invoices.Select(i => new AccountStatementBuilder.Entry(
                i.Date, $"فاتورة رقم {i.InvoiceNumber}", i.TotalValue,
                InvoiceId: i.Id, InvoiceNumber: i.InvoiceNumber))
            .Concat(payments.Select(p =>
            {
                var bounced = p.CheckStatus == CheckClearanceStatus.Bounced;
                return new AccountStatementBuilder.Entry(
                    p.Date, bounced ? "دفعة بشيك ارتد (لم تُحتسب)" : "دفعة مستلمة", bounced ? 0 : -p.Amount,
                    InvoiceId: p.InvoiceId, InvoiceNumber: p.LinkedInvoiceNumber, Method: p.Method, Notes: p.Notes);
            }));

        var openingBalance = partner.OpeningBalance ?? 0;
        var statement = AccountStatementBuilder.Build(entries, openingBalance);
        var totalPurchases = invoices.Sum(i => i.TotalValue);
        var totalPaid = payments.Where(p => p.CheckStatus != CheckClearanceStatus.Bounced).Sum(p => p.Amount);
        var remaining = openingBalance + totalPurchases - totalPaid;
        var isOverLimit = partner.CreditLimit is not null && remaining > partner.CreditLimit;

        return new MerchantAccountDto(
            partner.Id, partner.Name,
            totalPurchases, totalPaid, remaining,
            partner.CreditLimit, isOverLimit, partner.OpeningBalance,
            statement.Select(ToStatementLineDto).ToList());
    }

    /// <summary>Requirement doc §6: farmer account = value sold, commission, due, paid, remaining + statement.</summary>
    public async Task<FarmerAccountDto> GetFarmerAccountAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        // Invoice/Payment included so the statement can show the actual invoice NUMBER (not just its
        // internal id) and, for Payment rows, the payment's recorded method — Payment.Invoice too,
        // since a Payment row's OWN InvoiceId (FarmerTransaction.InvoiceId is always null for
        // Payment-type rows — see the entity's doc comment) is where a payment explicitly linked to
        // one invoice (InvoiceLinkPicker on the Payments page) actually lives.
        var transactions = await _db.FarmerTransactions
            .Where(t => t.FarmerId == id)
            .Include(t => t.Invoice)
            .Include(t => t.Payment!).ThenInclude(p => p.Invoice)
            .OrderBy(t => t.Date)
            .ToListAsync();

        var entries = transactions.Select(t =>
        {
            // Sale/TransportFee/Adjustment rows carry their own InvoiceId; a Payment row's link (if
            // any) comes from the Payment it posted, not from the transaction row itself.
            var linkedInvoiceId = t.InvoiceId ?? t.Payment?.InvoiceId;
            var linkedInvoiceNumber = t.Invoice?.InvoiceNumber ?? t.Payment?.Invoice?.InvoiceNumber;

            return new AccountStatementBuilder.Entry(
                t.Date,
                t.Type switch
                {
                    FarmerTransactionType.Sale => t.Invoice is not null ? $"بيع — فاتورة رقم {t.Invoice.InvoiceNumber}" : "بيع",
                    FarmerTransactionType.TransportFee => t.Invoice is not null ? $"أجرة نقل — فاتورة رقم {t.Invoice.InvoiceNumber}" : "أجرة نقل",
                    FarmerTransactionType.Adjustment => t.Invoice is not null ? $"تعديل — فاتورة رقم {t.Invoice.InvoiceNumber}" : "تعديل",
                    _ => "دفعة مدفوعة"
                },
                t.Amount,
                InvoiceId: linkedInvoiceId,
                InvoiceNumber: linkedInvoiceNumber,
                SaleValue: t.Type == FarmerTransactionType.Sale ? t.SaleValue : null,
                Commission: t.Type == FarmerTransactionType.Sale ? t.Commission : null,
                Method: t.Type == FarmerTransactionType.Payment ? t.Payment?.Method : null,
                // Sale/TransportFee notes are just auto-generated boilerplate that repeats what the
                // description already says — only surfaced for Payment (the person's own free-text
                // note) and Adjustment (the cancellation reason), where it's actually new information.
                Notes: t.Type is FarmerTransactionType.Payment or FarmerTransactionType.Adjustment ? t.Notes : null);
        });

        var openingBalance = partner.OpeningBalance ?? 0;
        var statement = AccountStatementBuilder.Build(entries, openingBalance);

        var totalSales = transactions.Where(t => t.Type == FarmerTransactionType.Sale).Sum(t => t.SaleValue);
        var totalCommission = transactions.Where(t => t.Type == FarmerTransactionType.Sale).Sum(t => t.Commission);
        // Sale (farmer) and TransportFee (driver) rows both increase what the market owes this
        // person — a pure driver has no Sale rows so TotalSalesValue/TotalCommission stay 0 while
        // TotalNetDue still correctly reflects their transport-fee earnings.
        var totalNetDue = transactions
            .Where(t => t.Type == FarmerTransactionType.Sale || t.Type == FarmerTransactionType.TransportFee)
            .Sum(t => t.Amount);
        var totalPaid = transactions.Where(t => t.Type == FarmerTransactionType.Payment).Sum(t => -t.Amount);
        // Bug fix: Remaining used to be openingBalance + totalNetDue - totalPaid, which silently
        // EXCLUDED Adjustment rows (the reversal posted when an invoice with a farmer/driver on it
        // is cancelled — see InvoiceService.CancelAsync). That made the headline "المتبقي" disagree
        // with the statement's own last RunningBalance the moment any invoice was ever cancelled —
        // exactly the kind of mismatch a detailed, invoice-traceable statement must never have.
        // Summing every transaction's own (already correctly signed) Amount is the same computation
        // AccountStatementBuilder.Build does internally, so this always matches the statement below.
        var remaining = openingBalance + transactions.Sum(t => t.Amount);

        return new FarmerAccountDto(
            partner.Id, partner.Name, partner.Type,
            totalSales, totalCommission, totalNetDue, totalPaid, remaining,
            partner.OpeningBalance,
            statement.Select(ToStatementLineDto).ToList());
    }

    /// <summary>See the interface doc comment. Farmer/driver ledger and merchant ledger are each
    /// aggregated in a handful of grouped queries (not one query per partner), matching the exact
    /// same Remaining formula as GetFarmerAccountAsync / GetMerchantAccountAsync.</summary>
    public async Task<DebtsOverviewDto> GetDebtsOverviewAsync()
    {
        var partners = await _db.Partners
            .Where(p => p.Type != null)
            .Select(p => new PartnerBalanceSeed(p.Id, p.Name, p.Type!.Value, p.OpeningBalance))
            .ToListAsync();

        // One sum of EVERY transaction's own (already correctly signed) Amount per farmer/driver —
        // Sale/TransportFee positive, Payment negative, Adjustment whatever sign the reversal needs
        // — is the exact same computation GetFarmerAccountAsync's Remaining and the statement's own
        // running balance use. (A previous version summed Sale+TransportFee and Payment separately
        // and left out Adjustment rows entirely, which meant a farmer/driver with a cancelled
        // invoice would show a different "المتبقي" here than on their own كشف حساب page.)
        var netAmountBySeller = await _db.FarmerTransactions
            .GroupBy(t => t.FarmerId)
            .Select(g => new { FarmerId = g.Key, Total = g.Sum(t => t.Amount) })
            .ToDictionaryAsync(x => x.FarmerId, x => x.Total);

        var purchasesByMerchant = await _db.Invoices
            .Where(i => i.Status == InvoiceStatus.Active)
            .GroupBy(i => i.MerchantId)
            .Select(g => new { MerchantId = g.Key, Total = g.Sum(i => i.TotalValue) })
            .ToDictionaryAsync(x => x.MerchantId, x => x.Total);

        // Same Bounced exclusion as ListAsync/GetMerchantAccountAsync — a bounced check isn't real money.
        var paidByMerchant = await _db.Payments
            .Where(p => p.Direction == PaymentDirection.FromMerchant && p.CheckStatus != CheckClearanceStatus.Bounced)
            .GroupBy(p => p.PartnerId)
            .Select(g => new { PartnerId = g.Key, Total = g.Sum(p => p.Amount) })
            .ToDictionaryAsync(x => x.PartnerId, x => x.Total);

        decimal SellerRemaining(int id, decimal? openingBalance) =>
            (openingBalance ?? 0) + netAmountBySeller.GetValueOrDefault(id);

        decimal MerchantRemaining(int id, decimal? openingBalance) =>
            (openingBalance ?? 0) + purchasesByMerchant.GetValueOrDefault(id) - paidByMerchant.GetValueOrDefault(id);

        List<PartnerDebtRow> BuildRows(IEnumerable<PartnerBalanceSeed> people, Func<int, decimal?, decimal> remainingFn) =>
            people
                .Select(p => new PartnerDebtRow(p.Id, p.Name, remainingFn(p.Id, p.OpeningBalance)))
                .Where(r => r.Remaining != 0)
                .OrderByDescending(r => Math.Abs(r.Remaining))
                .ToList();

        var farmers = BuildRows(partners.Where(p => p.Type == PartnerType.Farmer || p.Type == PartnerType.Both), SellerRemaining);
        var drivers = BuildRows(partners.Where(p => p.Type == PartnerType.Driver), SellerRemaining);
        var merchants = BuildRows(partners.Where(p => p.Type == PartnerType.Merchant || p.Type == PartnerType.Both), MerchantRemaining);

        return new DebtsOverviewDto(farmers, drivers, merchants);
    }

    /// <summary>See the interface doc comment — matches Invoice.DriverId for a Driver partner,
    /// Invoice.FarmerId for a Farmer/Both partner (same split as GetFarmerAccountAsync's own ledger
    /// query, just against Invoices+Items directly instead of FarmerTransactions, since this needs
    /// each item's own name/quantity/price, not just the ledger's already-netted amounts).</summary>
    public async Task<PartnerInvoiceDetailDto> GetFarmerInvoiceDetailAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        var query = partner.Type == PartnerType.Driver
            ? _db.Invoices.Where(i => i.DriverId == id && i.Status == InvoiceStatus.Active)
            : _db.Invoices.Where(i => i.FarmerId == id && i.Status == InvoiceStatus.Active);

        var invoices = await query.Include(i => i.Items)
            .OrderByDescending(i => i.Date).ThenByDescending(i => i.Id)
            .ToListAsync();

        return new PartnerInvoiceDetailDto(partner.Id, partner.Name, BuildInvoiceItemLines(invoices));
    }

    /// <summary>See the interface doc comment — matches Invoice.MerchantId.</summary>
    public async Task<PartnerInvoiceDetailDto> GetMerchantInvoiceDetailAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        var invoices = await _db.Invoices
            .Where(i => i.MerchantId == id && i.Status == InvoiceStatus.Active)
            .Include(i => i.Items)
            .OrderByDescending(i => i.Date).ThenByDescending(i => i.Id)
            .ToListAsync();

        return new PartnerInvoiceDetailDto(partner.Id, partner.Name, BuildInvoiceItemLines(invoices));
    }

    /// <summary>Flattens invoices (Items already loaded) into one row per item line — TransportFee/
    /// GrandTotal are computed once per invoice and repeated across that invoice's own item rows, same
    /// "invoice-level figure, not per-item" convention as PartnerInvoiceItemLineDto's doc comment
    /// warns about (mirrors InvoiceService.ListAsync's own WoodTotal/GrandTotal formula exactly, so
    /// this can never silently drift out of sync with what the invoice itself shows).</summary>
    private static List<PartnerInvoiceItemLineDto> BuildInvoiceItemLines(List<Invoice> invoices) =>
        invoices.SelectMany(i =>
        {
            var woodTotal = i.Items.Sum(it => it.WoodPrice);
            var grandTotal = i.TotalValue + i.TransportFee + woodTotal;
            return i.Items.Select(it => new PartnerInvoiceItemLineDto(
                i.Id, i.InvoiceNumber, i.Date,
                it.ItemName, it.Unit, it.Quantity, it.PricePerUnit, it.WoodPrice, it.LineTotal,
                i.TransportFee, grandTotal));
        }).ToList();

    /// <summary>See the interface doc comment: a hard, permanent removal, but only ever reachable
    /// on a partner that has never actually been used for anything — every AuditableEntity query
    /// (Invoices, Payments) is globally filtered to exclude soft-deleted rows, and deleting a
    /// partner who DOES have invoices/payments would turn "Merchant"/"Farmer"/"Driver" into a
    /// dangling reference that those queries' inner joins would then silently drop entirely.
    /// A partner with real history should simply stop being picked for new work, never removed.</summary>
    public async Task DeleteAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        var hasInvoices = await _db.Invoices.AnyAsync(i => i.MerchantId == id || i.FarmerId == id || i.DriverId == id);
        if (hasInvoices)
            throw new ConflictAppException("لا يمكن حذف هذا الشخص لوجود فواتير مرتبطة به.");

        var hasLedgerHistory = await _db.FarmerTransactions.AnyAsync(t => t.FarmerId == id);
        if (hasLedgerHistory)
            throw new ConflictAppException("لا يمكن حذف هذا الشخص لوجود حركات حساب (كشف حساب) مرتبطة به.");

        var hasPayments = await _db.Payments.AnyAsync(p => p.PartnerId == id);
        if (hasPayments)
            throw new ConflictAppException("لا يمكن حذف هذا الشخص لوجود دفعات مسجّلة له.");

        partner.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    private static StatementLineDto ToStatementLineDto(AccountStatementBuilder.StatementLine line) =>
        new(line.Date, line.Description, line.SignedAmount, line.RunningBalance,
            line.InvoiceId, line.InvoiceNumber, line.SaleValue, line.Commission, line.Method, line.Notes);

    private static PartnerDto ToDto(Partner p, decimal? farmerRemaining = null, decimal? merchantRemaining = null) =>
        new(p.Id, p.Name, p.Type, p.WhatsAppNumber, p.Address, p.Notes, p.CreditLimit, p.OpeningBalance, farmerRemaining, merchantRemaining);

    /// <summary>Minimal projection used only inside GetDebtsOverviewAsync — a typed stand-in for an
    /// anonymous type so it can be passed around a local helper function.</summary>
    private record PartnerBalanceSeed(int Id, string Name, PartnerType Type, decimal? OpeningBalance);
}
