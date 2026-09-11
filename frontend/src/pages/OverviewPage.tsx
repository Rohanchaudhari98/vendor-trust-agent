import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PlusCircle,
  ShieldCheck,
  Hourglass,
  CheckCircle2,
  Hand,
  AlertTriangle,
  Search,
} from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { NewCheckForm } from "../components/NewCheckForm";
import { CheckTable } from "../components/CheckTable";
import { KpiCard } from "../components/KpiCard";
import { LoadingBlock } from "../components/ui/Spinner";
import { TextInput } from "../components/ui/Field";
import { useCopilot } from "../components/copilot/CopilotContext";

const OUTCOME_FILTERS = [
  { value: "", label: "All recommendations" },
  { value: "clear", label: "OK to pay (clear)" },
  { value: "low", label: "OK to pay (low risk)" },
  { value: "medium", label: "Review" },
  { value: "needs_manual_review", label: "Review (needs person)" },
  { value: "high", label: "Hold" },
];

export function OverviewPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const { openCopilot } = useCopilot();

  const kpis = useQuery({ queryKey: ["kpis"], queryFn: () => api.getKPIs() });
  const reports = useQuery({
    queryKey: ["checks", { q, tier, limit: 100 }],
    queryFn: () => api.listChecks({ q: q || undefined, tier: tier || undefined, limit: 100 }),
  });

  return (
    <div className="page-shell">
      <div className="rounded-xl border border-slate-300 border-l-4 border-l-teal-600 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h1 className="text-xl font-bold text-slate-800">
              Before you pay — is this payee really who they claim?
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Fraudsters often impersonate a vendor you already pay — same name, wrong address or
              bank details on the invoice. Paste the payee below; we look them up on the open web
              with <span className="font-semibold text-teal-800">Tavily</span> and compare to your
              approved list, then answer <span className="font-semibold text-slate-800">OK to pay</span>
              , <span className="font-semibold text-slate-800">Hold</span>, or{" "}
              <span className="font-semibold text-slate-800">Review</span>. Open a report to{" "}
              <span className="font-semibold text-slate-800">confirm payment or confirm hold</span> so
              Home shows the invoice outcome.
            </p>
          </div>
          <Button onClick={() => setDrawerOpen(true)} icon={<PlusCircle className="h-3.5 w-3.5" />}>
            Check this invoice
          </Button>
        </div>
      </div>

      {kpis.isLoading ? (
        <LoadingBlock label="Loading summary…" />
      ) : kpis.data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Invoices checked"
            value={kpis.data.total_checks.toLocaleString()}
            sublabel="Payee checks run so far"
            icon={ShieldCheck}
            tone="neutral"
            onAskAI={() =>
              openCopilot({
                draft: "Give me a quick summary of all vendor checks so far.",
                contextCheckId: null,
              })
            }
          />
          <KpiCard
            label="Awaiting decision"
            value={(kpis.data.awaiting_decision ?? 0).toLocaleString()}
            sublabel="Recommendation only — not yet confirmed"
            icon={Hourglass}
            tone="warn"
            onAskAI={() =>
              openCopilot({
                draft: "Which checks are still awaiting a pay or hold decision?",
                contextCheckId: null,
              })
            }
          />
          <KpiCard
            label="Payment confirmed"
            value={(kpis.data.paid_simulated ?? 0).toLocaleString()}
            sublabel="Clerk recorded payment approval — no bank transfer from here"
            icon={CheckCircle2}
            tone="success"
            onAskAI={() =>
              openCopilot({
                draft:
                  "Which invoices have we confirmed for payment, and why were they cleared?",
                contextCheckId: null,
              })
            }
          />
          <KpiCard
            label="Held"
            value={(kpis.data.held ?? 0).toLocaleString()}
            sublabel="Clerk confirmed do-not-pay"
            icon={Hand}
            tone="danger"
            onAskAI={() =>
              openCopilot({
                draft: "Which invoices did we confirm as held, and what evidence led to that?",
                contextCheckId: null,
              })
            }
          />
        </div>
      ) : null}

      {kpis.data && kpis.data.internal_discrepancy_count > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-bold">{kpis.data.internal_discrepancy_count}</span> invoice
            {kpis.data.internal_discrepancy_count === 1 ? "" : "s"} match a name on your approved
            list but not the details on file. Those rows show{" "}
            <span className="font-bold">Hold</span> below.{" "}
            <button
              type="button"
              className="font-semibold text-red-900 underline underline-offset-2 hover:no-underline"
              onClick={() =>
                openCopilot({
                  draft: "What checks have flagged an internal vendor-master discrepancy?",
                  contextCheckId: null,
                })
              }
            >
              Ask AI about these →
            </button>
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Results</CardTitle>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Recommendation vs recorded outcome — open a row to confirm payment or hold
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-3 p-4 pt-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vendor name…"
                className="pl-9"
              />
            </div>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="h-8 rounded-lg border-0 bg-white px-3 text-xs text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-500"
            >
              {OUTCOME_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </CardBody>
        <CardBody className="border-t border-slate-200 p-0">
          {reports.isLoading ? <LoadingBlock /> : <CheckTable checks={reports.data ?? []} />}
        </CardBody>
      </Card>

      {kpis.data ? (
        <p className="text-center text-[11px] text-slate-500">
          Avg research cost ${kpis.data.avg_cost_per_check.toFixed(4)} per check ·{" "}
          <button
            type="button"
            className="font-semibold text-teal-700 hover:underline"
            onClick={() =>
              openCopilot({
                draft: "Break down what's driving our Tavily + AI cost per check.",
                contextCheckId: null,
              })
            }
          >
            Ask AI about costs
          </button>
          {" · "}
          <Link to="/observability" className="font-semibold text-blue-600 hover:underline">
            Costs & traces
          </Link>
        </p>
      ) : null}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Check this invoice"
        description="Enter the payee exactly as printed. We compare your approved list, Tavily searches the open web, then Nebius drafts a cited recommendation. Usually 15–60 seconds."
      >
        <NewCheckForm
          onDecisionRecorded={() => {
            // After confirm pay/hold, return to Home so KPIs/table feel updated.
            window.setTimeout(() => setDrawerOpen(false), 1200);
          }}
        />
      </Drawer>
    </div>
  );
}
