import { useEffect, useState } from "react";
import { listSettings, updateSetting } from "../api/settings";
import type { SettingDto } from "../types";
import { apiErrorMessage } from "../api/client";

const KEY_LABELS: Record<string, string> = {
  "commission.default_rate": "نسبة العمولة الافتراضية (مثال: 0.07 = 7%)",
  "market.name": "اسم السوق/الحسبة",
  "whatsapp.business_number": "رقم WhatsApp Business لإرسال الفواتير",
  "market.registration_number": "الرقم/السجل التجاري (يظهر بترويسة الفاتورة المطبوعة)",
  "market.phone": "رقم هاتف الشركة (يظهر بترويسة الفاتورة المطبوعة)",
  "market.address": "عنوان الشركة (يظهر بترويسة الفاتورة المطبوعة)",
};

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingDto[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setSettings(await listSettings());
  }

  useEffect(() => { refresh(); }, []);

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

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-6">الإعدادات</h1>
      {message && <div className="text-sm bg-brand-50 text-brand-800 rounded-md p-3 mb-4">{message}</div>}
      <div className="space-y-4">
        {settings.map((s) => (
          <div key={s.key} className="card p-4">
            <label className="label">{KEY_LABELS[s.key] ?? s.key}</label>
            <div className="flex gap-2">
              <input
                className="input"
                defaultValue={s.value}
                onChange={(e) => setEdited((prev) => ({ ...prev, [s.key]: e.target.value }))}
              />
              <button className="btn-primary shrink-0" disabled={saving === s.key} onClick={() => handleSave(s.key)}>
                {saving === s.key ? "..." : "حفظ"}
              </button>
            </div>
            {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
