using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>Requirement doc §6: "recording payments and linking them to accounts."</summary>
public interface IPaymentService
{
    Task<PaymentDto> CreateAsync(CreatePaymentRequest request, int recordedByUserId);

    /// <summary>
    /// Both sides of one person, and how much of them can be settled against each other.
    /// </summary>
    Task<PartnerBalancesDto> GetBalancesAsync(int partnerId);

    /// <summary>
    /// "مقاصّة" — settles what somebody owes as a BUYER against what the market owes them as a
    /// SELLER. Returns the two payments it wrote, buyer side first.
    ///
    /// The same man brings produce in the morning and buys something else in the afternoon, and
    /// until now the market handed him cash for the one and collected cash back for the other, on
    /// the same day, in opposite directions.
    /// </summary>
    Task<IReadOnlyList<PaymentDto>> CreateSettlementAsync(CreateSettlementRequest request, int recordedByUserId);

    /// <summary>
    /// What the same person owes as a BUYER, for deduction at the foot of his seller statement.
    ///
    /// Its own method, called by BOTH printed seller sheets, because the alternative was each of
    /// them reading a balance and deciding for itself — which is how one of them came to deduct a
    /// debt that did not exist:
    ///
    /// Zero when the person does not buy at all. الرصيد الافتتاحي is ONE field shared by both
    /// sides of a partner, so asking a pure seller for his buyer balance hands back his opening
    /// balance — and a sheet that deducted it would take his own old credit off what he is owed.
    /// </summary>
    Task<decimal> GetBuyerBalanceForSellerSheetAsync(int partnerId);

    /// <summary>Single-payment lookup for the edit form — previously the edit screen had to fetch
    /// and filter the whole paged list to find one row instead of asking for it directly.</summary>
    Task<PaymentDto> GetAsync(int id);
    /// <summary>Both filters are optional and independent. `invoiceId` backs the invoice edit
    /// page's "الدفعات على هذه الفاتورة" section — one invoice's payments can be several rows,
    /// since a payment split across methods (and a check-payment split across several checks)
    /// stores one row per check/method.</summary>
    Task<PagedResult<PaymentDto>> ListAsync(int? partnerId, int? invoiceId, int page, int pageSize);
    Task<PaymentDto> UpdateAsync(int id, UpdatePaymentRequest request);
    Task DeleteAsync(int id);

    /// <summary>"الشيكات" page: every payment recorded as a check (CheckDueDate set), regardless of
    /// direction/partner, soonest-due first — that's the order that actually matters for tracking
    /// which ones need attention next. Optionally narrowed to one CheckClearanceStatus and/or a
    /// CheckDueDate range (used by the print button to match whatever month/status the screen is
    /// currently filtered to).</summary>
    Task<PagedResult<PaymentDto>> ListChecksAsync(CheckClearanceStatus? status, DateTimeOffset? dueFrom, DateTimeOffset? dueTo, int page, int pageSize);
}

public class PaymentService : IPaymentService
{
    private readonly AppDbContext _db;
    private readonly IPartnerService _partners;

    public PaymentService(AppDbContext db, IPartnerService partners)
    {
        _db = db;
        _partners = partners;
    }

