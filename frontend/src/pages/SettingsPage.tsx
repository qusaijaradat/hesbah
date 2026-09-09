import { useEffect, useRef, useState } from "react";
import { downloadBackup } from "../api/backup";
import { triggerBlobDownload } from "../api/invoices";
import { deleteLogo, getLogo, listSettings, updateSetting, uploadLogo } from "../api/settings";
import type { SettingDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { toMonochromePng } from "../lib/monochrome";

const KEY_LABELS: Record<string, string> = {
  "commission.default_rate": "نسبة العمولة الافتراضية (مثال: 0.10 = 10%)",
  "market.name": "اسم السوق/الحسبة",
  "whatsapp.business_number": "رقم WhatsApp Business لإرسال الفواتير",
  "market.registration_number": "الرقم/السجل التجاري (يظهر بترويسة الفاتورة المطبوعة)",
  "market.phone": "رقم هاتف الشركة (يظهر بترويسة الفاتورة المطبوعة)",
  "market.address": "عنوان الشركة (يظهر بترويسة الفاتورة المطبوعة)",
  // Both in shekels, not agorot — 30 agorot is "0.3", not "30". The difference between the two
  // is what the market keeps per crate, so the labels say so rather than leaving it to be
  // worked out.
  "boxes.price": "سعر الصندوق الواحد (₪) — بتنحسب على المشتري تلقائيًا على كل فاتورة فيها أصناف بالصندوق",
  "boxes.driver_fee": "أجرة السائق عن كل صندوق (₪) — بتنعطى للسائق، والفرق بينها وبين سعر الصندوق يضل للمصلحة",
};

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function SettingsPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("settings.edit");
  const [settings, setSettings] = useState<SettingDto[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Logo (Settings → "الشعار"): shown here for preview/upload/removal, and — once uploaded —
  // rendered on the invoice PDF header by the backend (see ExportService.CompanyHeaderBlock).
  // getLogo() only ever returns the market's OWN uploaded logo (null if none) — when there isn't
  // one, the backend still prints the bundled "أرديس" logo on invoices (see
  // CompanyLogoService.GetEffectiveLogoAsync), so the preview here falls back to that exact same
  // bundled image (/company-logo-default.png) rather than showing an empty "no logo" box.
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(true);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMessage, setLogoMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasCustomLogo = customLogoUrl !== null;
  const logoPreviewSrc = customLogoUrl ?? "/company-logo-default.png";

  async function refresh() {
    setSettings(await listSettings());
  }

  async function refreshLogo() {
    setLogoLoading(true);
    try {
      const blob = await getLogo();
      setCustomLogoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return blob ? URL.createObjectURL(blob) : null;
      });
    } finally {
      setLogoLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    refreshLogo();
    // Revoke the object URL on unmount so the blob isn't kept alive after leaving the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => setCustomLogoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return prev; });
  }, []);

  async function handleSave(key: string) {
    setSaving(key);
    setMessage(null);
    try {
      await updateSetting(key, edited[key]);
      await refresh();
      setMessage("تم الحفظ بنجاح");
    } catch (err) {
      setMessage(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setSaving(null);
    }
  }

  async function handleLogoFileChosen(file: File | undefined) {
    if (!file) return;
    setLogoMessage(null);
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setLogoMessage("الصيغة غير مدعومة — استخدم PNG أو JPEG أو WEBP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoMessage("حجم الصورة كبير جدًا (الحد الأقصى 3 ميغابايت).");
      return;
    }
    setLogoBusy(true);
    try {
      // Stored black-and-white, not just printed that way: the invoice PDF carries no colour of
      // its own (see PrintInk in the backend's ExportService), and the logo is the one thing that
      // could put colour back on a page headed for a black-only printer.
      const { file: monochrome, converted } = await toMonochromePng(file);
      if (monochrome.size > MAX_LOGO_BYTES) {
        setLogoMessage("حجم الصورة كبير جدًا بعد التحويل (الحد الأقصى 3 ميغابايت) — جرّب صورة أصغر.");
        return;
      }
      await uploadLogo(monochrome);
      await refreshLogo();
      setLogoMessage(converted
        ? "تم رفع الشعار وتحويله للأبيض والأسود — سيظهر على ترويسة الفواتير المطبوعة."
        : "تم رفع الشعار كما هو — تعذّر تحويله للأبيض والأسود، فقد يطبع بلون باهت على الطابعة.");
    } catch (err) {
      setLogoMessage(apiErrorMessage(err, "فشل رفع الشعار"));
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleLogoDelete() {
    setLogoBusy(true);
    setLogoMessage(null);
    try {
      await deleteLogo();
      await refreshLogo();
      setLogoMessage("تم حذف الشعار — سترجع الفواتير لاستخدام شعار \"أرديس\" الافتراضي.");
    } catch (err) {
      setLogoMessage(apiErrorMessage(err, "فشل حذف الشعار"));
    } finally {
      setLogoBusy(false);
    }
  }

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  async function handleBackup() {
    setBackupBusy(true);
    setBackupMessage(null);
    setBackupError(null);
    try {
      const blob = await downloadBackup();
      // The server names the file by date; this repeats it so the download folder stays sorted
      // even on browsers that ignore Content-Disposition for a blob.
      const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
      triggerBlobDownload(blob, `hesbah-backup-${stamp}.zip`);
      setBackupMessage("تم تنزيل النسخة الاحتياطية — احفظها بمكان برّا السيرفر.");
    } catch (err) {
      setBackupError(apiErrorMessage(err, "فشل تنزيل النسخة الاحتياطية"));
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-6">الإعدادات</h1>

      {hasPermission("backup.download") && (
        <div className="card p-4 mb-4">
          <h2 className="font-semibold mb-1">نسخة احتياطية</h2>
          <p className="text-sm text-gray-500 mb-3">
            بينزّل كل بيانات النظام بملف مضغوط (ZIP) فيه ملف Excel/CSV لكل جدول — الفواتير، الدفعات،
            الحسابات، الأشخاص، سجل التعديلات، كل شي. احفظه بمكان برّا السيرفر (فلاشة أو إيميل).
          </p>
          <button className="btn-primary" disabled={backupBusy} onClick={handleBackup}>
            {backupBusy ? "جاري التجهيز..." : "⬇️ تنزيل نسخة احتياطية"}
          </button>
          {backupMessage && <div className="text-sm text-brand-700 mt-2">{backupMessage}</div>}
          {backupError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-2">{backupError}</div>}
          <p className="text-xs text-gray-400 mt-3">
            ملاحظة: هاي نسخة من <span className="font-semibold">البيانات</span> — بتنقرأ بالإكسل وبيقدر
            فني يرجّعها. مش بديل عن نسخة قاعدة بيانات كاملة (pg_dump) مجدولة على السيرفر.
          </p>
        </div>
      )}
      {message && <div className="text-sm bg-brand-50 text-brand-800 rounded-md p-3 mb-4">{message}</div>}

      <div className="card p-4 mb-4">
        <label className="label">شعار الشركة</label>
        <p className="text-xs text-gray-400 mb-3">
          يظهر هذا الشعار بجانب اسم السوق على ترويسة الفاتورة المطبوعة (PDF). بدون رفع شعار خاص بك، تُستخدم شعار "أرديس" الافتراضي تلقائيًا.
          <br />
          أي شعار ترفعه يُحوَّل تلقائيًا للأبيض والأسود، لأن الفاتورة المطبوعة كلها بالأسود.
        </p>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-md border border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 shrink-0">
            {logoLoading ? (
              <span className="text-xs text-gray-400">...</span>
            ) : (
              <img src={logoPreviewSrc} alt="شعار الشركة" className="w-full h-full object-contain" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            {canEdit ? (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="text-sm"
                disabled={logoBusy}
                onChange={(e) => handleLogoFileChosen(e.target.files?.[0])}
              />
            ) : (
              <span className="text-xs text-gray-400">لا تملك صلاحية تعديل الإعدادات</span>
            )}
            {logoBusy && <span className="text-xs text-gray-400">جاري المعالجة...</span>}
            {!logoBusy && !logoLoading && (
              <span className="text-xs text-gray-400">
                {hasCustomLogo ? "شعارك المرفوع" : "الشعار الافتراضي (لم يُرفع شعار خاص بعد)"}
              </span>
            )}
            {canEdit && hasCustomLogo && !logoBusy && (
              <button className="btn-danger text-sm self-start" onClick={handleLogoDelete}>
                حذف الشعار (والرجوع للشعار الافتراضي)
              </button>
            )}
          </div>
        </div>
        {logoMessage && <p className="text-xs mt-2 text-brand-800">{logoMessage}</p>}
      </div>

      <div className="space-y-4">
        {settings.map((s) => (
          <div key={s.key} className="card p-4">
            <label className="label">{KEY_LABELS[s.key] ?? s.key}</label>
            <div className="flex gap-2">
              <input
                className="input"
                defaultValue={s.value}
                disabled={!canEdit}
                onChange={(e) => setEdited((prev) => ({ ...prev, [s.key]: e.target.value }))}
              />
              {canEdit && (
                <button className="btn-primary shrink-0" disabled={saving === s.key} onClick={() => handleSave(s.key)}>
                  {saving === s.key ? "..." : "حفظ"}
                </button>
              )}
            </div>
            {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
