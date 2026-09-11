import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-50 px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