    public async Task<PaymentDto> CreateAsync(CreatePaymentRequest request, int recordedByUserId)
    {
        if (request.Amount <= 0) throw new ValidationAppException("Payment amount must be greater than zero.");

        var partner = await ResolvePartnerAsync(request.PartnerId, request.PartnerName, request.Direction);
        var invoice = await ResolveInvoiceLinkAsync(request.InvoiceId, partner.Id, request.Direction);

        var payment = new Payment
        {
            PartnerId = partner.Id,
            Direction = request.Direction,
            Amount = request.Amount,
            Date = request.Date,
            Method = request.Method,
            Notes = request.Notes,
            RecordedByUserId = recordedByUserId,
            InvoiceId = invoice?.Id,
            CheckDueDate = request.CheckDueDate,
            CheckNumber = request.CheckNumber,
            // A brand-new check always starts Pending — there is no "already cleared" state to
            // create it in; CheckStatus only ever moves forward from here via UpdateAsync.
            CheckStatus = request.CheckDueDate is not null ? CheckClearanceStatus.Pending : null
            // CheckClearedDate stays null here for the same reason — it's only ever set once the
            // check actually clears, via UpdateAsync.
        };

        // The payment row and its linked FarmerTransaction ledger row are two separate
        // SaveChangesAsync calls (the second needs payment.Id) — wrapped in one DB transaction so
        // a failure/interruption between them can never leave a payment recorded without its
        // matching ledger entry (or vice versa), instead of two independent, non-atomic writes.
        await using var transaction = await _db.Database.BeginTransactionAsync();

        _db.Payments.Add(payment);
        await _db.SaveChangesAsync(); // need payment.Id for the FarmerTransaction link below

        // Only payments TO a farmer or driver post to the internal farmer ledger (requirement doc
        // §5/§6); payments FROM a merchant just reduce their invoice balance, computed on the fly
        // in PartnerService.GetMerchantAccountAsync from Payments directly.
        if (request.Direction is PaymentDirection.ToFarmer or PaymentDirection.ToDriver)
        {
            // A brand-new check always starts Pending, so it posts as 0 — the farmer/driver hasn't
            // been paid until it clears (see PaymentRules). The ledger row is still created, so
            // the payment is visible on their statement right away, and UpdateAsync flips the
            // amount to the real one the moment someone marks the check Cleared.
            var counts = PaymentRules.CountsTowardBalance(payment.CheckStatus);
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = partner.Id,
                Type = FarmerTransactionType.Payment,
                PaymentId = payment.Id,
                Date = payment.Date,
                Amount = counts ? -payment.Amount : 0,
                Notes = counts ? payment.Notes : $"{payment.Notes} (شيك قيد التحصيل — لم يُحتسب بعد)".Trim()
            });
            await _db.SaveChangesAsync();
        }

        await transaction.CommitAsync();

        return ToDto(payment, partner.Name, invoice?.InvoiceNumber);
    }

    public async Task<PaymentDto> GetAsync(int id)
    {
        var payment = await _db.Payments.Include(p => p.Partner).Include(p => p.Invoice)
            .SingleOrDefaultAsync(p => p.Id == id) ?? throw new NotFoundAppException("Payment", id);
        return ToDto(payment, payment.Partner.Name, payment.Invoice?.InvoiceNumber);
    }

    public async Task<PagedResult<PaymentDto>> ListAsync(int? partnerId, int? invoiceId, int page, int pageSize)
    {
        // PaymentsController's own print button calls this with pageSize=10000 (print
        // everything matching the current filter) — ceiling set above that instead of the usual
        // 200, so that legitimate request isn't silently truncated down to the default.
        (page, pageSize) = Paging.Clamp(page, pageSize, maxPageSize: 20_000);

        var query = _db.Payments.Include(p => p.Partner).Include(p => p.Invoice).AsQueryable();
        if (partnerId is not null) query = query.Where(p => p.PartnerId == partnerId);
        if (invoiceId is not null) query = query.Where(p => p.InvoiceId == invoiceId);

        var total = await query.CountAsync();
        var items = await query.OrderByDescending(p => p.Date)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new PaymentDto(p.Id, p.PartnerId, p.Partner.Name, p.Direction, p.Amount, p.Date, p.Method, p.Notes, p.InvoiceId, p.Invoice != null ? p.Invoice.InvoiceNumber : null, p.CheckDueDate, p.CheckNumber, p.CheckStatus, p.CheckClearedDate, p.OffsetGroupId))
            .ToListAsync();

        return new PagedResult<PaymentDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    public async Task<PagedResult<PaymentDto>> ListChecksAsync(CheckClearanceStatus? status, DateTimeOffset? dueFrom, DateTimeOffset? dueTo, int page, int pageSize)
    {
        // Same reasoning as ListAsync above — the checks print button calls this with
        // pageSize=10000, so the ceiling has to sit above that too.
        (page, pageSize) = Paging.Clamp(page, pageSize, maxPageSize: 20_000, defaultPageSize: 50);

        var query = _db.Payments.Include(p => p.Partner).Include(p => p.Invoice)
            .Where(p => p.CheckDueDate != null);
        if (status is not null) query = query.Where(p => p.CheckStatus == status);
        if (dueFrom is not null) query = query.Where(p => p.CheckDueDate >= dueFrom);
        if (dueTo is not null) query = query.Where(p => p.CheckDueDate <= dueTo);

        var total = await query.CountAsync();
        var items = await query.OrderBy(p => p.CheckDueDate)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new PaymentDto(p.Id, p.PartnerId, p.Partner.Name, p.Direction, p.Amount, p.Date, p.Method, p.Notes, p.InvoiceId, p.Invoice != null ? p.Invoice.InvoiceNumber : null, p.CheckDueDate, p.CheckNumber, p.CheckStatus, p.CheckClearedDate, p.OffsetGroupId))
            .ToListAsync();

        return new PagedResult<PaymentDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    /// <summary>
    /// Never changes the partner or direction — that would mean unwinding and redoing which
    /// ledger this payment posted to. For a ToFarmer payment, the linked FarmerTransaction's
    /// amount/date/notes are kept in sync so the farmer's running balance stays correct.
    /// </summary>
    public async Task<PaymentDto> UpdateAsync(int id, UpdatePaymentRequest request)
    {
        if (request.Amount <= 0) throw new ValidationAppException("Payment amount must be greater than zero.");

        var payment = await _db.Payments.Include(p => p.Partner).SingleOrDefaultAsync(p => p.Id == id)
            ?? throw new NotFoundAppException("Payment", id);

        var invoice = await ResolveInvoiceLinkAsync(request.InvoiceId, payment.PartnerId, payment.Direction);

        payment.Amount = request.Amount;
        payment.Date = request.Date;
        payment.Method = request.Method;
        payment.Notes = request.Notes;
        payment.InvoiceId = invoice?.Id;
        payment.CheckDueDate = request.CheckDueDate;
        payment.CheckNumber = request.CheckNumber;
        // Explicit request.CheckStatus (e.g. the Checks page marking one Cleared/Bounced) wins;
        // otherwise keep whatever it already was, defaulting a still-a-check payment to Pending
        // and clearing it entirely once CheckDueDate is removed (no longer a check at all).
        payment.CheckStatus = request.CheckStatus ?? (request.CheckDueDate is not null ? (payment.CheckStatus ?? CheckClearanceStatus.Pending) : null);
        payment.CheckClearedDate = payment.CheckStatus == CheckClearanceStatus.Cleared ? (request.CheckClearedDate ?? payment.CheckClearedDate) : null;

        if (payment.Direction is PaymentDirection.ToFarmer or PaymentDirection.ToDriver)
        {
            var transaction = await _db.FarmerTransactions.SingleOrDefaultAsync(t => t.PaymentId == payment.Id);
            if (transaction is not null)
            {
                // A check only pays the farmer/driver once it clears — anything else posts as 0
                // instead of -Amount, keeping their remaining balance correct (see PaymentRules).
                // This is the write-side mirror of the merchant-side rule in PartnerService, and
                // it works in both directions: marking a check Cleared restores the real amount,
                // marking it back to Pending/Bounced zeroes it again.
                var counts = PaymentRules.CountsTowardBalance(payment.CheckStatus);
                transaction.Amount = counts ? -payment.Amount : 0;
                transaction.Date = payment.Date;
                transaction.Notes = counts
                    ? payment.Notes
                    : payment.CheckStatus == CheckClearanceStatus.Bounced
                    ? $"{payment.Notes} (شيك ارتد — لم يُحتسب)".Trim()
                    : $"{payment.Notes} (شيك قيد التحصيل — لم يُحتسب بعد)".Trim();
            }
        }

        await _db.SaveChangesAsync();
        return ToDto(payment, payment.Partner.Name, invoice?.InvoiceNumber);
    }

    /// <summary>
    /// Soft-deletes the payment (it inherits AuditableEntity, so the global query filter hides it
    /// from then on) and, for a ToFarmer payment, hard-deletes its linked FarmerTransaction row —
    /// FarmerTransaction has no soft-delete column of its own, and leaving a stale ledger line
    /// behind would silently corrupt every farmer balance computed from it.
    /// </summary>
    public async Task DeleteAsync(int id)
    {
        var payment = await _db.Payments.SingleOrDefaultAsync(p => p.Id == id)
            ?? throw new NotFoundAppException("Payment", id);

        // A مقاصّة is one event written as two rows. Deleting half of it would leave the books out
        // by the amount — his buyer balance corrected and his seller balance not, or the reverse —
        // so the pair goes together however it was reached.
        var group = payment.OffsetGroupId is null
            ? new List<Payment> { payment }
            : await _db.Payments.Where(p => p.OffsetGroupId == payment.OffsetGroupId).ToListAsync();

        foreach (var row in group)
        {
            if (row.Direction is PaymentDirection.ToFarmer or PaymentDirection.ToDriver)
            {
                var transaction = await _db.FarmerTransactions.SingleOrDefaultAsync(t => t.PaymentId == row.Id);
                if (transaction is not null) _db.FarmerTransactions.Remove(transaction);
            }
            row.IsDeleted = true;
        }

        await _db.SaveChangesAsync();
    }

    public async Task<PartnerBalancesDto> GetBalancesAsync(int partnerId)
    {
        var partner = await _db.Partners.FindAsync(partnerId)
            ?? throw new NotFoundAppException("Partner", partnerId);

        // Three aggregate queries, not two whole account pages.
        //
        // This used to ask GetMerchantAccountAsync and GetFarmerAccountAsync, on the grounds that
        // a second opinion about what somebody owes is how this system gets money wrong. The
        // grounds were right and the method was not: those two build a complete STATEMENT — every
        // invoice, every payment, every ledger row, assembled into running balances — to hand back
        // one number each. And it is read on every visit to either account page (OtherSideNotice),
        // which already built one of them: three full statements to show one line.
        //
        // The formulas are the same formulas, because they are now a function both sides call
        // (Domain.Services.PartnerBalance) rather than the same arithmetic typed out again.
        var openingBalance = partner.OpeningBalance ?? 0;

        var purchases = await _db.Invoices
            .Where(i => i.MerchantId == partnerId && i.Status == InvoiceStatus.Active)
            .SumAsync(i => (decimal?)i.GrandTotal) ?? 0m;

        // A check that has not cleared is not money yet — the same rule every 'paid' sum obeys.
        var paid = await _db.Payments
            .Where(PaymentRules.CountsTowardBalanceExpression)
            .Where(p => p.PartnerId == partnerId && p.Direction == PaymentDirection.FromMerchant)
            .SumAsync(p => (decimal?)p.Amount) ?? 0m;

        var ledgerNet = await _db.FarmerTransactions
            .Where(t => t.FarmerId == partnerId)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;

        var buyerOwes = PartnerBalance.ForBuyer(openingBalance, purchases, paid);
        var marketOwesSeller = PartnerBalance.ForSeller(openingBalance, ledgerNet);

        return new PartnerBalancesDto(
            partner.Id, partner.Name,
            buyerOwes, marketOwesSeller);
    }

    public async Task<decimal> GetBuyerBalanceForSellerSheetAsync(int partnerId)
    {
        var partner = await _db.Partners.FindAsync(partnerId)
            ?? throw new NotFoundAppException("Partner", partnerId);

        // The same test a تسوية uses to decide whether the amount lands on his buyer account at
        // all. Somebody with no buyer side has no buyer debt, whatever a balance query returns.
        if (!SettlementSides.TouchesBuyer(partner.Type)) return 0m;

        return (await GetBalancesAsync(partnerId)).BuyerOwes;
    }

    /// <summary>
    /// An amount written straight onto somebody's account — see Domain.Services.SettlementSides
    /// for what this replaced and why.
    ///
    /// No ceiling and no "there is nothing to settle". Both used to be here, and both were
    /// correct: settling more than the market owes him leaves him owing it as a seller, out of
    /// nothing. They are gone because the market asked for them to be — it knows what it agreed
    /// with the man in front of it, and a screen that refuses the figure he agreed to is a screen
    /// nobody opens. A settlement is an ordinary payment either way, so an amount that overshoots
    /// shows up as a credit on the account and is deleted like any other payment.
    ///
    /// What it will NOT do is invent an account. The amount lands on the sides the person
    /// actually has, and the screen says which before you press save.
    /// </summary>
    public async Task<IReadOnlyList<PaymentDto>> CreateSettlementAsync(
        CreateSettlementRequest request, int recordedByUserId)
    {
        if (request.Amount <= 0)
            throw new ValidationAppException("قيمة التسوية لازم تكون أكبر من صفر.");

        var partner = await _db.Partners.FindAsync(request.PartnerId)
            ?? throw new NotFoundAppException("Partner", request.PartnerId);

        // Read, never granted. Elsewhere in this file typing a name into a field IS the statement
        // that the person plays that role — but nobody is naming a role here, and turning a plain
        // seller into a buyer as a side effect of settling his account would put a credit on a
        // page that should not exist for him.
        var onSeller = SettlementSides.TouchesSeller(partner.Type);
        var onBuyer = SettlementSides.TouchesBuyer(partner.Type);

        var group = Guid.NewGuid();
        var notes = string.IsNullOrWhiteSpace(request.Notes)
            ? "تسوية على الحساب"
            : request.Notes!.Trim();

        Payment Half(PaymentDirection direction) => new()
        {
            PartnerId = partner.Id,
            Direction = direction,
            Amount = request.Amount,
            Date = request.Date,
            Method = SettlementMethod,
            Notes = notes,
            RecordedByUserId = recordedByUserId,
            OffsetGroupId = group
            // No invoice link and no check: a مقاصّة settles a BALANCE, and there is no paper.
        };

        var fromBuyer = onBuyer ? Half(PaymentDirection.FromMerchant) : null;
        var toSeller = onSeller ? Half(PaymentDirection.ToFarmer) : null;

        // One transaction over every write, for the reason CreateAsync gives: half a settlement
        // is worse than none, because it silently moves one balance and not the other.
        await using var transaction = await _db.Database.BeginTransactionAsync();

        if (fromBuyer is not null) _db.Payments.Add(fromBuyer);
        if (toSeller is not null) _db.Payments.Add(toSeller);
        await _db.SaveChangesAsync(); // need toSeller.Id for the ledger row below

        // The seller half posts to the internal ledger exactly as an ordinary payment to a seller
        // does — same table, same sign, same shape — so his statement reads it without knowing
        // anything about settlements. Never a check, so it always counts immediately.
        if (toSeller is not null)
        {
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = partner.Id,
                Type = FarmerTransactionType.Payment,
                PaymentId = toSeller.Id,
                Date = toSeller.Date,
                Amount = -toSeller.Amount,
                Notes = notes
            });
            await _db.SaveChangesAsync();
        }
        await transaction.CommitAsync();

        // Buyer side first: it is the half that answers "what happened to what he owed me".
        return new[] { fromBuyer, toSeller }
            .Where(p => p is not null)
            .Select(p => ToDto(p!, partner.Name, null))
            .ToList();
    }

    /// <summary>Direction tells us which side of the ledger a partner belongs on: ToFarmer =>
    /// Farmer, ToDriver => Driver, FromMerchant => Merchant (mirrors the same resolution used for
    /// invoices). When an existing partner id is passed directly (not a new name), its actual
    /// stored type is now checked against that expectation — previously any partner id was
    /// accepted as-is regardless of type, so a merchant id could be posted as a "payment to a
    /// farmer" and silently corrupt both ledgers (see PartnerTypeMatches's doc comment for exactly
    /// which combinations are allowed).</summary>
    private async Task<Partner> ResolvePartnerAsync(int? id, string? name, PaymentDirection direction)
    {
        var expectedType = ExpectedPartnerType(direction);

        // Paying someone as a driver IS the statement that they drive, exactly as on an invoice —
        // and typing their name here has always granted the role, so refusing the id was the odd one
        // out. See PartnerService.GetWithRoleAsync.
        if (id is not null)
            return await _partners.GetWithRoleAsync(id.Value, expectedType, PartnerTypeLabel(expectedType));

        if (!string.IsNullOrWhiteSpace(name))
            return await _partners.FindOrCreateAsync(name, expectedType);

        throw new ValidationAppException("Either an existing partner or a partner name is required.");
    }

    private static PartnerType ExpectedPartnerType(PaymentDirection direction) => direction switch
    {
        PaymentDirection.ToFarmer => PartnerType.Farmer,
        PaymentDirection.ToDriver => PartnerType.Driver,
        _ => PartnerType.Merchant
    };

    /// <summary>Same "Both" allowance used everywhere else a partner's type is checked (see
    /// PartnerService.ListAsync's sellerIds/merchantIds grouping): a partner marked Both can act as
    /// either Farmer or Merchant, since that's exactly what Both means (requirement doc §3 — a
    /// person who is both a seller and a buyer). Driver is deliberately its own type, never folded
    /// into Both, so only an actual Driver partner satisfies a Driver expectation. Partner.Type
    /// itself is nullable (staff can record a person before knowing their role — see
    /// PartnerService.ValidateNameAndType/PartnersPage's "النوع (اختياري)" field): a still-unset
    /// Type can't fail this check without also blocking that pre-existing, intentional flow, so it
    /// is passed through here rather than rejected.</summary>
    private static bool PartnerTypeMatches(PartnerType? actual, PartnerType expected) => actual is null || expected switch
    {
        PartnerType.Farmer => PartnerRoles.Has(actual, PartnerType.Farmer),
        PartnerType.Merchant => PartnerRoles.Has(actual, PartnerType.Merchant),
        PartnerType.Driver => PartnerRoles.Has(actual, PartnerType.Driver),
        _ => actual == expected
    };

    private static string PartnerTypeLabel(PartnerType type) => type switch
    {
        PartnerType.Farmer => "بائع",
        PartnerType.Merchant => "مشتري",
        PartnerType.Driver => "سائق",
        _ => type.ToString()
    };

    /// <summary>Validates that an optional invoice link actually belongs to the partner this
    /// payment is against, matched on the exact same side the direction says it should be (a
    /// merchant payment to their own MerchantId, a farmer payment to their own FarmerId, a driver
    /// payment to their own DriverId — no longer "FarmerId OR DriverId" for both directions now
    /// that ToFarmer/ToDriver are separate), and that the invoice hasn't since been cancelled — a
    /// cancelled invoice's totals no longer count anywhere, so linking a payment to one left it
    /// showing on statements against a total that no longer exists.</summary>
    private async Task<Invoice?> ResolveInvoiceLinkAsync(int? invoiceId, int partnerId, PaymentDirection direction)
    {
        if (invoiceId is null) return null;

        var invoice = await _db.Invoices.FindAsync(invoiceId) ?? throw new NotFoundAppException("Invoice", invoiceId);
        var belongsToPartner = direction switch
        {
            PaymentDirection.FromMerchant => invoice.MerchantId == partnerId,
            PaymentDirection.ToFarmer => invoice.FarmerId == partnerId,
            PaymentDirection.ToDriver => invoice.DriverId == partnerId,
            _ => false
        };

        if (!belongsToPartner)
            throw new ValidationAppException("The selected invoice does not belong to this partner.");
        if (invoice.Status != InvoiceStatus.Active)
            throw new ValidationAppException("لا يمكن ربط دفعة بفاتورة ملغاة.");

        return invoice;
    }

    private static PaymentDto ToDto(Payment p, string partnerName, string? invoiceNumber) =>
        new(p.Id, p.PartnerId, partnerName, p.Direction, p.Amount, p.Date, p.Method, p.Notes, p.InvoiceId, invoiceNumber, p.CheckDueDate, p.CheckNumber, p.CheckStatus, p.CheckClearedDate, p.OffsetGroupId);

    /// <summary>
    /// What a مقاصّة is called in the "طريقة الدفع" column, on both halves.
    ///
    /// It matters that this reads as its own thing rather than as "نقدي": somebody reconciling a
    /// day's cash must be able to see at a glance that these two rows moved no money at all.
    /// </summary>
    /// <summary>
    /// What a settlement row reads as in the "طريقة الدفع" column. Not a payment method at all — no
    /// cash, no cheque — which is exactly why it says so instead of leaving the column blank.
    ///
    /// Rows written before this was called "تسوية" carry the old word; a one-time relabel in
    /// Program.cs brings them over, so there is one spelling in the table and not two.
    /// </summary>
    public const string SettlementMethod = "تسوية";
}
