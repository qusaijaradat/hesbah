import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/**
 * Two tiny links that turn a reference printed in a table into the record it refers to.
 *
 * They exist as shared components rather than as a `<Link>` written out at each of the dozen or so
 * call sites because both carry the same two decisions, and both are easy to get subtly wrong one
 * table at a time:
 *
 *   • WHERE a reference goes — a seller and a driver share one account page while a buyer has its
 *     own, and that mapping should live in one place rather than being remembered per column;
 *   • WHETHER it should be a link at all — the destination pages are permission-gated, and the
 *     page showing the reference often is not. payments.view does not imply invoices.view, and
 *     roles are editable here, so a role can genuinely end up seeing a name it may not open. In
 *     that case the text still shows, plainly — a reader loses nothing, they just don't get a
 *     link that would bounce them off ProtectedRoute.
 */

/** The invoice this record belongs to. Renders "—" when there is no invoice attached. */
export function InvoiceLink({ invoiceId, invoiceNumber, className = "" }: {
  invoiceId?: number | null;
  invoiceNumber?: string | null;
  className?: string;
}) {
  const { hasPermission } = useAuth();

  if (invoiceId == null || !invoiceNumber) return <span className="text-gray-500">—</span>;
  if (!hasPermission("invoices.view")) return <span className={className}>{invoiceNumber}</span>;

  return (
    <Link to={`/invoices/${invoiceId}`} className={`text-brand-700 hover:underline ${className}`}>
      {invoiceNumber}
    </Link>
  );
}

/**
 * A person's own account page ("كشف حساب").
 *
 * `side` picks which of the two a partner has: a buyer's account is the money they owe the market,
 * a seller's or driver's is what the market owes them. A partner who is both has BOTH, kept
 * entirely separate everywhere else in the app — so the caller says which side this particular
 * reference is about rather than the component guessing from the partner's type.
 */
export function PartnerLink({ partnerId, name, side, className = "" }: {
  partnerId?: number | null;
  name?: string | null;
  side: "merchant" | "seller";
  className?: string;
}) {
  const { hasPermission } = useAuth();

  if (!name) return <span className="text-gray-500">—</span>;
  if (partnerId == null || !hasPermission("partners.view")) return <span className={className}>{name}</span>;

  const path = side === "merchant" ? "merchant-account" : "farmer-account";
  return (
    <Link to={`/partners/${partnerId}/${path}`} className={`text-brand-700 hover:underline ${className}`}>
      {name}
    </Link>
  );
}
