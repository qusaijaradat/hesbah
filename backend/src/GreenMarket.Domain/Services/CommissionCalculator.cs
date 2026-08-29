namespace GreenMarket.Domain.Services;

/// <summary>
/// Requirement doc §5 — the market's commission math, in one place so the 7% default
/// (or whatever rate Settings holds at the time) is always applied the same way,
/// whether called from invoice creation, a report, or a what-if preview in the UI.
/// </summary>
public static class CommissionCalculator
{
    public readonly record struct Result(decimal Commission, decimal NetDueToFarmer);

    /// <summary>
    /// Example from the spec: Calculate(10_000, 0.07m) => Commission = 700, NetDueToFarmer = 9_300.
    /// </summary>
    public static Result Calculate(decimal saleValue, decimal commissionRate)
    {
        if (saleValue < 0)
            throw new ArgumentOutOfRangeException(nameof(saleValue), "Sale value cannot be negative.");
        if (commissionRate is < 0 or > 1)
            throw new ArgumentOutOfRangeException(nameof(commissionRate), "Commission rate must be between 0 and 1 (e.g. 0.07 for 7%).");

        var commission = Math.Round(saleValue * commissionRate, 2, MidpointRounding.AwayFromZero);
        var netDue = saleValue - commission;
        return new Result(commission, netDue);
    }
}
