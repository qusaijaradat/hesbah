import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { TablePagination } from "../components/TablePagination";
import { usePagination } from "../lib/usePagination";
import { createContainerMovement, deleteContainerMovement, getPartnerContainers } from "../api/partners";
import { apiErrorMessage } from "../api/client";
import { formatDate, formatQuantity, todayLocalDateString } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { ContainerBalanceDto, ContainerDirection, ContainerType, PartnerContainersDto } from "../types";

/**
 * "الصناديق والمخالات" — the empty containers the market lends out and expects back.
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
const TYPE_LABEL: Record<ContainerType, string> = { Box: "صناديق", Sack: "مخالات" };
const TYPE_UNIT: Record<ContainerType, string> = { Box: "صندوق", Sack: "مخلاة" };

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

  useEffect(() => {
    if (partnerId) refresh(partnerId);
    else setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  function pickPartner(next: { id: number; name: string } | null) {
    setPartner(next);
    setSearchParams(next ? { partner: String(next.id) } : {});
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">الصناديق والمخالات</h1>
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
        <div className="text-gray-500">اختر شخصًا لعرض صناديقه ومخالاته.</div>
      ) : loading && !data ? (
        <div className="text-gray-500">جاري التحميل...</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {data.balances.map((b) => (
              <BalanceCard key={b.type} balance={b} />
            ))}
          </div>

          {canCreate && <MovementForm partnerId={data.partnerId} onSaved={() => refresh(data.partnerId)} />}

          <MovementsTable
            movements={data.movements}
            canDelete={canDelete}
            onDeleted={() => refresh(data.partnerId)}
          />
        </>
      ) : null}
    </div>
  );
}

function BalanceCard({ balance }: { balance: ContainerBalanceDto }) {
  const unit = TYPE_UNIT[balance.type];
  return (
    <div className="card p-4">
      <div className="font-semibold text-gray-700 mb-3">{TYPE_LABEL[balance.type]}</div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        {/* The two derived sides are hidden at zero rather than printed as "0": a seller has no
            invoice side at all and a buyer has no goods-intake side, and a row of zeros reads as
            "nothing moved" instead of "this does not apply here". */}
        {balance.fromInvoices !== 0 && (
          <div>
            <div className="text-gray-500">على الفواتير</div>
            <div className="font-bold">{formatQuantity(balance.fromInvoices, "Box")}</div>
          </div>
        )}
        {balance.fromGoodsEntries !== 0 && (
          <div>
            <div className="text-gray-500">جابها مع البضاعة</div>
            <div className="font-bold text-brand-700">{formatQuantity(balance.fromGoodsEntries, "Box")}</div>
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
            <option value="Box">صناديق</option>
            <option value="Sack">مخالات</option>
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
        <div className="grow min-w-[12rem]">
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
  movements, canDelete, onDeleted,
}: {
  movements: PartnerContainersDto["movements"];
  canDelete: boolean;
  onDeleted: () => void;
}) {
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

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">سجل الحركات</div>
      {error && <div className="text-sm text-red-600 mx-4">{error}</div>}
      <table className="table-base">
        <thead>
          <tr><th>التاريخ</th><th>النوع</th><th>الحركة</th><th>العدد</th><th>ملاحظات</th>{canDelete && <th></th>}</tr>
        </thead>
        <tbody>
          {movements.length === 0 ? (
            <tr><td colSpan={canDelete ? 6 : 5} className="text-center text-gray-400 py-6">لا توجد حركات مسجّلة</td></tr>
          ) : pager.pageRows.map((m) => (
            <tr key={m.id}>
              <td>{formatDate(m.date)}</td>
              <td>{TYPE_LABEL[m.type]}</td>
              <td className={m.direction === "Out" ? "text-red-700" : "text-brand-700"}>
                {m.direction === "Out" ? "أعطيناه" : "رجّع / جاب"}
              </td>
              <td className="font-medium">{m.quantity.toLocaleString("en-US")} {TYPE_UNIT[m.type]}</td>
              <td className="text-gray-600">{m.notes || "—"}</td>
              {canDelete && (
                <td>
                  <button className="text-sm text-red-600 hover:underline" onClick={() => handleDelete(m.id)}>حذف</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="حركة" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}
