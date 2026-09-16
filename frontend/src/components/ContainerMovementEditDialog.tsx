import { useState } from "react";
import { updateContainerMovement } from "../api/partners";
import { apiErrorMessage } from "../api/client";
import type { ContainerMovementDto } from "../types";

/**
 * Correcting a crate movement in place.
 *
 * Everything about it except WHO it belongs to. A handover recorded against the wrong man is not a
 * wrong field, it is a different event — deleted and recorded again, which leaves both rows in the
 * audit trail saying what happened rather than one quietly becoming somebody else's.
 *
 * This was once refused on principle: a wrong movement was to be deleted and retyped so that both
 * the mistake and the correction stayed on the record. The principle does not survive the audit
 * interceptor, which writes the before and after of every field changed here — an edit loses no
 * history, and it is delete-and-retype that loses the link between the two rows.
 *
 * Nothing recomputes on save, because nothing is stored: every balance on the crates screen is
 * summed from these rows on each read.
 */
export function ContainerMovementEditDialog({ movement, partnerName, onClose, onSaved }: {
  movement: ContainerMovementDto;
  partnerName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [direction, setDirection] = useState<"Out" | "In">(movement.direction === "Out" ? "Out" : "In");
  const [date, setDate] = useState(movement.date.slice(0, 10));
  const [quantity, setQuantity] = useState(String(movement.quantity));
  const [notes, setNotes] = useState(movement.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = parseFloat(quantity) || 0;

  async function save() {
    if (value <= 0) { setError("العدد لازم يكون أكبر من صفر."); return; }
    setBusy(true);
    setError(null);
    try {
      await updateContainerMovement(movement.id, {
        // The kind is not offered: this screen is crates, and a row that is a sack belongs to the
        // sacks screen, which is the only place somebody can see what they changed.
        type: movement.type,
        direction,
        date: new Date(date).toISOString(),
        quantity: value,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل التعديل"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card sm:max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">تعديل حركة</h2>
        <p className="text-sm text-gray-500 mb-4">
          الشخص: <span className="font-medium text-gray-700">{partnerName}</span>.
          لتغيير الشخص امسح الحركة وسجّلها من جديد عليه.
        </p>

        <div className="space-y-3">
          <div>
            <label className="label">الحركة</label>
            <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as "Out" | "In")}>
              <option value="Out">أعطيناه</option>
              <option value="In">رجّع / جاب</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">العدد</label>
              <input className="input" type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <label className="label">التاريخ</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">ملاحظات (اختياري)</label>
            <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-3">{error}</div>}

        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={save}>
            {busy ? "جاري الحفظ..." : "حفظ"}
          </button>
          <button className="btn-secondary w-full sm:w-auto" disabled={busy} onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
