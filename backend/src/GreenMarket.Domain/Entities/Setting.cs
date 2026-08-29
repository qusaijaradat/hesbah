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
        public const string WhatsAppBusinessNumber = "whatsapp.business_number";

        /// <summary>Shown on the invoice/statement print header alongside the market name.</summary>
        public const string RegistrationNumber = "market.registration_number";
        public const string Phone = "market.phone";
        public const string Address = "market.address";
    }
}
