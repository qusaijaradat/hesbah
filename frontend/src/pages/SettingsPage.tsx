import { useEffect, useRef, useState } from "react";
import { deleteLogo, getLogo, listSettings, updateSetting, uploadLogo } from "../api/settings";
import type { SettingDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const KEY_LABELS: Record<string, string> = {
  "commission.default_rate": "نسبة العمولة الافتراضية (مثال: 0.07 = 7%)",
  "market.name": "اسم السوق/الحسبة",
  "whatsapp.business_number": "رقم WhatsApp Business لإرسال الفواتير",
  "market.registration_number": "الرقم/السجل التجاري (يظهر بترويسة الفاتورة المطبوعة)",
  "market.phone": "رقم هاتف الشركة (يظهر بترويسة الفاتورة المطبوعة)",
  "market.address": "عنوان الشركة (يظهر بترويسة الفاتورة المطبوعة)",
  "boxes.price": "سعر الصندوق الواحد (₪) — يُضاف تلقائيًا كرسم على كل فاتورة فيها أصناف بالصندوق",
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
      await uploadLogo(file);
      await refreshLogo();
      setLogoMessage("تم رفع الشعار — سيظهر على ترويسة الفواتير المطبوعة.");
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

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-6">الإعدادات</h1>
      {message && <div className="text-sm bg-brand-50 text-brand-800 rounded-md p-3 mb-4">{message}</div>}

      <div className="card p-4 mb-4">
        <label className="label">شعار الشركة</label>
        <p className="text-xs text-gray-400 mb-3">
          يظهر هذا الشعار بجانب اسم السوق على ترويسة الفاتورة المطبوعة (PDF). بدون رفع شعار خاص بك، تُستخدم شعار "أرديس" الافتراضي تلقائيًا.
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
