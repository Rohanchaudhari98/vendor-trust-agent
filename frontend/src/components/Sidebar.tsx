import { useState } from "react";
import { LayoutDashboard, Building2, ShieldCheck, Activity, CircleHelp, ArrowDown } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useCopilot } from "./copilot/CopilotContext";

const WORKFLOW_NAV = [
  {
    to: "/",
    label: "Invoice desk",
    hint: "Check payees & record outcomes",
    icon: LayoutDashboard,
    end: true,
  },
];

const ADMIN_NAV = [
  { to: "/vendors", label: "Approved vendors", hint: "Maintain vendor master", icon: Building2 },
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
  const { openCopilot } = useCopilot();
  // Show on every hard refresh / full page load; dismiss only for this session.
  const [showHelpNudge, setShowHelpNudge] = useState(true);

  function openHelpGuide() {
    setShowHelpNudge(false);
    openCopilot({ showHelpGuide: true, contextCheckId: null });
  }

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
        {WORKFLOW_NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Admin
        </p>
        {ADMIN_NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="relative space-y-1 border-t border-white/5 px-2 py-3">
        {showHelpNudge ? (
          <div className="pointer-events-none absolute inset-x-2 bottom-full mb-1 flex flex-col items-center">
            <div className="rounded-lg bg-teal-500 px-2.5 py-1.5 text-center shadow-lg shadow-teal-900/40">
              <p className="text-[11px] font-bold leading-tight text-white">New here? Start with this</p>
              <p className="mt-0.5 text-[10px] leading-tight text-teal-50">
                Opens a short how-to in Ask AI
              </p>
            </div>
            <ArrowDown
              className="mt-1 h-5 w-5 text-teal-400 help-nudge-bounce"
              aria-hidden
            />
          </div>
        ) : null}

        <button
          type="button"
          onClick={openHelpGuide}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
            showHelpNudge
              ? "bg-teal-500/15 text-white ring-1 ring-teal-400/50"
              : "text-slate-300 hover:bg-sidebar-hover hover:text-white"
          }`}
        >
          <CircleHelp
            className={`h-4 w-4 shrink-0 ${showHelpNudge ? "text-teal-300" : "text-sidebar-accent"}`}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium leading-tight">Want to know how to use?</span>
            <span className="block truncate text-[10px] font-normal opacity-60">
              Opens Ask AI with a walkthrough
            </span>
          </span>
        </button>

        {showHelpNudge ? (
          <button
            type="button"
            onClick={() => setShowHelpNudge(false)}
            className="w-full px-3 text-left text-[10px] font-medium text-slate-500 hover:text-slate-300"
          >
            Dismiss tip
          </button>
        ) : null}

        <p className="px-3 pt-2 text-[11px] leading-relaxed text-slate-500">
          Catch payee impersonation before payment. Open-web evidence via{" "}
          <span className="text-sidebar-accent">Tavily</span>.
        </p>
      </div>
    </aside>
  );
}
