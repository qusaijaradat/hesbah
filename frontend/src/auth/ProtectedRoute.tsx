import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({
  children, requirePermission, skipPasswordGate,
}: {
  children: ReactNode;
  requirePermission?: string;
  /** Set only on the change-password route itself — otherwise the redirect below would bounce
   * that very page back to itself before it ever gets a chance to render. */
  skipPasswordGate?: boolean;
}) {
  const { user, isLoading, hasPermission, mustChangePassword } = useAuth();

  if (isLoading) return <div className="p-8 text-center text-gray-500">جاري التحقق من الجلسة...</div>;
  if (!user) return <Navigate to="/login" replace />;
  // A forced or admin-reset password change blocks every other screen until it's done — there's
  // no point letting someone work with an account whose password an admin just set/reset.
  if (mustChangePassword && !skipPasswordGate) return <Navigate to="/change-password" replace />;
  if (requirePermission && !hasPermission(requirePermission)) {
    return (
      <div className="p-8 text-center text-red-600">لا تملك صلاحية الوصول إلى هذه الصفحة.</div>
    );
  }
  return <>{children}</>;
}
