import { useState } from "react";
import { updateSackMovement } from "../api/sacks";
import { apiErrorMessage } from "../api/client";
import type { SackKindDto, SackMovementDto } from "../types";

/**
 * Correcting one recorded sack line.
 *
 * Everything about it except WHO it belongs to. A handover recorded against the wrong man is not a
 * wrong field, it is a different event — deleted and recorded again, which leaves both rows in the
 * audit trail saying what happened rather than one row quietly becoming somebody else's.
 *
 * Nothing recomputes after saving, because nothing is stored: every total on this screen is summed
 * from these rows on each read. Fixing the row IS fixing the totals.
 */
export function SackMovementEditDialog({ movement, kinds, onClose, onSaved }: {
  movement: SackMovementDto;
  kinds: SackKindDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kindId, setKindId] = useState(movement.sackKindId != null ? String(movement.sackKindId) : "");
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
      await updateSackMovement(movement.id, {
        sackKindId: kindId === "" ? null : Number(kindId),
        direction,
        date: new Date(date).toISOString(),
        quantity: value,
        notes: notes.trim() || null,
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
        <h2 className="text-lg font-bold mb-1">تعديل حركة مخالات</h2>
        {/* The person is shown, not offered — see the note at the top of this file. */}
        <p className="text-sm text-gray-500 mb-4">
          الشخص: <span className="font-medium text-gray-700">{movement.partnerName}</span>.
          لتغيير الشخص امسح الحركة وسجّلها من جديد عليه.
        </p>

        <div className="space-y-3">
          <div>
            <label className="label">النوع</label>
            <select className="input" value={kindId} onChange={(e) => setKindId(e.target.value)}>
              <option value="">بدون نوع</option>
              {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">الحركة</label>
            <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as "Out" | "In")}>
              <option value="Out">سحب</option>
              <option value="In">ارتجاع</option>
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
