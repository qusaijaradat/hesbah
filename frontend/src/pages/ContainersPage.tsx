import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { TablePagination } from "../components/TablePagination";
import { usePagination } from "../lib/usePagination";
import { createContainerMovement, deleteContainerMovement, getContainerHolders, getPartnerContainers } from "../api/partners";
import { apiErrorMessage } from "../api/client";
import { formatCount, formatDate, todayLocalDateString } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { ContainerBalanceDto, ContainerDirection, ContainerHolderDto, ContainerType, PartnerContainersDto } from "../types";
import { CollapsibleRows } from "../components/CollapsibleRows";
import { ContainerMovementEditDialog } from "../components/ContainerMovementEditDialog";

/**
 * "الصناديق" — the crates the market lends out and expects back.
 *
 * Sacks used to share this screen and have their own now (SacksPage): they come in colours and
 * shapes, and a sack balance that does not name the kind is unarguable — thirty red out and
 * fifty yellow back is not square, however even the totals look. Movements recorded here before
 * that split are still sacks somebody is holding; they read as "بدون نوع" over there rather than
 * disappearing, which is why this file still knows the word.
 *
 * Counts only. Whatever the market eventually charges for one is a separate matter and stays out
 * of the person's account balance, which is about produce: a crate owed and a shekel owed are not
 * the same debt and must never add up to one number.
 *
 * Anyone can hold containers — a buyer takes them away with produce, a seller or driver takes them
 * out to fill — so this page is not scoped to one partner type. Crates and sacks keep separate
 * balances: handing someone ten of each leaves them owing ten of each, not twenty of something.
 *
 * Two sides are read from what the market already records, rather than re-typed: crates leaving
 * with a buyer's box-unit lines (net of produce sent back, which arrives in its crates), and the
 * wooden crates arriving with a seller's produce on "إضافة بضاعة". Everything else — every crate
 * handed out by hand, every sack, every return — is recorded here.
 */
// Carton is still named here even though it can no longer be chosen: a movement recorded against
// it before cartons stopped being tracked still has to render as a word rather than a blank.
const TYPE_LABEL: Record<ContainerType, string> = { Box: "صناديق", Carton: "كرتون", Sack: "مخالات" };
const TYPE_UNIT: Record<ContainerType, string> = { Box: "صندوق", Carton: "كرتونة", Sack: "مخال" };

