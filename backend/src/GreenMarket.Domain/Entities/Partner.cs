using GreenMarket.Domain.Common;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// A farmer and/or merchant. Requirement doc §3: one unified table for both, with a
/// name-suggestion lookup on entry and the WhatsApp number as the approved reference
/// number — this also doubles as the destination number for the WhatsApp invoice-sending
/// feature (§9). Address was added later as a plain optional free-text field (no delivery
/// logic depends on it — see <see cref="Address"/>).
/// </summary>
public class Partner : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public PartnerType? Type { get; set; }

    /// <summary>The approved reference number (requirement doc §3) — also used to send invoices via WhatsApp (§9).</summary>
    public string? WhatsAppNumber { get; set; }

    /// <summary>"العنوان" — optional free-text address, purely informational (not used in any
    /// calculation or printed document unless explicitly added later).</summary>
    public string? Address { get; set; }

    public string? Notes { get; set; }

    /// <summary>
    /// Optional soft ceiling on a merchant's outstanding balance (requirement roadmap: "credit
    /// limit per merchant"). Null means no limit is enforced. This is advisory only — invoices
    /// are never blocked from being created — the UI simply warns when a merchant's remaining
    /// balance would exceed it, so someone can decide whether to keep selling to them on credit.
    /// </summary>
    public decimal? CreditLimit { get; set; }

    /// <summary>
    /// "الرصيد الافتتاحي" — a manually-entered starting balance, for a person who already had money
    /// owed to/from them before this system was in use. Null/0 means no opening balance. Sign
    /// convention matches whichever "remaining" figure this partner's own account page/report
    /// shows: for a merchant, positive = they already owed the market that much; for a farmer or
    /// driver, positive = the market already owed THEM that much. Folded into every remaining/
    /// previous-balance calculation (PartnerService.GetMerchantAccountAsync/GetFarmerAccountAsync,
    /// InvoiceService.ComputePreviousBalanceAsync) on top of whatever invoices/payments come after
    /// it — it is never itself changed automatically; only a person editing the partner record
    /// changes it again.
    /// </summary>
    public decimal? OpeningBalance { get; set; }

    public ICollection<Invoice> Invoices { get; set; } = new List<Invoice>();
    public ICollection<FarmerTransaction> FarmerTransactions { get; set; } = new List<FarmerTransaction>();
    public ICollection<Payment> Payments { get; set; } = new List<Payment>();
}
