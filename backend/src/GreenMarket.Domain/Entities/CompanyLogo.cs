namespace GreenMarket.Domain.Entities;

/// <summary>
/// Singleton row (Id is always 1) holding the market's uploaded logo image, shown in Settings and
/// on printed invoice PDFs. Stored in the database rather than on disk deliberately: docker-compose.yml
/// only gives the "postgres" service a persistent volume — the "api" container's own filesystem is
/// thrown away on every restart/redeploy, so a file saved there would silently disappear.
/// </summary>
public class CompanyLogo
{
    public int Id { get; set; } = 1;
    public byte[] Content { get; set; } = Array.Empty<byte>();
    public string ContentType { get; set; } = "image/png";
    public DateTimeOffset UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }
}
