using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Services;

/// <summary>
/// Who may be told about what needs attention — on a phone, on a laptop, in the banner, anywhere.
///
/// Two rules, and the second is the one that was missing.
///
/// A person must be able to SEE the thing. That was always enforced: a role without payments.view
/// was never told about a check, because being told is itself being given the fact.
///
/// And a person must be able to DO something about it. An alert is not news, it is a job: the
/// banner exists to say "this is wrong and it is fixable now". Telling somebody an invoice is
/// unpriced when they may not price one is handing them a chore they cannot discharge — they look,
/// they cannot act, and the next alert gets read with the same shrug. That is how a banner dies.
///
/// So each kind is gated on the permission that OPENS the page AND the permission that FIXES the
/// thing:
///
///   checks    — payments.view  + payments.edit  (marking one cleared or bounced)
///   invoices  — invoices.view  + invoices.edit  (pricing the line, via "تعديل الفاتورة")
///   sacks     — sacks.view     + sacks.create   (recording the return)
///
/// It lives in the Domain, alone, and both callers ask it rather than deciding for themselves.
/// The banner's controller and the morning push each used to compute the same three flags from
/// their own copy of the rule — which is the exact shape of every bug this codebase has had: a
/// rule copied instead of called, so tightening it in one place would have left the other one
/// answering the old question forever.
/// </summary>
public static class AlertVisibility
{
    /// <summary>Which families of alert this permission set may be told about.</summary>
    public readonly record struct Visible(bool Checks, bool Invoices, bool Sacks)
    {
        /// <summary>Nothing at all — worth asking before doing any work to build alerts.</summary>
        public bool None => !Checks && !Invoices && !Sacks;
    }

    public static Visible For(IEnumerable<string>? permissions)
    {
        if (permissions is null) return new Visible(false, false, false);
        var held = permissions as ISet<string> ?? new HashSet<string>(permissions, StringComparer.Ordinal);

        bool Can(string see, string act) => held.Contains(see) && held.Contains(act);

        return new Visible(
            Checks: Can(PermissionKeys.PaymentsView, PermissionKeys.PaymentsEdit),
            Invoices: Can(PermissionKeys.InvoicesView, PermissionKeys.InvoicesEdit),
            Sacks: Can(PermissionKeys.SacksView, PermissionKeys.SacksCreate));
    }
}
