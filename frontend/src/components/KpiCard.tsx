import type { LucideIcon } from "lucide-react";

const TONE_ICON: Record<"neutral" | "danger" | "success" | "warn" | "info", string> = {
  neutral: "bg-blue-50 text-blue-600 border border-blue-200",
  danger: "bg-orange-50 text-orange-600 border border-orange-200",
  success: "bg-green-50 text-green-600 border border-green-200",
  warn: "bg-amber-50 text-amber-600 border border-amber-200",
  info: "bg-teal-50 text-teal-700 border border-teal-200",
};

export function KpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: LucideIcon;
  tone?: "neutral" | "danger" | "success" | "warn" | "info";
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-slate-300 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <p className="section-label leading-none">{label}</p>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="text-[26px] font-black leading-none tracking-tight text-slate-800">{value}</p>
      {sublabel ? <p className="text-[10px] text-slate-500">{sublabel}</p> : null}
    </div>
  );
}
