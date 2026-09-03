import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "لوحة التحكم", permission: null },
  { to: "/invoices", label: "الفواتير", permission: "invoices.view" },
  { to: "/invoices/print", label: "طباعة الفواتير", permission: "invoices.view" },
  { to: "/items", label: "الأصناف", permission: "items.view" },
  { to: "/daily-closing", label: "الإغلاق اليومي", permission: "reports.view" },
  { to: "/partners", label: "الباعة والسواق والمشترين", permission: "partners.view" },
  { to: "/farmers-goods", label: "بضاعة الباعة", permission: "farmerGoods.view" },
  { to: "/debts", label: "قيمة الديون", permission: "partners.view" },
  { to: "/payments", label: "الدفعات والمصاريف", permission: "payments.view" },
  { to: "/employees", label: "الموظفون", permission: "employees.view" },
  { to: "/reports", label: "التقارير", permission: "reports.view" },
  { to: "/settings", label: "الإعدادات", permission: "settings.view" },
  { to: "/users", label: "المستخدمون", permission: "users.view" },
  { to: "/roles", label: "الأدوار والصلاحيات", permission: "roles.view" },
  { to: "/audit-log", label: "سجل التعديلات", permission: "audit.view" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  // Requirement doc §10: "responsive, mobile-first, works on desktop/tablet/mobile" — the
  // sidebar is always visible on desktop/tablet (md+) but becomes a slide-in drawer behind
  // a hamburger button on phones, since a fixed 16rem sidebar would eat most of a phone screen.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-brand-800">
        <div className="text-lg font-bold">🥬 الحسبة</div>
        <div className="text-xs text-brand-200">نظام إدارة الحسبة</div>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm transition-colors ${
                isActive ? "bg-brand-700 font-semibold" : "text-brand-100 hover:bg-brand-800"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-brand-800 text-sm">
        <div className="mb-2">
          <div className="font-medium">{user?.fullName}</div>
          <div className="text-brand-200 text-xs">{user?.roleName}</div>
        </div>
        <Link
          to="/change-password"
          onClick={() => setMobileNavOpen(false)}
          className="block w-full text-center rounded-md bg-brand-800 hover:bg-brand-700 px-3 py-1.5 text-xs mb-2"
        >
          تغيير كلمة المرور
        </Link>
        <button
          className="w-full rounded-md bg-brand-800 hover:bg-brand-700 px-3 py-1.5 text-xs"
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          تسجيل الخروج
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop/tablet sidebar — always visible from md (≈768px) up */}
      <aside className="hidden md:flex w-64 shrink-0 bg-brand-900 text-white flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile drawer — off-canvas, slides in over a dimmed backdrop */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 max-w-[80%] bg-brand-900 text-white flex flex-col shadow-xl">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar with hamburger — hidden on md+ where the sidebar is always visible */}
        <header className="md:hidden flex items-center gap-3 bg-brand-900 text-white px-4 py-3">
          <button
            aria-label="فتح القائمة"
            className="rounded-md p-1.5 hover:bg-brand-800"
            onClick={() => setMobileNavOpen(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-sm font-bold">🥬 الحسبة</div>
        </header>

        <main className="flex-1 p-4 sm:p-6 bg-gray-50 min-w-0">{children}</main>
      </div>
    </div>
  );
}