export function ContainersPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("boxes.create");
  const canDelete = hasPermission("boxes.delete");

  // Deep-linked from a partner's account page, so "الصناديق لهذا الشخص" lands ready to read.
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerIdParam = searchParams.get("partner");

  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [data, setData] = useState<PartnerContainersDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holders, setHolders] = useState<ContainerHolderDto[] | null>(null);

  const partnerId = partner?.id ?? (partnerIdParam ? Number(partnerIdParam) : null);

  async function refresh(id: number) {
    setLoading(true);
    setError(null);
    try {
      const result = await getPartnerContainers(id);
      setData(result);
      // The picker starts empty on a deep link; fill it in from what came back so the field shows
      // whose page this is.
      setPartner((current) => current ?? { id: result.partnerId, name: result.partnerName });
    } catch (err) {
      setError(apiErrorMessage(err, "تعذّر تحميل الصناديق"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function refreshHolders() {
    try {
      setHolders(await getContainerHolders());
    } catch {
      // The overview is a convenience on top of the per-person view; failing to load it must
      // not take the page down with it.
      setHolders([]);
    }
  }

  useEffect(() => {
    if (partnerId) refresh(partnerId);
    else setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  useEffect(() => { refreshHolders(); }, []);

  function pickPartner(next: { id: number; name: string } | null) {
    setPartner(next);
    setSearchParams(next ? { partner: String(next.id) } : {});
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">الصناديق</h1>
      <p className="text-sm text-gray-500 mb-6">
        عدد فقط — لا علاقة له بحساب الشخص المالي. "المتبقي عليه" معناه إنه ماسك هالعدد من صناديقك،
        و"عندنا إله" معناه العكس — صناديقه هو موجودة عندك.
      </p>

      <div className="card p-4 mb-4 max-w-sm">
        <PartnerAutocomplete
          label="الشخص"
          value={partner}
          onChange={pickPartner}
          placeholder="اكتب الاسم واختره — بائع أو سائق أو مشتري..."
        />
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</div>}

      {!partnerId ? (
        <div className="text-gray-500">اختر شخصًا لعرض تفاصيله، أو شوف القائمة تحت.</div>
      ) : loading && !data ? (
        <div className="text-gray-500">جاري التحميل...</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {/* Crates here; sacks have their own screen, where their kind is part of the balance.
                Shown as a card each way round would be the same sacks counted on two pages. */}
            {data.balances.filter((b) => b.type !== "Sack").map((b) => (
              <BalanceCard key={b.type} balance={b} />
            ))}
          </div>

          {canCreate && (
            <MovementForm
              partnerId={data.partnerId}
              onSaved={() => { refresh(data.partnerId); refreshHolders(); }}
            />
          )}

          <MovementsTable
            movements={data.movements}
            partnerName={data.partnerName}
            canEdit={hasPermission("boxes.edit")}
            canDelete={canDelete}
            onDeleted={() => { refresh(data.partnerId); refreshHolders(); }}
          />
        </>
      ) : null}

      <HoldersTable holders={holders} onPick={(id, name) => pickPartner({ id, name })} />
    </div>
  );
}

/**
 * "مين ماسك صناديقي" — everyone who is not square, biggest holder first. The money side has had
 * this view for a while ("قيمة الدين"); without it the same question about crates meant opening
 * people one at a time and remembering.
 *
 * Always on screen, under the per-person detail: it is the question you ask before you know
 * whose name to type, and clicking a row fills the picker in above.
 */
function HoldersTable({ holders, onPick }: { holders: ContainerHolderDto[] | null; onPick: (id: number, name: string) => void }) {
  // Sacks are somebody else's screen now, and listing them here under a heading that says
  // صناديقي would be a heading that lies. Filtered by EXCLUDING sacks rather than by keeping only
  // crates: a stray كرتون row from before cartons stopped being tracked still belongs to somebody,
  // and keeping only Box would make it disappear from both screens at once.
  const crates = (holders ?? []).filter((h) => h.type !== "Sack");
  const pager = usePagination(crates);
  return (
    <div className="card mt-6">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={pager.pageRows}
          rowKey={(h) => `${h.partnerId}-${h.type}`}
          title={(h) => h.partnerName}
          value={(h) => (
            <span className={h.remaining > 0 ? "" : "text-brand-700"}>
              {formatCount(Math.abs(h.remaining))} {TYPE_UNIT[h.type]}
            </span>
          )}
          details={(h) => [
            { label: "النوع", value: TYPE_LABEL[h.type] },
            { label: h.remaining > 0 ? "عليه" : "عندنا إله", value: formatCount(Math.abs(h.remaining)) },
            // On the desktop the person's NAME is the button that opens their movements. In a card
            // the name is the title, and the title lives inside the open/close toggle — a button
            // inside a button is invalid HTML and two clicks fighting each other. So it is its own
            // row here, which is also the only way a phone could reach their movements at all.
            { label: "", value: (
              <button className="btn-link text-brand-700 text-sm hover:underline" onClick={() => onPick(h.partnerId, h.partnerName)}>
                عرض حركاته
              </button>
            ) },
          ]}
          empty="كل الحسابات مظبوطة — ما في حدا ماسك صناديق"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">مين ماسك صناديقي</div>
      <table className="table-base">
        <thead>
          <tr><th>الشخص</th><th>النوع</th><th>عليه</th><th>عندنا إله</th></tr>
        </thead>
        <tbody>
          {holders === null ? (
            <tr><td colSpan={4} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
          ) : crates.length === 0 ? (
            <tr><td colSpan={4} className="text-center text-gray-400 py-6">كل الحسابات مظبوطة — ما في حدا ماسك صناديق</td></tr>
          ) : pager.pageRows.map((h) => (
            <tr key={`${h.partnerId}-${h.type}`}>
              <td>
                <button className="btn-link text-brand-700 hover:underline" onClick={() => onPick(h.partnerId, h.partnerName)}>
                  {h.partnerName}
                </button>
              </td>
              <td>{TYPE_LABEL[h.type]}</td>
              {/* Two columns rather than one signed number: "عليه 40" and "عندنا إله 40" are
                  opposite facts, and a reader should not have to spot a minus sign to tell them
                  apart. */}
              <td className="font-semibold text-red-700">
                {h.remaining > 0 ? `${h.remaining.toLocaleString("en-US")} ${TYPE_UNIT[h.type]}` : "—"}
              </td>
              <td className="font-semibold text-brand-700">
                {h.remaining < 0 ? `${Math.abs(h.remaining).toLocaleString("en-US")} ${TYPE_UNIT[h.type]}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="سطر" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}

function BalanceCard({ balance }: { balance: ContainerBalanceDto }) {
  const unit = TYPE_UNIT[balance.type];
  return (
    <div className="card p-4">
      <div className="font-semibold text-gray-700 mb-3">{TYPE_LABEL[balance.type]}</div>
      {/* One per line on a phone: three columns of numbers at 375px wrap mid-figure. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        {/* The two derived sides are hidden at zero rather than printed as "0": a seller has no
            invoice side at all and a buyer has no goods-intake side, and a row of zeros reads as
            "nothing moved" instead of "this does not apply here". */}
        {balance.fromInvoices !== 0 && (
          <div>
            <div className="text-gray-500">على الفواتير</div>
            <div className="font-bold">{formatCount(balance.fromInvoices)}</div>
          </div>
        )}
        {balance.fromGoodsEntries !== 0 && (
          <div>
            <div className="text-gray-500">جابها مع البضاعة</div>
            <div className="font-bold text-brand-700">{formatCount(balance.fromGoodsEntries)}</div>
          </div>
        )}
        <div>
          <div className="text-gray-500">أعطيناه</div>
          <div className="font-bold">{balance.handedOut.toLocaleString("en-US")} {unit}</div>
        </div>
        <div>
          <div className="text-gray-500">رجّع</div>
          <div className="font-bold text-brand-700">{balance.cameBack.toLocaleString("en-US")} {unit}</div>
        </div>
        {/* The balance runs both ways, so the label says which way instead of leaving a minus
            sign to be read. A seller who brings his own crates sits permanently on the negative
            side, and "المتبقي عليه: -40" would read as a mistake. */}
        <div>
          <div className="text-gray-500">{balance.remaining < 0 ? "عندنا إله" : "المتبقي عليه"}</div>
          <div className={`font-bold ${balance.remaining > 0 ? "text-red-700" : balance.remaining < 0 ? "text-brand-700" : ""}`}>
            {Math.abs(balance.remaining).toLocaleString("en-US")} {unit}
          </div>
        </div>
      </div>
    </div>
  );
}

function MovementForm({ partnerId, onSaved }: { partnerId: number; onSaved: () => void }) {
  // Fixed, not chosen: this form records crates. See the note beside the picker.
  const [type, setType] = useState<ContainerType>("Box");
  const [direction, setDirection] = useState<ContainerDirection>("Out");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const parsed = parseFloat(quantity);
    if (!parsed || parsed <= 0) {
      setError("أدخل عددًا أكبر من صفر.");
      return;
    }
    setBusy(true);
    try {
      await createContainerMovement(partnerId, { type, direction, date, quantity: parsed, notes: notes || undefined });
      setQuantity("");
      setNotes("");
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-4">
      <div className="font-semibold text-gray-700 mb-3">تسجيل حركة</div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">النوع</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ContainerType)}>
            {/* Crates and sacks only. Cartons are counted on the invoice and on the reports, but
                they are not the market's to get back, so there is nothing to track here. */}
            {/* Crates only. Sacks have their own screen now — they come in colours and shapes,
                and recording one here would be a movement with no kind on it, invisible to every
                total over there. The type names below stay, because movements recorded from this
                picker before sacks moved out still have to render as a word. */}
            <option value="Box">صناديق</option>
          </select>
        </div>
        <div>
          <label className="label">الحركة</label>
          <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as ContainerDirection)}>
            <option value="Out">أعطيناه (بزيد المتبقي عليه)</option>
            <option value="In">رجّع / جاب (بنقّص المتبقي)</option>
          </select>
        </div>
        <div>
          <label className="label">التاريخ</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="w-28">
          <label className="label">العدد</label>
          <input className="input" type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="grow min-w-0 sm:min-w-[12rem]">
          <label className="label">ملاحظات (اختياري)</label>
          <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? "جاري الحفظ..." : "حفظ"}
        </button>
      </div>
      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
    </div>
  );
}

function MovementsTable({
  movements, partnerName, canEdit, canDelete, onDeleted,
}: {
  movements: PartnerContainersDto["movements"];
  /** Shown on the edit form, which does not offer to change it — see the dialog. */
  partnerName: string;
  canEdit: boolean;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState<PartnerContainersDto["movements"][number] | null>(null);
  const pager = usePagination(movements);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: number) {
    if (!window.confirm("حذف هذه الحركة؟")) return;
    setError(null);
    try {
      await deleteContainerMovement(id);
      onDeleted();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحذف"));
    }
  }

  /**
   * The row's own button. One definition, rendered by the desktop row and the phone's card —
   * a button that exists on only one of them is a button half the market does not have.
   */
  function rowActions(m: PartnerContainersDto["movements"][number]) {
    if (!canEdit && !canDelete) return null;
    return (
      <span className="flex flex-wrap gap-3">
        {canEdit && <button className="btn-link text-sm text-brand-700 hover:underline" onClick={() => setEditing(m)}>تعديل</button>}
        {canDelete && <button className="btn-link text-sm text-red-600 hover:underline" onClick={() => handleDelete(m.id)}>حذف</button>}
      </span>
    );
  }

  return (
    <div className="card">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={pager.pageRows}
          rowKey={(m) => m.id}
          title={(m) => TYPE_LABEL[m.type]}
          value={(m) => (
            <span className={m.direction === "Out" ? "text-red-700" : "text-brand-700"}>
              {m.direction === "Out" ? "أعطيناه" : "رجّع"} {m.quantity.toLocaleString("en-US")}
            </span>
          )}
          details={(m) => [
            { label: "التاريخ", value: formatDate(m.date) },
            { label: "ملاحظات", value: m.notes || "—" },
            ...(canEdit || canDelete ? [{ label: "", value: rowActions(m) }] : []),
          ]}
          empty="لا توجد حركات مسجّلة"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">سجل الحركات</div>
      {error && <div className="text-sm text-red-600 mx-4">{error}</div>}
      <table className="table-base">
        <thead>
          <tr><th>التاريخ</th><th>النوع</th><th>الحركة</th><th>العدد</th><th>ملاحظات</th>{(canEdit || canDelete) && <th></th>}</tr>
        </thead>
        <tbody>
          {movements.length === 0 ? (
            <tr><td colSpan={(canEdit || canDelete) ? 6 : 5} className="text-center text-gray-400 py-6">لا توجد حركات مسجّلة</td></tr>
          ) : pager.pageRows.map((m) => (
            <tr key={m.id}>
              <td>{formatDate(m.date)}</td>
              <td>{TYPE_LABEL[m.type]}</td>
              <td className={m.direction === "Out" ? "text-red-700" : "text-brand-700"}>
                {m.direction === "Out" ? "أعطيناه" : "رجّع / جاب"}
              </td>
              <td className="font-medium">{m.quantity.toLocaleString("en-US")} {TYPE_UNIT[m.type]}</td>
              <td className="text-gray-600">{m.notes || "—"}</td>
              {(canEdit || canDelete) && <td>{rowActions(m)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="حركة" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />

      {editing && (
        <ContainerMovementEditDialog
          movement={editing}
          partnerName={partnerName}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onDeleted(); }}
        />
      )}
    </div>
  );
}
