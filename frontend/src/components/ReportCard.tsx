import { Globe, Lock } from "lucide-react";
import type { CheckDetail, Signal } from "../lib/types";
import {
  CATEGORY_LABEL,
  FRAUD_PATTERN_LABEL,
  getPaymentDecision,
} from "../lib/tiers";
import { formatCurrency, formatDate } from "../lib/format";
import { DecisionBadge } from "./DecisionBadge";
import { CitationList } from "./CitationList";

export function ReportCard({ check, compact = false }: { check: CheckDetail; compact?: boolean }) {
  const decision = getPaymentDecision({
    risk_tier: check.risk_tier,
    internal_match_status: check.internal_match_status,
  });

  const internalSignals = check.signals.filter((s) =>
    s.citations.some((c) => c.source_type === "internal") || s.category === "internal_records",
  );
  const webSignals = check.signals.filter((s) => !internalSignals.includes(s));

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">{check.vendor_name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {[
              check.address,
              check.invoice_amount !== null ? `Invoice ${formatCurrency(check.invoice_amount)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <DecisionBadge
          riskTier={check.risk_tier}
          internalMatchStatus={check.internal_match_status}
        />
      </div>

      {/* Decision — one clear answer */}
      <div className={`rounded-xl border-l-4 px-4 py-4 ${tierBorderClass(decision.decision)}`}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">What to do</p>
        <p className="mt-1 text-xl font-bold text-slate-900">{decision.label}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          {check.recommendation || decision.reason}
        </p>
      </div>

      {!compact && (
        <>
          {/* Tavily callout — intentional brand presence */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-teal-300 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
              <Globe className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-teal-900">
                Open-web research via Tavily
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-teal-800/80">
                Search + page extract across legitimacy, adverse media, and entity consistency
                {check.evidence_count > 0
                  ? ` · ${check.evidence_count} source${check.evidence_count === 1 ? "" : "s"}`
                  : ""}
                {check.search_credits || check.extract_credits
                  ? ` · ${check.search_credits ?? 0} search / ${check.extract_credits ?? 0} extract`
                  : ""}
              </p>
            </div>
          </div>

          {/* Split: your records vs web — scannable, less wall of text */}
          <div className="space-y-4">
            {internalSignals.length > 0 && (
              <EvidenceGroup
                title="Your records"
                subtitle="Compared to your approved-vendor list"
                tone="internal"
                signals={internalSignals}
              />
            )}
            {webSignals.length > 0 && (
              <EvidenceGroup
                title="Open web"
                subtitle="Findings from Tavily search + extract"
                tone="tavily"
                signals={webSignals}
              />
            )}
            {check.signals.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No specific findings were raised for this vendor.
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
        <span>Checked {formatDate(check.created_at)}</span>
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

function EvidenceGroup({
  title,
  subtitle,
  tone,
  signals,
}: {
  title: string;
  subtitle: string;
  tone: "internal" | "tavily";
  signals: Signal[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
        {tone === "tavily" ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-teal-300 bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <Globe className="h-3 w-3" />
            Tavily
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            <Lock className="h-3 w-3" />
            Internal
          </span>
        )}
      </div>
      <div className="space-y-2">
        {signals.map((signal, i) => (
          <FindingRow key={i} signal={signal} />
        ))}
      </div>
    </div>
  );
}

/** Compact finding: title row + short body + sources — no meta questions. */
function FindingRow({ signal }: { signal: Signal }) {
  return (
    <section
      className={`rounded-xl border px-3.5 py-3 ${
        signal.fraud_pattern !== "none"
          ? "border-red-200 bg-red-50/40"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold text-slate-800">
          {CATEGORY_LABEL[signal.category] ?? signal.category}
        </span>
        {signal.fraud_pattern !== "none" && (
          <span className="rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
            {FRAUD_PATTERN_LABEL[signal.fraud_pattern] ?? signal.fraud_pattern}
          </span>
        )}
      </div>
      <p className="text-sm leading-snug text-slate-700">{signal.finding}</p>
      <CitationList citations={signal.citations} compact />
    </section>
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
