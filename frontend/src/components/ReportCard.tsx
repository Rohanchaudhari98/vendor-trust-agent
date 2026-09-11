import { AlertOctagon, Clock3, DollarSign, FileSearch } from "lucide-react";
import type { CheckDetail } from "../lib/types";
import {
  CATEGORY_HINT,
  CATEGORY_LABEL,
  FRAUD_PATTERN_LABEL,
  TIER_META,
  getPaymentDecision,
} from "../lib/tiers";
import { formatCurrency, formatDate, formatLatency } from "../lib/format";
import { DecisionBadge } from "./DecisionBadge";
import { CitationList } from "./CitationList";
import { Badge } from "./ui/Badge";

export function ReportCard({ check, compact = false }: { check: CheckDetail; compact?: boolean }) {
  const decision = getPaymentDecision({
    risk_tier: check.risk_tier,
    internal_match_status: check.internal_match_status,
  });

  const hasTavilyCredits =
    typeof check.search_credits === "number" || typeof check.extract_credits === "number";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-800">{check.vendor_name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {check.address ? <span>{check.address}</span> : null}
            {check.invoice_amount !== null ? (
              <span className="font-semibold text-slate-700">
                Invoice {formatCurrency(check.invoice_amount)}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <FileSearch className="h-3.5 w-3.5 text-teal-600" />
              {check.evidence_count} web source{check.evidence_count === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <DecisionBadge
          riskTier={check.risk_tier}
          internalMatchStatus={check.internal_match_status}
        />
      </div>

      {/* One decision block — label + backend recommendation only (no repeated "reason") */}
      <div className={`rounded-xl border-l-4 px-4 py-3.5 ${tierBorderClass(decision.decision)}`}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <AlertOctagon className="h-3.5 w-3.5 text-slate-500" />
          <p className="section-label">What to do</p>
        </div>
        <p className="text-base font-bold leading-snug text-slate-900">{decision.label}</p>
        {check.recommendation ? (
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{check.recommendation}</p>
        ) : (
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{decision.reason}</p>
        )}
      </div>

      {!compact && (
        <div className="space-y-3">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-800">Evidence</h3>
              <Badge className="bg-white text-slate-600 border border-slate-300">
                Web risk: {TIER_META[check.risk_tier].label}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              <span className="font-semibold text-teal-800">Tavily</span> ran three searches
              (legitimacy, adverse media, entity consistency), score-filtered and extracted real
              page text — not snippets only — then we compared against your approved-vendor list
              {hasTavilyCredits ? (
                <>
                  {" "}
                  ({check.search_credits ?? 0} search / {check.extract_credits ?? 0} extract credits)
                </>
              ) : null}
              .
            </p>
          </div>

          {check.signals.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              No specific findings were raised for this vendor.
            </p>
          ) : (
            check.signals.map((signal, i) => (
              <section key={i} className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    {CATEGORY_LABEL[signal.category] ?? signal.category}
                  </span>
                  {signal.fraud_pattern !== "none" && (
                    <span className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      {FRAUD_PATTERN_LABEL[signal.fraud_pattern] ?? signal.fraud_pattern}
                    </span>
                  )}
                </div>
                {CATEGORY_HINT[signal.category] ? (
                  <p className="mb-1.5 text-[11px] text-slate-500">{CATEGORY_HINT[signal.category]}</p>
                ) : null}
                <p className="text-sm leading-relaxed text-slate-800">{signal.finding}</p>
                <CitationList citations={signal.citations} />
              </section>
            ))
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-300 pt-3 text-[11px] text-slate-500">
        <span>Checked {formatDate(check.created_at)}</span>
        <span className="inline-flex items-center gap-1">
          <DollarSign className="h-3 w-3" />${check.cost_usd.toFixed(4)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3 w-3" />
          {formatLatency(check.latency_ms)}
        </span>
        {check.langfuse_trace_url ? (
          <a
            href={check.langfuse_trace_url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-blue-600 hover:text-blue-700"
          >
            View Langfuse trace
          </a>
        ) : null}
      </div>
    </div>
  );
}

function tierBorderClass(decision: "pay" | "hold" | "review"): string {
  switch (decision) {
    case "pay":
      return "border-green-500 bg-green-50";
    case "hold":
      return "border-red-500 bg-red-50";
    case "review":
      return "border-amber-500 bg-amber-50";
  }
}
