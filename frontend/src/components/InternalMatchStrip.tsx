import { AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert } from "lucide-react";
import type { InternalMatchStatus } from "../lib/types";
import { INTERNAL_MATCH_META } from "../lib/tiers";

const ICON = {
  ok: CheckCircle2,
  warn: ShieldAlert,
  danger: AlertTriangle,
  neutral: HelpCircle,
} as const;

const STRIP_CLASS = {
  ok: "border-green-200 bg-green-50",
  warn: "border-amber-200 bg-amber-50",
  danger: "border-red-200 bg-red-50",
  neutral: "border-slate-200 bg-slate-50",
} as const;

const ICON_CLASS = {
  ok: "text-green-600",
  warn: "text-amber-600",
  danger: "text-red-600",
  neutral: "text-slate-400",
} as const;

export function InternalMatchStrip({ status }: { status: InternalMatchStatus }) {
  if (!status) return null;
  const meta = INTERNAL_MATCH_META[status];
  const Icon = ICON[meta.severity];
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${STRIP_CLASS[meta.severity]}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_CLASS[meta.severity]}`} />
      <div>
        <p className="section-label">Internal Vendor Master</p>
        <p className="mt-1 text-sm font-bold text-slate-800">{meta.label}</p>
      </div>
    </div>
  );
}
