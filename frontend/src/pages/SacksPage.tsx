import { useEffect, useMemo, useState } from "react";
import {
  createSackKind, listSackKinds, printSacksOverviewPdf, returnSacks, sacksOverview, updateSackKind, withdrawSacks,
} from "../api/sacks";
import type { SacksFilter } from "../api/sacks";
import type { SackKindDto, SackLineInput, SacksOverviewDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { PdfActions } from "../components/PdfActions";
import { PartnerLink } from "../components/RecordLinks";
import { StatCard } from "../components/StatCard";
import { CollapsibleRows } from "../components/CollapsibleRows";
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
  // Which form is open, if either. Two forms sitting open side by side pushed the reports — the
  // part being read all day — below the fold, and gave a blank pair of forms to everyone who came
  // to look something up rather than record anything.
  const [openForm, setOpenForm] = useState<"withdraw" | "return" | null>(null);
  // Three answers to three different questions, one at a time. Stacked, they were a single
  // scroll of three tables where finding the one you came for meant reading past the other two.
  const [tab, setTab] = useState<"overall" | "people" | "log" | "stock">("overall");

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
      <h1 className="text-2xl font-bold mb-4">المخالات</h1>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-4 whitespace-pre-line">{error}</div>}
      {notice && <div className="text-sm text-brand-800 bg-brand-50 border border-brand-200 rounded-md p-3 mb-4">{notice}</div>}

      {canCreate && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <button className="btn-primary" onClick={() => setOpenForm("withdraw")}>➕ سحب مخالات</button>
          <button className="btn-secondary" onClick={() => setOpenForm("return")}>↩️ ارتجاع مخالات</button>
        </div>
      )}

      {canCreate && openForm && (
        <div className="modal-backdrop" onClick={() => setOpenForm(null)}>
          <div className="modal-card sm:max-w-2xl sm:my-8 p-4" onClick={(e) => e.stopPropagation()}>
            <MovementForm
              title={openForm === "withdraw" ? "سحب مخالات" : "ارتجاع مخالات"}
              action={openForm}
              kinds={kinds}
              onKinds={setKinds}
              onClose={() => setOpenForm(null)}
              onDone={(message) => { setNotice(message); setError(null); setOpenForm(null); refresh(); }}
              onError={(message) => { setError(message); setNotice(null); }}
            />
          </div>
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

      <div className="flex gap-2 mb-4 border-b border-gray-200 overflow-x-auto">
        {([
          ["overall", "الوضع العام"],
          ["people", "عند مين"],
          ["log", "سجل الحركات"],
          ["stock", "المخزن والأنواع"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 font-semibold rounded-t-md whitespace-nowrap shrink-0 ${
              tab === key ? "bg-brand-50 text-brand-700 border-b-2 border-brand-600" : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card p-6 text-center text-gray-400">جاري التحميل...</div>
      ) : !data ? null : (
        <>
          {tab === "overall" && <Totals data={data} />}
          {tab === "people" && <ByPartner data={data} />}
          {tab === "log" && <Movements data={data} />}
          {tab === "stock" && (
            <StockTable
              kinds={kinds}
              canEdit={canCreate}
              onSaved={async () => { setKinds(await listSackKinds()); refresh(); }}
              onError={setError}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- the two forms

function MovementForm({ title, action, kinds, onKinds, onClose, onDone, onError }: {
  title: string;
  action: "withdraw" | "return";
  kinds: SackKindDto[];
  onKinds: (kinds: SackKindDto[]) => void;
  onClose: () => void;
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        <button className="text-sm text-gray-500 hover:underline" onClick={onClose}>إغلاق</button>
      </div>

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
          <div
            key={idx}
            className="rounded-md border border-gray-200 p-3 sm:border-0 sm:p-0 sm:flex sm:items-end sm:gap-2 sm:flex-wrap"
          >
            <div className="mb-2 sm:mb-0 sm:flex-1 sm:min-w-[9rem]">
              <label className="label">النوع</label>
              <select className="input" value={line.kindId} onChange={(e) => update(idx, { kindId: e.target.value })}>
                <option value="">بدون نوع</option>
                {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
            <div className="mb-2 sm:mb-0 sm:w-24">
              <label className="label">العدد</label>
              <input
                className="input" type="number" min="0" step="1" value={line.quantity}
                onChange={(e) => update(idx, { quantity: e.target.value })}
              />
            </div>
            <div className="flex gap-4 sm:contents">
              <button className="text-xs text-brand-700 hover:underline sm:pb-2" onClick={() => addKind(idx)}>+ نوع جديد</button>
              {lines.length > 1 && (
                <button
                  className="text-xs text-red-600 hover:underline sm:pb-2"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                >
                  حذف
                </button>
              )}
            </div>
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

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap">
        <button className="btn-primary w-full sm:w-auto" onClick={submit} disabled={busy}>
          {busy ? "جاري الحفظ..." : `حفظ (${total} مخلاة)`}
        </button>
        <button className="btn-secondary w-full sm:w-auto" onClick={onClose} disabled={busy}>إلغاء</button>
        <span className="text-xs text-gray-500">كل نوع بينحفظ بسطره، والكل بعملية وحدة.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- the three reports

function Totals({ data }: { data: SacksOverviewDto }) {
  const out = data.totals.reduce((s, t) => s + t.out, 0);
  const back = data.totals.reduce((s, t) => s + t.in, 0);
  const owned = data.totals.reduce((s, t) => s + t.owned, 0);
  const remaining = data.totals.reduce((s, t) => s + t.remaining, 0);
  // How many kinds are not square — the number that says whether there is anything to chase at
  // all, which the per-kind table below can only answer by being read line by line.
  const openKinds = data.totals.filter((t) => t.outstanding !== 0).length;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="عندي (الكل)" value={String(owned)} hint={owned === 0 ? "ما عبّيت المخزن بعد" : undefined} />
        <StatCard
          label="برا (عند الناس)" value={String(out - back)}
          tone={out - back > 0 ? "negative" : "positive"}
          hint={openKinds > 0 ? `${openKinds} نوع مش مخالص` : "كل الأنواع مخالصة"}
        />
        {/* The one somebody standing at the store is actually asking. */}
        <StatCard
          label="بالمخزن (بقدر أعطي)" value={String(remaining)}
          tone={remaining > 0 ? "positive" : "negative"}
        />
        <StatCard label="طلع / رجع" value={`${out} / ${back}`} />
      </div>
    <div className="card mb-4">
      <div className="px-4 pt-4 pb-1 font-semibold">حسب النوع</div>
      {/* Cards on a phone, the real table above it — see components/CollapsibleRows. */}
      <div className="sm:hidden">
        <CollapsibleRows
          rows={data.totals}
          rowKey={(t) => t.sackKindId ?? "none"}
          title={(t) => t.sackKindName}
          value={(t) => (
            <span className={t.remaining < 0 ? "text-red-600" : ""}>بالمخزن {t.remaining}</span>
          )}
          details={(t) => [
            { label: "عندي", value: t.owned || "—" },
            { label: "طلع", value: t.out },
            { label: "رجع", value: t.in },
            { label: "برا", value: <span className={t.outstanding < 0 ? "text-red-600" : ""}>{t.outstanding}</span> },
          ]}
          empty="لا توجد أنواع ولا حركات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>النوع</th><th>عندي</th><th>طلع</th><th>رجع</th><th>برا</th><th>بالمخزن</th></tr>
          </thead>
          <tbody>
            {data.totals.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد أنواع ولا حركات</td></tr>
            ) : (
              <>
                {data.totals.map((t) => (
                  <tr key={t.sackKindId ?? "none"}>
                    <td className="font-medium">{t.sackKindName}</td>
                    <td className="text-gray-500">{t.owned || "—"}</td>
                    <td>{t.out}</td>
                    <td>{t.in}</td>
                    {/* A negative here is real — more came back than went out — and is shown as
                        such. Hiding it would hide whatever mistake produced it. */}
                    <td className={t.outstanding < 0 ? "text-red-600" : ""}>{t.outstanding}</td>
                    <td className={`font-semibold ${t.remaining < 0 ? "text-red-600" : ""}`}>{t.remaining}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50">
                  <td className="font-semibold">الإجمالي</td>
                  <td className="font-semibold">{owned}</td>
                  <td className="font-semibold">{out}</td>
                  <td className="font-semibold">{back}</td>
                  <td className="font-semibold">{out - back}</td>
                  <td className="font-semibold">{remaining}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
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
      <div className="sm:hidden">
        <CollapsibleRows
          rows={data.byPartner}
          rowKey={(p) => `${p.partnerId}-${p.sackKindId ?? "none"}`}
          title={(p) => `${p.partnerName} — ${p.sackKindName}`}
          value={(p) => <span className={p.outstanding < 0 ? "text-red-600" : ""}>{p.outstanding}</span>}
          details={(p) => [
            { label: "سحب", value: p.out },
            { label: "رجّع", value: p.in },
            {
              label: "واتساب",
              value: p.partnerWhatsApp ? (
                <a
                  className="text-green-700 hover:underline"
                  href={buildWhatsAppLink(p.partnerWhatsApp, message(p.partnerName))}
                  target="_blank" rel="noreferrer"
                >
                  📤 إرسال
                </a>
              ) : <span className="text-gray-400">لا يوجد رقم</span>,
            },
          ]}
          empty="لا توجد حركات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
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

/**
 * Where the store count is typed in.
 *
 * The movements can say how many went out and came back; only a person counting the store can
 * say how many there were. Without this the screen answers "who has mine" and cannot answer "how
 * many can I hand out", which is the question asked at the gate.
 */
function StockTable({ kinds, canEdit, onSaved, onError }: {
  kinds: SackKindDto[];
  canEdit: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newStock, setNewStock] = useState("");

  async function save(kind: SackKindDto) {
    const raw = draft[kind.id];
    if (raw === undefined) return;
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value < 0) { onError("عدد المخزن لازم يكون رقم مش سالب."); return; }
    setSavingId(kind.id);
    try {
      await updateSackKind(kind.id, { name: kind.name, isActive: kind.isActive, stockQuantity: value });
      setDraft((d) => { const next = { ...d }; delete next[kind.id]; return next; });
      onSaved();
    } catch (err) {
      onError(apiErrorMessage(err, "تعذّر حفظ المخزن"));
    } finally {
      setSavingId(null);
    }
  }

  async function add() {
    const name = newName.trim();
    if (name === "") return;
    try {
      await createSackKind(name, newStock ? Number(newStock) : 0);
      setNewName("");
      setNewStock("");
      onSaved();
    } catch (err) {
      onError(apiErrorMessage(err, "تعذّر إضافة النوع"));
    }
  }

  return (
    <div className="card">
      <div className="px-4 pt-4 text-xs text-gray-500">
        اكتب كم مخلاة عندك من كل نوع — الكل، سواء بالمخزن أو برا عند الناس. الي بالمخزن بينحسب لحاله:
        <span className="font-semibold"> عندي − برا</span>.
      </div>

      {canEdit && (
        <div className="flex items-end gap-2 flex-wrap px-4 pt-3">
          <div>
            <label className="label">نوع جديد</label>
            <input className="input w-40" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="أحمر" />
          </div>
          <div>
            <label className="label">كم عندك</label>
            <input className="input w-28" type="number" min="0" step="1" value={newStock} onChange={(e) => setNewStock(e.target.value)} placeholder="0" />
          </div>
          <button className="btn-secondary" onClick={add} disabled={newName.trim() === ""}>إضافة</button>
        </div>
      )}

      <div className="mt-3">
        <div className="sm:hidden divide-y divide-gray-100">
          {kinds.length === 0 ? (
            <div className="text-center text-gray-400 py-6">ما في أنواع بعد — ضيف واحد فوق</div>
          ) : kinds.map((k) => (
            <div key={k.id} className="flex items-center gap-3 py-3">
              <span className="flex-1 font-medium">{k.name}</span>
              {canEdit ? (
                <input
                  className="input w-24" type="number" min="0" step="1"
                  value={draft[k.id] ?? String(k.stockQuantity)}
                  onChange={(e) => setDraft((d) => ({ ...d, [k.id]: e.target.value }))}
                />
              ) : <span className="font-semibold">{k.stockQuantity}</span>}
              {canEdit && draft[k.id] !== undefined && (
                <button className="text-sm text-brand-700 hover:underline" disabled={savingId === k.id} onClick={() => save(k)}>
                  {savingId === k.id ? "..." : "حفظ"}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="hidden sm:block overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>النوع</th><th>كم عندي</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {kinds.length === 0 ? (
              <tr><td colSpan={canEdit ? 3 : 2} className="text-center text-gray-400 py-6">ما في أنواع بعد — ضيف واحد فوق</td></tr>
            ) : kinds.map((k) => (
              <tr key={k.id}>
                <td className="font-medium">{k.name}</td>
                <td>
                  {canEdit ? (
                    <input
                      className="input w-28" type="number" min="0" step="1"
                      value={draft[k.id] ?? String(k.stockQuantity)}
                      onChange={(e) => setDraft((d) => ({ ...d, [k.id]: e.target.value }))}
                    />
                  ) : k.stockQuantity}
                </td>
                {canEdit && (
                  <td>
                    {draft[k.id] !== undefined && (
                      <button className="text-sm text-brand-700 hover:underline" disabled={savingId === k.id} onClick={() => save(k)}>
                        {savingId === k.id ? "..." : "حفظ"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function Movements({ data }: { data: SacksOverviewDto }) {
  return (
    <div className="card">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={data.movements}
          rowKey={(m) => m.id}
          title={(m) => `${m.partnerName} — ${m.sackKindName}`}
          value={(m) => (
            <span className={m.direction === "Out" ? "text-amber-700" : "text-brand-700"}>
              {m.direction === "Out" ? "سحب" : "ارتجاع"} {m.quantity}
            </span>
          )}
          details={(m) => [
            { label: "التاريخ", value: formatDate(m.date) },
            { label: "ملاحظات", value: m.notes || "—" },
          ]}
          empty="لا توجد حركات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
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
