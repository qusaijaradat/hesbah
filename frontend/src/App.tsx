import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { GlobalLoadingBar } from "./components/GlobalLoadingBar";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PartnersPage } from "./pages/PartnersPage";
import { FarmerGoodsPage } from "./pages/FarmerGoodsPage";
import { DebtsOverviewPage } from "./pages/DebtsOverviewPage";
import { ItemsPage } from "./pages/ItemsPage";
import { FarmerAccountPage, MerchantAccountPage } from "./pages/PartnerAccountPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { InvoiceNewPage } from "./pages/InvoiceNewPage";
import { InvoiceEditPage } from "./pages/InvoiceEditPage";
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage";
import { BulkPrintPage } from "./pages/BulkPrintPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { DailyClosingPage } from "./pages/DailyClosingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import { AuditLogPage } from "./pages/AuditLogPage";

function Protected({ children, permission }: { children: React.ReactNode; permission?: string }) {
  return (
    <ProtectedRoute requirePermission={permission}>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Above AuthProvider/Routes so it's visible on every screen (including /login) — see
          lib/loadingStore.ts + api/client.ts for how it tracks in-flight requests. */}
      <GlobalLoadingBar />
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<ProtectedRoute skipPasswordGate><ChangePasswordPage /></ProtectedRoute>} />
          <Route path="/" element={<Protected><DashboardPage /></Protected>} />
          <Route path="/invoices" element={<Protected permission="invoices.view"><InvoicesPage /></Protected>} />
          <Route path="/invoices/new" element={<Protected permission="invoices.create"><InvoiceNewPage /></Protected>} />
          <Route path="/invoices/print" element={<Protected permission="invoices.view"><BulkPrintPage /></Protected>} />
          <Route path="/invoices/:id/edit" element={<Protected permission="invoices.edit"><InvoiceEditPage /></Protected>} />
          <Route path="/invoices/:id" element={<Protected permission="invoices.view"><InvoiceDetailPage /></Protected>} />
          <Route path="/partners" element={<Protected permission="partners.view"><PartnersPage /></Protected>} />
          <Route path="/farmers-goods" element={<Protected permission="invoices.view"><FarmerGoodsPage /></Protected>} />
          <Route path="/debts" element={<Protected permission="partners.view"><DebtsOverviewPage /></Protected>} />
          <Route path="/items" element={<Protected permission="items.view"><ItemsPage /></Protected>} />
          <Route path="/partners/:id/farmer-account" element={<Protected permission="partners.view"><FarmerAccountPage /></Protected>} />
          <Route path="/partners/:id/merchant-account" element={<Protected permission="partners.view"><MerchantAccountPage /></Protected>} />
          <Route path="/payments" element={<Protected permission="payments.view"><PaymentsPage /></Protected>} />
          <Route path="/employees" element={<Protected permission="employees.view"><EmployeesPage /></Protected>} />
          <Route path="/reports" element={<Protected permission="reports.view"><ReportsPage /></Protected>} />
          <Route path="/daily-closing" element={<Protected permission="reports.view"><DailyClosingPage /></Protected>} />
          <Route path="/settings" element={<Protected permission="settings.view"><SettingsPage /></Protected>} />
          <Route path="/users" element={<Protected permission="users.view"><UsersPage /></Protected>} />
          <Route path="/roles" element={<Protected permission="roles.view"><RolesPage /></Protected>} />
          <Route path="/audit-log" element={<Protected permission="audit.view"><AuditLogPage /></Protected>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
