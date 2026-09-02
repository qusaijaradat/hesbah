using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>Requirement doc §6: "recording payments and linking them to accounts."</summary>
public interface IPaymentService
{
    Task<PaymentDto> CreateAsync(CreatePaymentRequest request, int recordedByUserId);
    Task<PagedResult<PaymentDto>> ListAsync(int? partnerId, int page, int pageSize);
    Task<PaymentDto> UpdateAsync(int id, UpdatePaymentRequest request);
    Task DeleteAsync(int id);
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
            InvoiceId = invoice?.Id
        };
        _db.Payments.Add(payment);
        await _db.SaveChangesAsync(); // need payment.Id for the FarmerTransaction link below

        // Only payments TO a farmer post to the internal farmer ledger (requirement doc §5/§6);
        // payments FROM a merchant just reduce their invoice balance, computed on the fly in
        // PartnerService.GetMerchantAccountAsync from Payments directly.
        if (request.Direction == PaymentDirection.ToFarmer)
        {
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = partner.Id,
                Type = FarmerTransactionType.Payment,
                PaymentId = payment.Id,
                Date = payment.Date,
                Amount = -payment.Amount,
                Notes = payment.Notes
            });
            await _db.SaveChangesAsync();
        }

        return ToDto(payment, partner.Name, invoice?.InvoiceNumber);
    }

    public async Task<PagedResult<PaymentDto>> ListAsync(int? partnerId, int page, int pageSize)
    {
        var query = _db.Payments.Include(p => p.Partner).Include(p => p.Invoice).AsQueryable();
        if (partnerId is not null) query = query.Where(p => p.PartnerId == partnerId);

        var total = await query.CountAsync();
        var items = await query.OrderByDescending(p => p.Date)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new PaymentDto(p.Id, p.PartnerId, p.Partner.Name, p.Direction, p.Amount, p.Date, p.Method, p.Notes, p.InvoiceId, p.Invoice != null ? p.Invoice.InvoiceNumber : null))
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

        if (payment.Direction == PaymentDirection.ToFarmer)
        {
            var transaction = await _db.FarmerTransactions.SingleOrDefaultAsync(t => t.PaymentId == payment.Id);
            if (transaction is not null)
            {
                transaction.Amount = -payment.Amount;
                transaction.Date = payment.Date;
                transaction.Notes = payment.Notes;
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

        if (payment.Direction == PaymentDirection.ToFarmer)
        {
            var transaction = await _db.FarmerTransactions.SingleOrDefaultAsync(t => t.PaymentId == payment.Id);
            if (transaction is not null) _db.FarmerTransactions.Remove(transaction);
        }

        payment.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    /// <summary>Direction tells us which side of the ledger a brand-new partner belongs on:
    /// ToFarmer => Farmer, FromMerchant => Merchant (mirrors the same resolution used for invoices).</summary>
    private async Task<Partner> ResolvePartnerAsync(int? id, string? name, PaymentDirection direction)
    {
        if (id is not null)
            return await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        if (!string.IsNullOrWhiteSpace(name))
        {
            var type = direction == PaymentDirection.ToFarmer ? PartnerType.Farmer : PartnerType.Merchant;
            return await _partners.FindOrCreateAsync(name, type);
        }

        throw new ValidationAppException("Either an existing partner or a partner name is required.");
    }

    /// <summary>Validates that an optional invoice link actually belongs to the partner this
    /// payment is against — a merchant payment can only link to one of their own invoices, and a
    /// ToFarmer payment (which covers both farmers AND drivers — see PaymentDirection.ToFarmer) to
    /// one they were either the farmer OR the driver on.</summary>
    private async Task<Invoice?> ResolveInvoiceLinkAsync(int? invoiceId, int partnerId, PaymentDirection direction)
    {
        if (invoiceId is null) return null;

        var invoice = await _db.Invoices.FindAsync(invoiceId) ?? throw new NotFoundAppException("Invoice", invoiceId);
        var belongsToPartner = direction == PaymentDirection.FromMerchant
            ? invoice.MerchantId == partnerId
            : invoice.FarmerId == partnerId || invoice.DriverId == partnerId;

        if (!belongsToPartner)
            throw new ValidationAppException("The selected invoice does not belong to this partner.");

        return invoice;
    }

    private static PaymentDto ToDto(Payment p, string partnerName, string? invoiceNumber) =>
        new(p.Id, p.PartnerId, partnerName, p.Direction, p.Amount, p.Date, p.Method, p.Notes, p.InvoiceId, invoiceNumber);
}
