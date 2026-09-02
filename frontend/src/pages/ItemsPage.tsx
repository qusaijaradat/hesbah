import { useEffect, useRef, useState } from "react";
import { createItem, deleteItem, listItems, updateItem } from "../api/items";
import type { ItemDto } from "../types";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Management page for the invoice item-name catalog (requirement: a real place to add/see
 * the list of items, not just whatever gets picked up incidentally from invoices). Mirrors
 * PartnersPage's list + modal pattern.
 */
export function ItemsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("items.create");
  const canEdit = hasPermission("items.edit");
  const canDelete = hasPermission("items.delete");
  const [items, setItems] = useState<ItemDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ItemDto | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const result = await listItems({ search: search || undefined, pageSize: 200 });
    setItems(result.items);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleDelete(item: ItemDto) {
    if (!window.confirm(`حذف "${item.name}" من قائمة الأصناف؟ (لن يؤثر على الفواتير السابقة)`)) return;
    setError(null);
    try {
      await deleteItem(item.id);
      refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحذف"));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">الأصناف</h1>
        {canCreate && (
          <button className="btn-primary" onClick={() => setEditing("new")}>+ إضافة صنف</button>
        )}
      </div>

      <input
        className="input max-w-sm mb-4"
        placeholder="بحث باسم الصنف..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>اسم الصنف</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={2} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={2} className="text-center text-gray-400 py-6">لا يوجد أصناف بعد</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium">{item.name}</td>
                  <td className="whitespace-nowrap">
                    {canEdit && (
                      <button className="text-gray-500 text-sm hover:underline ms-2" onClick={() => setEditing(item)}>تعديل</button>
                    )}
                    {canDelete && (
                      <button className="text-red-500 text-sm hover:underline ms-2" onClick={() => handleDelete(item)}>حذف</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ItemEditModal
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          // Renaming an existing item closes the modal (a one-off action). Adding a NEW
          // item deliberately stays open — the market usually adds several new item names
          // in a row, so re-opening "+ إضافة صنف" every time would just slow that down.
          onSaved={() => { if (editing !== "new") setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function ItemEditModal({ item, onClose, onSaved }: {
  item: ItemDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    if (!name.trim()) { setError("اسم الصنف مطلوب"); return; }
    setBusy(true);
    setError(null);
    try {
      if (item) {
        await updateItem(item.id, name);
        onSaved();
        return;
      }
      await createItem(name);
      onSaved();
      // Stay open for the next item: clear the field, refocus, flash a quick confirmation.
      setName("");
      setJustAdded(true);
      inputRef.current?.focus();
      setTimeout(() => setJustAdded(false), 1200);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-bold mb-4">{item ? "تعديل صنف" : "إضافة صنف جديد"}</h2>
        <div className="space-y-3">
          <div>
            <label className="label">اسم الصنف</label>
            <input ref={inputRef} className="input" value={name} placeholder="مثال: بندورة"
              onChange={(e) => setName(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSave()} />
          </div>
          {justAdded && <div className="text-sm text-brand-700">✅ تمت الإضافة — اكتب الصنف التالي أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{item ? "إلغاء" : "تم"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
