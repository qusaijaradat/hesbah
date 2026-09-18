import { useEffect, useState } from "react";
import { getPartner } from "../api/partners";
import { updateSetting } from "../api/settings";
import { apiErrorMessage } from "../api/client";
import { PartnerAutocomplete } from "./PartnerAutocomplete";

/** The one setting that names a PERSON rather than holding a number or a piece of text. */
export const HOUSE_DRIVER_KEY = "market.house_driver_partner_id";

/**
 * Picks the partner record standing for the market's own vehicle.
 *
 * The setting stores an id, and a box asking for one would be unusable: nobody knows that the
 * market is partner 42, and a typo there would quietly start paying the wrong person. So the same
 * name-picker used everywhere else chooses the person, and the id never appears on screen.
 *
 * Its own component because two screens need it: the settings list, and the balance-migration card
 * — which cannot run correctly until this is answered and so asks for it on the spot rather than
 * sending somebody off to find it.
 */
export function HouseDriverSetting({
  value, canEdit, onSaved,
}: {
  /** The stored id, as text. Empty when nothing is set. */
  value: string;
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // The stored id on its own says nothing — the name has to be fetched to show who it is.
  useEffect(() => {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) { setPartner(null); return; }
    let cancelled = false;
    getPartner(id)
      .then((p) => { if (!cancelled) setPartner({ id: p.id, name: p.name }); })
      // A person who was deleted after being set here: show the field empty rather than an error,
      // since empty is exactly what the setting now means in practice.
      .catch(() => { if (!cancelled) setPartner(null); });
    return () => { cancelled = true; };
  }, [value]);

  async function choose(next: { id: number; name: string } | null) {
    setPartner(next);
    setBusy(true);
    try {
      await updateSetting(HOUSE_DRIVER_KEY, next ? String(next.id) : "");
      onSaved(next ? `تم الحفظ — سائق المصلحة هو ${next.name}` : "تم الحفظ — ما فيه سائق مصلحة محدد");
    } catch (err) {
      onSaved(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={busy ? "opacity-60" : undefined}>
      <PartnerAutocomplete
        label="سائق المصلحة"
        labelHidden
        value={partner}
        onChange={(p) => { if (canEdit) void choose(p); }}
        placeholder="ابحث عن الشخص بالاسم..."
      />
    </div>
  );
}
