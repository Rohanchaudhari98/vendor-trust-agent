import type { ReactNode } from "react";

/** Plain-English hover tip — works for any audience, no modal required. */
export function HelpTip({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <span className="group/help relative inline-flex max-w-full items-center gap-1">
      {children}
      <span
        className={`pointer-events-none absolute left-0 top-full z-40 mt-1.5 hidden rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-white shadow-xl group-hover/help:block ${
          wide ? "w-64" : "w-52"
        }`}
      >
        {label}
        <span className="absolute bottom-full left-3 border-[5px] border-transparent border-b-slate-800" />
      </span>
    </span>
  );
}
