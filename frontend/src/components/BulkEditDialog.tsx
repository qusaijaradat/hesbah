import { useState } from "react";
import { runBulkEdit, summarizeBulkEdit } from "../lib/bulkEdit";
import { PartnerAutocomplete } from "./PartnerAutocomplete";
import type { PartnerType } from "../types";

/**
 * One field a table is willing to have changed across many rows at once.
 *
 * A table declares these explicitly; there is no "edit any column". That is the whole safety model
 * of this dialog. The tables here hold money, and a generic bulk edit over every column would
 * happily offer to rewrite a price or a commission rate on forty invoices — an operation whose
 * effect is forty people's balances moving and which has no undo. What a table offers here is a
 * short, deliberate list of attributes: who drove it, what day it was, whether the record is
 * active. Nothing that re-derives a total.
 */
export interface BulkEditField<T> {
  key: string;
  label: string;
  /**
   * `partner` searches everyone on file rather than offering a fixed list. It exists because the
   * first version of the driver field could only offer drivers already attached to one of the
   * loaded invoices — which is precisely the set you are trying to change when a whole day was
   * entered with the wrong driver, or with none.
   */
  kind: "text" | "select" | "date" | "boolean" | "partner";
  /** `select` only. */
  options?: { value: string; label: string }[];
  /** `partner` only — which roles the picker searches. */
  partnerTypes?: PartnerType[];
  /** `partner` only — the label offered for "nobody", when clearing is meaningful. */
  emptyLabel?: string;
  /** What this row holds today — shown in the preview so the change is visible before it happens. */
  current: (row: T) => string;
  /**
   * What to COMPARE on, when that is not the same as what to show. Two drivers can share a name;
   * comparing the displayed name would call a row unchanged because someone else is spelled the
   * same, and quietly leave it out of the edit. Defaults to `current`.
   */
  currentKey?: (row: T) => string;
  /** How the chosen value reads in the preview. Defaults to the raw value. */
  display?: (value: string) => string;
  /** Performs the change for one row. Page-owned, because most update endpoints are full PUTs. */
  apply: (row: T, value: string) => Promise<void>;
}

interface Props<T> {
  rows: T[];
  fields: BulkEditField<T>[];
  label: (row: T) => string;
  onClose: () => void;
  /** Called after the run, with the summary to show (or null when everything succeeded). */
  onDone: (message: string | null) => void;
}

/** How many rows the preview names before it stops and counts the rest. */
const PREVIEW_ROWS = 8;

/**
 * "تعديل المحدد" — pick one field, pick one value, see exactly what will change, then run it.
 *
 * The preview is not decoration. A bulk edit's failure mode is not the mechanics going wrong; it
 * is someone editing a selection that is not the selection they thought they had. So the rows are
 * named, with their current value beside the new one, before the button that runs it exists.
 */
export function BulkEditDialog<T>({ rows, fields, label, onClose, onDone }: Props<T>) {
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? "");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // The picked partner is kept whole: `value` only carries the id, and the preview needs the name.
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);

  const field = fields.find((f) => f.key === fieldKey);
  const chosen = field?.kind === "partner"
    ? (partner?.name ?? field.emptyLabel ?? "")
    : field?.display ? field.display(value) : value;

  // Rows already holding the chosen value are not changes. Saying so keeps the count honest:
  // "١٢ محدد" and "٣ رح يتغيروا" are different facts, and only the second one is the edit.
  // Compared on the key when the field has one, and against the chosen VALUE rather than its label
  // — for a partner that means id against id, not name against name.
  const chosenKey = field?.currentKey ? value : chosen;
  const changing = field && value !== ""
    ? rows.filter((r) => (field.currentKey ?? field.current)(r) !== chosenKey)
    : [];
  const unchanged = rows.length - changing.length;

  async function run() {
    if (!field || value === "" || changing.length === 0) return;
    setBusy(true);
    const outcome = await runBulkEdit(changing, label, (row) => field.apply(row, value));
    setBusy(false);
    onDone(outcome.failedCount > 0 ? summarizeBulkEdit(outcome) : null);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">تعديل {rows.length} سجل دفعة وحدة</h2>
        <p className="text-xs text-gray-500 mb-4">
          الحقول هون محدودة بالقصد — التعديل بالجملة ما بلمس أي حقل بيعيد حساب مبالغ.
        </p>

        <div className="mb-3">
          <label className="label">الحقل</label>
          <select className="input" value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setValue(""); setPartner(null); }}>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>

        {field && (
          <div className="mb-4">
            <label className="label">القيمة الجديدة</label>
            {field.kind === "text" && (
              <input className="input" value={value} onChange={(e) => setValue(e.target.value)} />
            )}
            {field.kind === "date" && (
              <input className="input" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            )}
            {field.kind === "partner" && (
              <div>
                <PartnerAutocomplete
                  label={field.label} labelHidden value={partner}
                  onChange={(p) => { setPartner(p); setValue(p ? String(p.id) : ""); }}
                  types={field.partnerTypes}
                />
                {field.emptyLabel && (
                  <button
                    className="btn-link text-xs text-brand-700 hover:underline mt-1"
                    onClick={() => { setPartner(null); setValue("none"); }}
                  >
                    {field.emptyLabel}
                  </button>
                )}
              </div>
            )}

            {(field.kind === "select" || field.kind === "boolean") && (
              <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">— اختر —</option>
                {(field.kind === "boolean"
                  ? [{ value: "yes", label: "نعم" }, { value: "no", label: "لا" }]
                  : field.options ?? []
                ).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
        )}

        {field && value !== "" && (
          <div className="border border-gray-200 rounded-md p-3 mb-4 text-sm">
            <div className="font-semibold mb-2">
              رح يتغير {changing.length} من {rows.length}
              {unchanged > 0 && <span className="font-normal text-gray-500"> — {unchanged} عندهم نفس القيمة أصلاً</span>}
            </div>
            {changing.length === 0 ? (
              <div className="text-gray-500">ما في إشي بتغير.</div>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {changing.slice(0, PREVIEW_ROWS).map((row, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-medium">{label(row)}</span>
                    <span className="text-gray-400">{field.current(row) || "—"}</span>
                    <span className="text-gray-400">←</span>
                    <span className="font-medium">{chosen}</span>
                  </li>
                ))}
                {changing.length > PREVIEW_ROWS && (
                  <li className="text-gray-500">و{changing.length - PREVIEW_ROWS} غيرهم…</li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn-primary" onClick={run} disabled={busy || changing.length === 0}>
            {busy ? "جاري التعديل..." : `نفّذ على ${changing.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
