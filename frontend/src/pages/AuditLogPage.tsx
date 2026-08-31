import { Fragment, useEffect, useState } from "react";
import { listAuditLogEntityNames, listAuditLogs, type AuditLogFilter } from "../api/auditLogs";
import type { AuditLogDto } from "../types";
import { formatDateTime } from "../lib/format";

const ACTION_LABELS: Record<string, string> = {
  Created: "إضافة",
  Updated: "تعديل",
  Deleted: "حذف",
  Cancelled: "إلغاء",
};

// Entity names come straight from the C# class names (see AuditSaveChangesInterceptor) — this
// just gives the common ones a readable Arabic label; anything not listed here falls back to
// showing the raw name as-is, so a newly-added entity never disappears from the filter.
const ENTITY_LABELS: Record<string, string> = {
  Invoice: "فاتورة",
  InvoiceItem: "بند فاتورة",
  Partner: "شخص (بائع/سائق/مشتري)",
  Payment: "دفعة",
  Expense: "مصروف",
  User: "مستخدم",
  Role: "دور",
  Permission: "صلاحية",
  Setting: "إعداد",
  Item: "صنف",
};

function entityLabel(name: string) {
  return ENTITY_LABELS[name] ?? name;
}

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [entityNames, setEntityNames] = useState<string[]>([]);
  const [filter, setFilter] = useState<AuditLogFilter>({ page: 1, pageSize: 30 });
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    listAuditLogEntityNames().then(setEntityNames);
  }, []);

  async function refresh() {
    setLoading(true);
    const result = await listAuditLogs(filter);
    setLogs(result.items);
    setTotalCount(result.totalCount);
    setTotalPages(result.totalPages);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function updateFilter(patch: Partial<AuditLogFilter>) {
    setFilter((f) => ({ ...f, ...patch, page: 1 }));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">سجل التعديلات</h1>
      <p className="text-sm text-gray-500 mb-6">سجل كامل لكل إضافة أو تعديل أو حذف أو إلغاء تم في النظام — من قام به ومتى.</p>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">نوع البيانات</label>
          <select className="input" value={filter.entityName ?? ""} onChange={(e) => updateFilter({ entityName: e.target.value || undefined })}>
            <option value="">الكل</option>
            {entityNames.map((n) => <option key={n} value={n}>{entityLabel(n)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">الإجراء</label>
          <select className="input" value={filter.action ?? ""} onChange={(e) => updateFilter({ action: e.target.value || undefined })}>
            <option value="">الكل</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">من تاريخ</label>
          <input type="date" className="input" onChange={(e) => updateFilter({ dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
        </div>
        <div>
          <label className="label">إلى تاريخ</label>
          <input type="date" className="input" onChange={(e) => updateFilter({ dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
        </div>
        <div className="text-sm text-gray-500 ms-auto">{totalCount} سجل</div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>الوقت</th><th>المستخدم</th><th>نوع البيانات</th><th>الإجراء</th><th>المعرّف</th><th></th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد سجلات مطابقة</td></tr>
            ) : logs.map((log) => (
              <Fragment key={log.id}>
                <tr>
                  <td className="whitespace-nowrap text-sm">{formatDateTime(log.at)}</td>
                  <td>{log.userFullName ?? "—"}</td>
                  <td>{entityLabel(log.entityName)}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${actionBadgeClass(log.action)}`}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-gray-500">{log.entityId}</td>
                  <td>
                    {log.changesJson && log.changesJson !== "{}" && (
                      <button className="text-brand-700 text-sm hover:underline" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                        {expanded === log.id ? "إخفاء" : "التفاصيل"}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === log.id && (
                  <tr>
                    <td colSpan={6} className="bg-gray-50 p-3">
                      <ChangesDetail json={log.changesJson} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button className="btn-secondary" disabled={(filter.page ?? 1) <= 1} onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>السابق</button>
          <span className="text-sm text-gray-500">صفحة {filter.page ?? 1} من {totalPages}</span>
          <button className="btn-secondary" disabled={(filter.page ?? 1) >= totalPages} onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>التالي</button>
        </div>
      )}
    </div>
  );
}

function actionBadgeClass(action: string) {
  switch (action) {
    case "Created": return "bg-brand-100 text-brand-800";
    case "Deleted": return "bg-red-100 text-red-700";
    case "Cancelled": return "bg-amber-100 text-amber-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

/** Renders the {field: value} (Created) or {field: {old, new}} (Updated) diff JSON as a
 * readable list instead of dumping raw JSON on the screen. */
function ChangesDetail({ json }: { json: string | null | undefined }) {
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return <div className="text-xs text-gray-400">تعذّر عرض التفاصيل</div>;
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) return <div className="text-xs text-gray-400">لا توجد تفاصيل</div>;

  return (
    <ul className="text-sm space-y-1">
      {entries.map(([field, value]) => (
        <li key={field}>
          <span className="font-medium">{field}</span>:{" "}
          {isOldNewShape(value) ? (
            <span>
              <span className="text-red-500 line-through">{formatValue(value.old)}</span>
              {" ← "}
              <span className="text-brand-700">{formatValue(value.new)}</span>
            </span>
          ) : (
            <span className="text-gray-700">{formatValue(value)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function isOldNewShape(value: unknown): value is { old: unknown; new: unknown } {
  return typeof value === "object" && value !== null && "old" in value && "new" in value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
