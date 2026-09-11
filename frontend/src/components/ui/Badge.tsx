import type { ReactNode } from "react";

export function Badge({
  children,
  className = "",
  dotClassName,
}: {
  children: ReactNode;
  className?: string;
  dotClassName?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {dotClassName && <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />}
      {children}
    </span>
  );
}
