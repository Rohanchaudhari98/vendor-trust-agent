import { LayoutDashboard, Building2, ShieldCheck, Activity } from "lucide-react";
import { NavLink } from "react-router-dom";

const PRIMARY_NAV = [
  { to: "/", label: "Home", hint: "Check an invoice", icon: LayoutDashboard, end: true },
];

const SECONDARY_NAV = [
  { to: "/vendors", label: "Approved vendors", hint: "Your vendor list", icon: Building2 },
  { to: "/observability", label: "Costs & traces", hint: "Spend & latency", icon: Activity },
];

function NavItem({
  to,
  label,
  hint,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive
            ? "bg-sidebar-active font-semibold text-white"
            : "text-slate-400 hover:bg-sidebar-hover hover:text-white"
        }`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate leading-tight">{label}</span>
        <span className="block truncate text-[10px] font-normal opacity-60">{hint}</span>
      </span>
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-white/5 bg-sidebar">
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-active text-white">
          <ShieldCheck className="h-4.5 w-4.5" />
        </div>
        <div>
          <p className="text-[13px] font-semibold leading-tight text-white">Vendor Trust</p>
          <p className="text-[11px] leading-tight text-sidebar-text">Pay · Hold · Review</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Workflow
        </p>
        {PRIMARY_NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Setup & ops
        </p>
        {SECONDARY_NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="border-t border-white/5 px-4 py-4">
        <p className="text-[11px] leading-relaxed text-slate-500">
          Catch payee impersonation before payment. Open-web evidence via{" "}
          <span className="text-sidebar-accent">Tavily</span>.
        </p>
      </div>
    </aside>
  );
}
