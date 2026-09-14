import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout, NAV_ITEMS } from "./components/Layout";
import { GlobalLoadingBar } from "./components/GlobalLoadingBar";
import { useEnterAdvancesFocus } from "./lib/formNavigation";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PartnersPage } from "./pages/PartnersPage";
import { FarmerGoodsPage } from "./pages/FarmerGoodsPage";
import { DebtsOverviewPage } from "./pages/DebtsOverviewPage";
import { ItemsPage } from "./pages/ItemsPage";
import { FarmerAccountPage, MerchantAccountPage } from "./pages/PartnerAccountPage";
import { FarmerInvoiceDetailPage, MerchantInvoiceDetailPage } from "./pages/PartnerInvoiceDetailPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { InvoiceNewPage } from "./pages/InvoiceNewPage";
import { QuickEntryPage } from "./pages/QuickEntryPage";
import { InvoiceEditPage } from "./pages/InvoiceEditPage";
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage";
import { BulkPrintPage } from "./pages/BulkPrintPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { ChecksPage } from "./pages/ChecksPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { AskPage } from "./pages/AskPage";
import { ReportsPage } from "./pages/ReportsPage";
import { DailyClosingPage } from "./pages/DailyClosingPage";
import { ContainersPage } from "./pages/ContainersPage";
import { SacksPage } from "./pages/SacksPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import { AuditLogPage } from "./pages/AuditLogPage";

/**
 * Where "/" actually goes.
 *
 * The dashboard is not something everybody can open: its figures are the market's whole day, so it
 * needs reports.view. An account created to do one job — record sacks, say, and nothing else —
 * used to land on it and get an empty screen with errors behind it, which reads as a broken login
 * rather than as a permission they were never given.
 *
 * So a user without it is sent to the first screen their role actually reaches, taken from the
 * sidebar's own list so the two can never disagree.
 */
function Landing() {
  const { hasPermission } = useAuth();
  if (hasPermission("reports.view")) return <DashboardPage />;

  const first = NAV_ITEMS.find((item) => item.to !== "/" && item.permission && hasPermission(item.permission));
  // Nobody at all: better an honest sentence than a blank page or a redirect loop.
  if (!first) {
    return (
      <div className="card p-6 text-center text-gray-600">
        حسابك ما إله صلاحية على أي شاشة — راجع المسؤول.
      </div>
    );
  }
  return <Navigate to={first.to} replace />;
}

function Protected({ children, permission }: { children: React.ReactNode; permission?: string }) {
  return (
    <ProtectedRoute requirePermission={permission}>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  // App-wide "Enter ينقل للحقل اللي بعده" — one document-level listener covering every field on
  // every page, present and future. See lib/formNavigation.ts.
  useEnterAdvancesFocus();

  return (
    <BrowserRouter>
      {/* Above AuthProvider/Routes so it's visible on every screen (including /login) — see
          lib/loadingStore.ts + api/client.ts for how it tracks in-flight requests. */}
      <GlobalLoadingBar />
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<ProtectedRoute skipPasswordGate><ChangePasswordPage /></ProtectedRoute>} />
          <Route path="/" element={<Protected><Landing /></Protected>} />
          <Route path="/invoices" element={<Protected permission="invoices.view"><InvoicesPage /></Protected>} />
          <Route path="/invoices/new" element={<Protected permission="invoices.create"><InvoiceNewPage /></Protected>} />
          {/* Experimental — see QuickEntryPage. Same permission as the normal form, since it
              creates invoices through exactly the same endpoint. */}
          <Route path="/invoices/quick-entry" element={<Protected permission="invoices.create"><QuickEntryPage /></Protected>} />
          <Route path="/invoices/print" element={<Protected permission="invoices.view"><BulkPrintPage /></Protected>} />
          <Route path="/invoices/:id/edit" element={<Protected permission="invoices.edit"><InvoiceEditPage /></Protected>} />
          <Route path="/invoices/:id" element={<Protected permission="invoices.view"><InvoiceDetailPage /></Protected>} />
          <Route path="/partners" element={<Protected permission="partners.view"><PartnersPage /></Protected>} />
          <Route path="/farmers-goods" element={<Protected permission="farmerGoods.view"><FarmerGoodsPage /></Protected>} />
          <Route path="/debts" element={<Protected permission="partners.view"><DebtsOverviewPage /></Protected>} />
          <Route path="/items" element={<Protected permission="items.view"><ItemsPage /></Protected>} />
          <Route path="/partners/:id/farmer-account" element={<Protected permission="partners.view"><FarmerAccountPage /></Protected>} />
          <Route path="/partners/:id/merchant-account" element={<Protected permission="partners.view"><MerchantAccountPage /></Protected>} />
          <Route path="/partners/:id/farmer-invoice-detail" element={<Protected permission="partners.view"><FarmerInvoiceDetailPage /></Protected>} />
          <Route path="/partners/:id/merchant-invoice-detail" element={<Protected permission="partners.view"><MerchantInvoiceDetailPage /></Protected>} />
          <Route path="/payments" element={<Protected permission="payments.view"><PaymentsPage /></Protected>} />
          <Route path="/checks" element={<Protected permission="payments.view"><ChecksPage /></Protected>} />
          <Route path="/employees" element={<Protected permission="employees.view"><EmployeesPage /></Protected>} />
          <Route path="/reports" element={<Protected permission="reports.view"><ReportsPage /></Protected>} />
          {/* Reads only, and every question it answers is a report — so the same permission. */}
          <Route path="/ask" element={<Protected permission="reports.view"><AskPage /></Protected>} />
          <Route path="/daily-closing" element={<Protected permission="reports.view"><DailyClosingPage /></Protected>} />
          <Route path="/containers" element={<Protected permission="boxes.view"><ContainersPage /></Protected>} />
          {/* Sacks have their own section: they come in colours and shapes, and a balance that
              does not name the kind cannot be argued from. See SacksPage. */}
          <Route path="/sacks" element={<Protected permission="sacks.view"><SacksPage /></Protected>} />
          <Route path="/settings" element={<Protected permission="settings.view"><SettingsPage /></Protected>} />
          <Route path="/users" element={<Protected permission="users.view"><UsersPage /></Protected>} />
          <Route path="/roles" element={<Protected permission="roles.view"><RolesPage /></Protected>} />
          <Route path="/audit-log" element={<Protected permission="audit.view"><AuditLogPage /></Protected>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
