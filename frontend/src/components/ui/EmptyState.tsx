import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="mb-2 rounded-2xl bg-slate-100 p-3">
        <Icon className="h-6 w-6 text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? <p className="max-w-sm text-sm leading-relaxed text-slate-500">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
