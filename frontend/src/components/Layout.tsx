import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationsBell } from "./NotificationsBell";
import { PushPrompt } from "./PushPrompt";

/**
 * Exported so the landing redirect can be derived from the SAME list the sidebar renders. A user
 * whose role only reaches one screen has to land ON that screen, and a second hand-maintained
 * list of where people can go would drift from this one the first time a page was added.
 */
export const NAV_ITEMS = [
  { to: "/", label: "لوحة التحكم", permission: null },
  { to: "/invoices", label: "الفواتير", permission: "invoices.view" },
  { to: "/invoices/print", label: "طباعة الفواتير", permission: "invoices.view" },
  { to: "/invoices/quick-entry", label: "إدخال الدفتر (تجريبي)", permission: "invoices.create" },
  { to: "/items", label: "الأصناف", permission: "items.view" },
  { to: "/daily-closing", label: "الإغلاق اليومي", permission: "reports.view" },
  { to: "/containers", label: "الصناديق", permission: "boxes.view" },
  { to: "/sacks", label: "المخالات", permission: "sacks.view" },
  { to: "/partners", label: "الباعة والسائقين والمشترين", permission: "partners.view" },
  { to: "/farmers-goods", label: "بضاعة الباعة", permission: "farmerGoods.view" },
  { to: "/debts", label: "قيمة الديون", permission: "partners.view" },
  { to: "/payments", label: "الدفعات والمصاريف", permission: "payments.view" },
  { to: "/checks", label: "الشيكات", permission: "payments.view" },
  { to: "/employees", label: "الموظفون", permission: "employees.view" },
  { to: "/reports", label: "التقارير", permission: "reports.view" },
  { to: "/ask", label: "اسأل (تجريبي)", permission: "reports.view" },
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
        {/* The app bar. It was the phone's alone until the bell moved in — the bell has to be
            reachable from every screen at every width, so the bar exists at every width too and
            the hamburger is the only part that hides. On a desktop the sidebar already carries
            the name, so the bar there is a thin strip with nothing on it but the bell.

            Sticky, because the pages under it are long lists: reaching the menu — or now the
            bell — used to mean scrolling all the way back to the top. */}
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-brand-900 text-white px-4 py-3">
          <button
            aria-label="فتح القائمة"
            className="md:hidden rounded-md p-1.5 hover:bg-brand-800"
            onClick={() => setMobileNavOpen(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="md:hidden text-sm font-bold shrink-0">🥬 الحسبة</div>

          {/* The search box takes the middle of the bar at every width. It is the control used
              most often by the people who know the app least, so it is not hidden behind anything. */}
          <GlobalSearch />

          {/* The bell sits at the end of the bar — the left, in an RTL page — which is where every
              app anybody here already uses keeps it. */}
          <div className="shrink-0">
            <NotificationsBell />
          </div>
        </header>

        {/* Asks once, stays quiet for two weeks after "مش هلأ", and never comes back once this
            device is subscribed. */}
        <PushPrompt />

        <main className="flex-1 p-4 sm:p-6 bg-gray-50 min-w-0">{children}</main>
      </div>
    </div>
  );
}
