import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Hand, Globe, Lock } from "lucide-react";
import type { CheckDetail, Signal } from "../lib/types";
import {
  CATEGORY_LABEL,
  FRAUD_PATTERN_LABEL,
  OUTCOME_META,
  getPaymentDecision,
} from "../lib/tiers";
import { formatCurrency, formatDate } from "../lib/format";
import { DecisionBadge } from "./DecisionBadge";
import { CitationList } from "./CitationList";
import { api } from "../lib/api";
import { Spinner } from "./ui/Spinner";

export function ReportCard({
  check,
  compact = false,
  showActions = true,
  onDecisionRecorded,
}: {
  check: CheckDetail;
  compact?: boolean;
  /** Hide confirm buttons in inline copilot cards. */
  showActions?: boolean;
  /** Fired after a successful confirm pay / confirm hold. */
  onDecisionRecorded?: (check: CheckDetail) => void;
}) {
  // Compact inline cards (Ask AI) never show action buttons.
  const actionsEnabled = showActions && !compact;
  const decision = getPaymentDecision({
    risk_tier: check.risk_tier,
    internal_match_status: check.internal_match_status,
  });
  const outcome = OUTCOME_META[check.decision_status ?? "pending"];
  const isPending = (check.decision_status ?? "pending") === "pending";

  const internalSignals = check.signals.filter(
    (s) =>
      s.citations.some((c) => c.source_type === "internal") || s.category === "internal_records"
  );
  const webSignals = check.signals.filter((s) => !internalSignals.includes(s));

  return (
    <div className="space-y-5">
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
        <div className="flex flex-col items-end gap-1.5">
          <DecisionBadge
            riskTier={check.risk_tier}
            internalMatchStatus={check.internal_match_status}
          />
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${outcome.badgeClass}`}>
            {outcome.label}
          </span>
        </div>
      </div>

      <div className={`rounded-xl border-l-4 px-4 py-4 ${tierBorderClass(decision.decision)}`}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Recommendation</p>
        <p className="mt-1 text-xl font-bold text-slate-900">{decision.label}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          {check.recommendation || decision.reason}
        </p>
      </div>

      {actionsEnabled && check.id != null && (
        <DecisionActions
          check={check}
          isPending={isPending}
          onDecisionRecorded={onDecisionRecorded}
        />
      )}

      {!compact && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-teal-300 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
              <Globe className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-teal-900">Open-web research via Tavily</p>
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
        {check.decided_at ? <span>Decision recorded {formatDate(check.decided_at)}</span> : null}
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

function DecisionActions({
  check,
  isPending,
  onDecisionRecorded,
}: {
  check: CheckDetail;
  isPending: boolean;
  onDecisionRecorded?: (check: CheckDetail) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [justRecorded, setJustRecorded] = useState<"paid_simulated" | "held" | null>(null);
  const [changing, setChanging] = useState(false);

  const mutation = useMutation({
    mutationFn: ({ decision, decisionNote }: { decision: "paid_simulated" | "held"; decisionNote?: string }) =>
      api.recordDecision(check.id!, decision, decisionNote),
    onSuccess: (updated, vars) => {
      setError(null);
      setJustRecorded(vars.decision);
      setChanging(false);
      queryClient.setQueryData(["checks", check.id], updated);
      queryClient.invalidateQueries({ queryKey: ["checks"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      onDecisionRecorded?.(updated);
    },
    onError: (err: Error) => setError(err.message),
  });

  // Brief celebration state before parent may navigate/close.
  useEffect(() => {
    if (!justRecorded) return;
    const t = window.setTimeout(() => setJustRecorded(null), 4000);
    return () => window.clearTimeout(t);
  }, [justRecorded]);

  if (justRecorded || (!isPending && !changing)) {
    const status = justRecorded ?? check.decision_status;
    const meta = OUTCOME_META[status];
    const successTone =
      status === "held"
        ? "border-red-300 bg-red-50"
        : "border-green-300 bg-green-50";
    return (
      <div className={`rounded-xl border px-4 py-4 ${successTone}`}>
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              status === "held" ? "bg-red-600 text-white" : "bg-green-700 text-white"
            }`}
          >
            {status === "held" ? <Hand className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Invoice decision recorded
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900">{meta.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{meta.plainEnglish}</p>
            {check.decision_note ? (
              <p className="mt-2 text-xs text-slate-600">Note: {check.decision_note}</p>
            ) : null}
            <p className="mt-2 text-[11px] font-medium text-slate-500">
              Invoice desk KPIs and the results table now show this outcome.
            </p>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                setJustRecorded(null);
                setChanging(true);
              }}
              className="mt-3 text-xs font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900"
            >
              Change decision
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-300 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Record invoice decision
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Confirm payment or confirm hold for this invoice. This updates Invoice desk and Ask AI — it does not
        send a bank transfer.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({ decision: "paid_simulated", decisionNote: note || undefined })
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-green-700 px-3.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-60"
        >
          {mutation.isPending && mutation.variables?.decision === "paid_simulated" ? (
            <Spinner className="h-3.5 w-3.5 text-white" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Confirm payment
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ decision: "held", decisionNote: note || undefined })}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
        >
          {mutation.isPending && mutation.variables?.decision === "held" ? (
            <Spinner className="h-3.5 w-3.5 text-red-800" />
          ) : (
            <Hand className="h-3.5 w-3.5" />
          )}
          Confirm hold
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note — e.g. verified remittance by phone"
        className="mt-3 w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-xs text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500"
      />
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
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
