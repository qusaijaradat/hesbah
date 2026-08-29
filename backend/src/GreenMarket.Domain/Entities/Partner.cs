using GreenMarket.Domain.Common;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// A farmer and/or merchant. Requirement doc §3: one unified table for both, with a
/// name-suggestion lookup on entry and the WhatsApp number as the only approved
/// reference number (no address / separate phone number required) — this also
/// doubles as the destination number for the WhatsApp invoice-sending feature (§9).
/// </summary>
public class Partner : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public PartnerType? Type { get; set; }

    /// <summary>The approved reference number (requirement doc §3) — also used to send invoices via WhatsApp (§9).</summary>
    public string? WhatsAppNumber { get; set; }

    public string? Notes { get; set; }

    /// <summary>
    /// Optional soft ceiling on a merchant's outstanding balance (requirement roadmap: "credit
    /// limit per merchant"). Null means no limit is enforced. This is advisory only — invoices
    /// are never blocked from being created — the UI simply warns when a merchant's remaining
    /// balance would exceed it, so someone can decide whether to keep selling to them on credit.
    /// </summary>
    public decimal? CreditLimit { get; set; }

    public ICollection<Invoice> Invoices { get; set; } = new List<Invoice>();
    public ICollection<FarmerTransaction> FarmerTransactions { get; set; } = new List<FarmerTransaction>();
    public ICollection<Payment> Payments { get; set; } = new List<Payment>();
}
