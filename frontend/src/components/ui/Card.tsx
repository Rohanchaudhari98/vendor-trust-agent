import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-sm font-bold text-slate-800 ${className}`}>{children}</h3>;
}
