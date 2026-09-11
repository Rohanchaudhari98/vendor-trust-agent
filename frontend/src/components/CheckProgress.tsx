import { Check, Loader2 } from "lucide-react";

export type ProgressStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
};

/** Canonical stages shown while a live invoice check runs. */
export const CHECK_PROGRESS_STEPS: Omit<ProgressStep, "status">[] = [
  {
    id: "internal",
    label: "Comparing this payee to your approved-vendor list",
  },
  {
    id: "tavily_search",
    label: "Tavily searching the open web — legitimacy, adverse media, entity consistency",
  },
  {
    id: "tavily_extract",
    label: "Tavily extracting full page content from the strongest sources",
  },
  {
    id: "nebius",
    label: "Nebius model drafting a cited pay / hold / review recommendation",
  },
  {
    id: "persist",
    label: "Saving the report to your invoice history",
  },
];

export function CheckProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/60 px-3.5 py-3">
      <li className="pb-1 text-[11px] font-bold uppercase tracking-wide text-teal-900">
        Research in progress
      </li>
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2.5">
          <StepIcon status={step.status} />
          <span
            className={`text-xs leading-snug ${
              step.status === "pending"
                ? "text-slate-400"
                : step.status === "running"
                  ? "font-semibold text-teal-900"
                  : "text-slate-700"
            }`}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "running") {
    return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-teal-700" />;
  }
  return <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-slate-300 bg-white" />;
}

export function initialProgressSteps(): ProgressStep[] {
  return CHECK_PROGRESS_STEPS.map((s) => ({ ...s, status: "pending" as const }));
}

export function applyProgressEvent(
  steps: ProgressStep[],
  event: { id: string; label?: string; status: "running" | "done" }
): ProgressStep[] {
  const idx = steps.findIndex((s) => s.id === event.id);
  return steps.map((step, i) => {
    if (step.id === event.id) {
      return {
        ...step,
        label: event.label ?? step.label,
        status: event.status,
      };
    }
    // If a later stage starts, treat prior unfinished stages as done so the
    // UI never shows two "running" rows if a done event was missed.
    if (event.status === "running" && idx >= 0 && i < idx && step.status !== "done") {
      return { ...step, status: "done" as const };
    }
    return step;
  });
}

export function markAllProgressDone(steps: ProgressStep[]): ProgressStep[] {
  return steps.map((s) => ({ ...s, status: "done" as const }));
}
