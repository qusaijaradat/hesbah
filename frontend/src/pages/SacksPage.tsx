import { useEffect, useMemo, useState } from "react";
import {
  createSackKind, listSackKinds, printSacksOverviewPdf, returnSacks, sacksOverview, withdrawSacks,
} from "../api/sacks";
import type { SacksFilter } from "../api/sacks";
import type { SackKindDto, SackLineInput, SacksOverviewDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { PdfActions } from "../components/PdfActions";
import { PartnerLink } from "../components/RecordLinks";
import { formatDate, todayLocalDateString, buildWhatsAppLink } from "../lib/format";
import { startOfDay, endOfDay } from "../lib/format";

/**
 * "المخالات" — its own section, because a sack is not a crate.
 *
 * A crate is a crate. A sack has a colour and a shape, and that difference is the whole reason this
 * screen exists: somebody takes fifty — thirty red and twenty yellow — and brings back fifty
 * yellow. Counted as sacks they are square. Counted as KINDS they are holding thirty red and the
 * market owes them thirty yellow, and only the second version can be argued from.
 *
 * Two forms, one each way, both able to carry several kinds at once — because thirty red and twenty
 * yellow handed over together are one event, not two.
 */

/** One editable line in either form. Strings, because a half-typed number is not a number yet. */
interface KindLine {
  kindId: string;
  quantity: string;
}

const emptyLine = (): KindLine => ({ kindId: "", quantity: "" });

export function SacksPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("sacks.create");

  const [kinds, setKinds] = useState<SackKindDto[]>([]);
  const [data, setData] = useState<SacksOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The report's own filter, separate from either form's date.
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterPartner, setFilterPartner] = useState<{ id: number; name: string } | null>(null);

  const filter: SacksFilter = useMemo(() => ({
    dateFrom: filterFrom ? startOfDay(new Date(filterFrom)).toISOString() : undefined,
    dateTo: filterTo ? endOfDay(new Date(filterTo)).toISOString() : undefined,
    partnerId: filterPartner?.id,
  }), [filterFrom, filterTo, filterPartner]);

  async function refresh() {
    setLoading(true);
    try {
      const [k, d] = await Promise.all([listSackKinds(), sacksOverview(filter)]);
      setKinds(k);
      setData(d);
    } catch (err) {
      setError(apiErrorMessage(err, "تعذّر تحميل بيانات المخالات"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFrom, filterTo, filterPartner?.id]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">المخالات</h1>
      <p className="text-sm text-gray-500 mb-6">
        سحب وارتجاع المخالات حسب النوع — كل نوع بحسابه، لأن مين سحب ٣٠ حمرا و٢٠ صفرا ورجّع ٥٠ صفرا
        <span className="font-semibold"> مش مخالص</span>.
      </p>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-4 whitespace-pre-line">{error}</div>}
      {notice && <div className="text-sm text-brand-800 bg-brand-50 border border-brand-200 rounded-md p-3 mb-4">{notice}</div>}

      {canCreate && (
        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          <MovementForm
            title="سحب مخالات" action="withdraw" kinds={kinds}
            onKinds={setKinds}
            onDone={(message) => { setNotice(message); setError(null); refresh(); }}
            onError={(message) => { setError(message); setNotice(null); }}
          />
          <MovementForm
            title="ارتجاع مخالات" action="return" kinds={kinds}
            onKinds={setKinds}
            onDone={(message) => { setNotice(message); setError(null); refresh(); }}
            onError={(message) => { setError(message); setNotice(null); }}
          />
        </div>
      )}

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">من تاريخ</label>
          <input type="date" className="input" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">إلى تاريخ</label>
          <input type="date" className="input" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        </div>
        <div className="w-full max-w-xs">
          <PartnerAutocomplete
            label="الشخص (اختياري)" value={filterPartner} onChange={setFilterPartner}
            placeholder="كل الناس..."
          />
        </div>
        <button
          className="btn-secondary"
          onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterPartner(null); }}
        >
          كل الفترات
        </button>
        <div className="ms-auto">
          <PdfActions
            fetchPdf={() => printSacksOverviewPdf(filter)}
            fileName={`sacks-${todayLocalDateString()}.pdf`}
            shareTitle="كشف المخالات"
            documentName="كشف المخالات"
            printLabel="🖨️ طباعة كشف المخالات"
          />
        </div>
      </div>

      {loading ? (
        <div className="card p-6 text-center text-gray-400">جاري التحميل...</div>
      ) : !data ? null : (
        <>
          <Totals data={data} />
          <ByPartner data={data} />
          <Movements data={data} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- the two forms

function MovementForm({ title, action, kinds, onKinds, onDone, onError }: {
  title: string;
  action: "withdraw" | "return";
  kinds: SackKindDto[];
  onKinds: (kinds: SackKindDto[]) => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [date, setDate] = useState(() => todayLocalDateString());
  const [lines, setLines] = useState<KindLine[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const total = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0), 0);

  function update(index: number, patch: Partial<KindLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  /**
   * A colour that is not on the list becomes one, from here. The market invents these and is not
   * going to ask for a new build to add "أخضر" — and a picker that cannot grow just gets bypassed
   * by everyone typing everything into the notes field.
   */
  async function addKind(index: number) {
    const name = window.prompt("اسم النوع الجديد (لون أو شكل):")?.trim();
    if (!name) return;
    try {
      const kind = await createSackKind(name);
      const next = kinds.some((k) => k.id === kind.id) ? kinds : [...kinds, kind].sort((a, b) => a.name.localeCompare(b.name, "ar"));
      onKinds(next);
      update(index, { kindId: String(kind.id) });
    } catch (err) {
      onError(apiErrorMessage(err, "تعذّر إضافة النوع"));
    }
  }

  async function submit() {
    if (!partner) { onError("اختر الشخص أولاً."); return; }
    const payloadLines: SackLineInput[] = lines
      .map((l) => ({
        sackKindId: l.kindId === "" ? null : Number(l.kindId),
        quantity: parseFloat(l.quantity) || 0,
      }))
      .filter((l) => l.quantity > 0);
    if (payloadLines.length === 0) { onError("أدخل عدد أكبر من صفر على نوع واحد على الأقل."); return; }

    setBusy(true);
    try {
      const payload = {
        partnerId: partner.id,
        date: startOfDay(new Date(date)).toISOString(),
        lines: payloadLines,
        notes: notes.trim() || undefined,
      };
      const saved = action === "withdraw" ? await withdrawSacks(payload) : await returnSacks(payload);
      const count = saved.reduce((sum, m) => sum + m.quantity, 0);
      onDone(`${action === "withdraw" ? "انسحب" : "انرجع"} ${count} مخلاة على ${partner.name} (${saved.length} نوع).`);
      setLines([emptyLine()]);
      setNotes("");
    } catch (err) {
      onError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-semibold mb-3">{title}</h2>

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <PartnerAutocomplete
          label="الشخص" value={partner} onChange={setPartner}
          placeholder="اكتب الاسم واختره من القائمة..."
        />
        <div>
          <label className="label">التاريخ</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {/* Several kinds at once, because that is how they physically move. */}
      <div className="space-y-2 mb-3">
        {lines.map((line, idx) => (
          <div key={idx} className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[9rem]">
              <label className="label">النوع</label>
              <select className="input" value={line.kindId} onChange={(e) => update(idx, { kindId: e.target.value })}>
                <option value="">بدون نوع</option>
                {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
            <div className="w-24">
              <label className="label">العدد</label>
              <input
                className="input" type="number" min="0" step="1" value={line.quantity}
                onChange={(e) => update(idx, { quantity: e.target.value })}
              />
            </div>
            <button className="text-xs text-brand-700 hover:underline pb-2" onClick={() => addKind(idx)}>+ نوع جديد</button>
            {lines.length > 1 && (
              <button
                className="text-xs text-red-600 hover:underline pb-2"
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
              >
                حذف
              </button>
            )}
          </div>
        ))}
        <button className="text-sm text-brand-700 hover:underline" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          + نوع آخر
        </button>
      </div>

      <div className="mb-3">
        <label className="label">ملاحظات (اختياري)</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? "جاري الحفظ..." : `حفظ (${total} مخلاة)`}
        </button>
        <span className="text-xs text-gray-500">كل نوع بينحفظ بسطره، والكل بعملية وحدة.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- the three reports

function Totals({ data }: { data: SacksOverviewDto }) {
  const out = data.totals.reduce((s, t) => s + t.out, 0);
  const back = data.totals.reduce((s, t) => s + t.in, 0);
  return (
    <div className="card mb-4">
      <div className="px-4 pt-4 pb-1 font-semibold">الوضع العام حسب النوع</div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>النوع</th><th>طلع</th><th>رجع</th><th>برا (عند الناس)</th></tr>
          </thead>
          <tbody>
            {data.totals.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-gray-400 py-6">لا توجد حركات</td></tr>
            ) : (
              <>
                {data.totals.map((t) => (
                  <tr key={t.sackKindId ?? "none"}>
                    <td className="font-medium">{t.sackKindName}</td>
                    <td>{t.out}</td>
                    <td>{t.in}</td>
                    {/* A negative here is real — more came back than went out — and is shown as
                        such. Hiding it would hide whatever mistake produced it. */}
                    <td className={`font-semibold ${t.outstanding < 0 ? "text-red-600" : ""}`}>{t.outstanding}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50">
                  <td className="font-semibold">الإجمالي</td>
                  <td className="font-semibold">{out}</td>
                  <td className="font-semibold">{back}</td>
                  <td className="font-semibold">{out - back}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByPartner({ data }: { data: SacksOverviewDto }) {
  /** What one person owes, in the words they would be sent. */
  function message(partnerName: string): string {
    const mine = data.byPartner.filter((p) => p.partnerName === partnerName && p.outstanding !== 0);
    const lines = mine.map((p) => `${p.sackKindName}: ${p.outstanding}`);
    return `مرحبا ${partnerName}\nكشف المخالات:\n${lines.join("\n")}`;
  }

  return (
    <div className="card mb-4">
      <div className="px-4 pt-4 pb-1 font-semibold">عند مين، وأي نوع</div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>الشخص</th><th>النوع</th><th>سحب</th><th>رجّع</th><th>عليه</th><th></th></tr>
          </thead>
          <tbody>
            {data.byPartner.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد حركات</td></tr>
            ) : data.byPartner.map((p) => (
              <tr key={`${p.partnerId}-${p.sackKindId ?? "none"}`}>
                <td><PartnerLink partnerId={p.partnerId} name={p.partnerName} side="merchant" /></td>
                <td>{p.sackKindName}</td>
                <td>{p.out}</td>
                <td>{p.in}</td>
                <td className={`font-semibold ${p.outstanding < 0 ? "text-red-600" : ""}`}>{p.outstanding}</td>
                <td>
                  {p.partnerWhatsApp ? (
                    <a
                      className="text-xs text-green-700 hover:underline"
                      href={buildWhatsAppLink(p.partnerWhatsApp, message(p.partnerName))}
                      target="_blank" rel="noreferrer"
                    >
                      📤 واتساب
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400">لا يوجد رقم</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Movements({ data }: { data: SacksOverviewDto }) {
  return (
    <div className="card">
      <div className="px-4 pt-4 pb-1 font-semibold">سجل الحركات</div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>التاريخ</th><th>الشخص</th><th>النوع</th><th>الحركة</th><th>العدد</th><th>ملاحظات</th></tr>
          </thead>
          <tbody>
            {data.movements.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد حركات</td></tr>
            ) : data.movements.map((m) => (
              <tr key={m.id}>
                <td>{formatDate(m.date)}</td>
                <td>{m.partnerName}</td>
                <td>{m.sackKindName}</td>
                <td className={m.direction === "Out" ? "text-amber-700" : "text-brand-700"}>
                  {m.direction === "Out" ? "سحب" : "ارتجاع"}
                </td>
                <td className="font-semibold">{m.quantity}</td>
                <td className="text-gray-500 text-sm">{m.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
