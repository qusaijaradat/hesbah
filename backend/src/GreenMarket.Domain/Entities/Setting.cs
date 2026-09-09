namespace GreenMarket.Domain.Entities;

/// <summary>
/// Simple key/value settings store. Requirement doc §5 explicitly asks for the 7%
/// commission rate to be configurable rather than hard-coded, so it lives here
/// (key "commission.default_rate") instead of in appsettings.json.
/// </summary>
public class Setting
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }

    public static class Keys
    {
        public const string DefaultCommissionRate = "commission.default_rate";
        public const string MarketName = "market.name";
        // No WhatsAppBusinessNumber key. It existed, was labelled "رقم WhatsApp Business لإرسال
        // الفواتير", and sent nothing: the send path is a wa.me link that opens in the staff
        // member's own WhatsApp, and this value was only ever written INTO the message text as
        // the company's phone — which is what Phone below already is. Two settings for one fact,
        // one of them promising a capability the app did not have. The real sender configuration
        // (a phone number id and an access token) arrives with the WhatsApp Business API work,
        // which is a different thing entirely and should not inherit a misleading key.

        /// <summary>Shown on the invoice/statement print header alongside the market name.</summary>
        public const string RegistrationNumber = "market.registration_number";
        public const string Phone = "market.phone";
        public const string Address = "market.address";

        /// <summary>"سعر الصندوق" — a per-box shekel fee, configurable so it can be raised later
        /// without a code change. Applied AUTOMATICALLY to every invoice that has Box-unit items:
        /// (total box-unit quantity on that invoice) × (this value AT THE TIME the invoice was
        /// created — see Invoice.BoxPriceApplied). Completely separate/additive to the existing
        /// manual per-line "سعر الخشب" (InvoiceItem.WoodPrice) — both can be non-zero on the same
        /// invoice at once, per explicit request.</summary>
        public const string BoxPrice = "boxes.price";

        /// <summary>Driver-side counterpart to <see cref="BoxPrice"/> above, but the OPPOSITE
        /// direction of money: this is a per-box handling fee owed TO the driver (e.g. loading/
        /// unloading crates), not charged to the merchant. Applied AUTOMATICALLY to every invoice
        /// that has Box-unit items: (total box-unit quantity on that invoice) × (this value AT THE
        /// TIME the invoice was created — see Invoice.DriverBoxFeeApplied), added on top of the
        /// invoice's own manual "أجرة النقل" (TransportFee) into what the driver is actually owed —
        /// shown, itemized, and explained on "كشف أجرة نقل السائق" (ExportService.
        /// GenerateDriverManifestPdf). Entirely separate from the merchant-facing BoxPrice above.</summary>
        public const string DriverBoxFee = "boxes.driver_fee";
    }
}
