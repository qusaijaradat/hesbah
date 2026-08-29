export function StatCard({ label, value, hint, tone = "default" }: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass = tone === "positive" ? "text-brand-700" : tone === "negative" ? "text-red-600" : "text-gray-900";
  return (
    <div className="card p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}
