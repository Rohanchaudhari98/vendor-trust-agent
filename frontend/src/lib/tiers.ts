import type { DecisionStatus, InternalMatchStatus, RiskTier } from "./types";

/** The only primary answer a non-expert needs: what to do with this invoice. */
export type PaymentDecision = "pay" | "hold" | "review";

export type DecisionMeta = {
  decision: PaymentDecision;
  /** Short action label shown in tables — Pay / Hold / Review */
  label: string;
  /** One-line why — readable without hover tooltips */
  reason: string;
  badgeClass: string;
  rowAccent: string;
};

export const OUTCOME_META: Record<
  DecisionStatus,
  { label: string; badgeClass: string; plainEnglish: string }
> = {
  pending: {
    label: "Awaiting decision",
    badgeClass: "bg-slate-50 text-slate-700 border border-slate-300",
    plainEnglish: "Recommendation only — no one has confirmed pay or hold yet.",
  },
  paid_simulated: {
    label: "Paid (simulated)",
    badgeClass: "bg-green-50 text-green-800 border border-green-300",
    plainEnglish: "Clerk confirmed payment. No real bank transfer — demo outcome only.",
  },
  held: {
    label: "Held",
    badgeClass: "bg-red-50 text-red-800 border border-red-300",
    plainEnglish: "Clerk confirmed this invoice should not be paid yet.",
  },
};

/**
 * Collapse risk tier + internal match into one plain decision.
 * Internal mismatches and blocks always win over a "clear" web score —
 * that's the vendor-impersonation case this tool exists to catch.
 */
export function getPaymentDecision(input: {
  risk_tier: RiskTier;
  internal_match_status: InternalMatchStatus;
}): DecisionMeta {
  const match = input.internal_match_status;
  const tier = input.risk_tier;

  if (match === "blocked_match") {
    return {
      decision: "hold",
      label: "Hold",
      reason: "This vendor is blocked in your records — do not pay.",
      badgeClass: "bg-red-50 text-red-800 border border-red-300",
      rowAccent: "border-l-red-500",
    };
  }
  if (match === "approved_match_discrepancy") {
    return {
      decision: "hold",
      label: "Hold",
      reason: "Name matches an approved vendor, but details don’t — verify before paying.",
      badgeClass: "bg-red-50 text-red-800 border border-red-300",
      rowAccent: "border-l-red-500",
    };
  }
  if (tier === "high") {
    return {
      decision: "hold",
      label: "Hold",
      reason: "Serious risk signals on the open web — hold and escalate.",
      badgeClass: "bg-red-50 text-red-800 border border-red-300",
      rowAccent: "border-l-red-500",
    };
  }
  if (match === "watchlist_match") {
    return {
      decision: "review",
      label: "Review",
      reason: "On your watchlist — a person should look before paying.",
      badgeClass: "bg-amber-50 text-amber-900 border border-amber-300",
      rowAccent: "border-l-amber-500",
    };
  }
  if (tier === "medium" || tier === "needs_manual_review") {
    return {
      decision: "review",
      label: "Review",
      reason: "Some concerns or thin evidence — review the report before paying.",
      badgeClass: "bg-amber-50 text-amber-900 border border-amber-300",
      rowAccent: "border-l-amber-500",
    };
  }
  // clear / low
  if (match === "no_match") {
    return {
      decision: "pay",
      label: "OK to pay",
      reason: "No material red flags — new to your approved list, so use normal process.",
      badgeClass: "bg-green-50 text-green-800 border border-green-300",
      rowAccent: "border-l-green-500",
    };
  }
  return {
    decision: "pay",
    label: "OK to pay",
    reason: "No material red flags — details match what you have on file.",
    badgeClass: "bg-green-50 text-green-800 border border-green-300",
    rowAccent: "border-l-green-500",
  };
}

export const TIER_META: Record<
  RiskTier,
  { label: string; badgeClass: string; dotClass: string; plainEnglish: string }
> = {
  clear: {
    label: "Clear",
    badgeClass: "bg-green-50 text-green-700 border border-green-200",
    dotClass: "bg-green-500",
    plainEnglish: "No material red flags found. Still use your normal payment process.",
  },
  low: {
    label: "Low",
    badgeClass: "bg-green-50 text-green-700 border border-green-200",
    dotClass: "bg-green-400",
    plainEnglish: "Mostly clean. Minor gaps only — usually safe to proceed with standard checks.",
  },
  medium: {
    label: "Medium",
    badgeClass: "bg-amber-50 text-amber-700 border border-amber-200",
    dotClass: "bg-amber-500",
    plainEnglish: "Some concerns. Review the findings before paying.",
  },
  high: {
    label: "High",
    badgeClass: "bg-red-50 text-red-700 border border-red-200",
    dotClass: "bg-red-500",
    plainEnglish: "Serious risk signals. Hold payment and escalate.",
  },
  needs_manual_review: {
    label: "Needs Review",
    badgeClass: "bg-blue-50 text-blue-800 border border-blue-200",
    dotClass: "bg-blue-500",
    plainEnglish: "Automated check couldn’t clear this safely. A person should review before payment.",
  },
};

export const INTERNAL_MATCH_META: Record<
  NonNullable<InternalMatchStatus>,
  {
    label: string;
    badgeClass: string;
    severity: "ok" | "warn" | "danger" | "neutral";
    plainEnglish: string;
  }
> = {
  approved_match: {
    label: "Approved vendor — on file",
    badgeClass: "bg-green-50 text-green-700 border border-green-200",
    severity: "ok",
    plainEnglish: "This vendor is already on your approved list, and details match what you have on file.",
  },
  approved_match_discrepancy: {
    label: "Approved vendor — details mismatch",
    badgeClass: "bg-red-50 text-red-700 border border-red-200",
    severity: "danger",
    plainEnglish:
      "Name matches an approved vendor, but the address/details don’t. Common in invoice fraud / vendor impersonation — verify before paying.",
  },
  watchlist_match: {
    label: "Watchlist — internally flagged",
    badgeClass: "bg-amber-50 text-amber-700 border border-amber-200",
    severity: "warn",
    plainEnglish: "Your team previously flagged this vendor for extra scrutiny.",
  },
  blocked_match: {
    label: "Blocked — cannot pay",
    badgeClass: "bg-red-50 text-red-700 border border-red-200",
    severity: "danger",
    plainEnglish: "This vendor is blocked in your internal records. Do not pay.",
  },
  no_match: {
    label: "No internal record",
    badgeClass: "bg-slate-50 text-slate-600 border border-slate-200",
    severity: "neutral",
    plainEnglish: "Not in your approved-vendor file yet — treat as a new / unfamiliar payee.",
  },
};

/** How the check was triggered — never expose internal seed/demo wording. */
export const SOURCE_LABEL: Record<string, string> = {
  cli: "CLI",
  web: "Dashboard",
  copilot: "Copilot",
  eval: "Eval",
  seed: "Tavily Search",
};

export const FRAUD_PATTERN_LABEL: Record<string, string> = {
  vendor_impersonation: "Vendor impersonation",
  invoice_fraud: "Invoice fraud",
  shell_company: "Shell company",
  none: "None",
};

export const CATEGORY_LABEL: Record<string, string> = {
  legitimacy: "Legitimacy",
  adverse_media: "Adverse media",
  entity_consistency: "Entity consistency",
  internal_records: "Internal vendor master",
};

export const CATEGORY_HINT: Record<string, string> = {
  legitimacy: "Is this a real, identifiable business?",
  adverse_media: "Any fraud, enforcement, or reputation risk?",
  entity_consistency: "Do name, address, and identifiers line up?",
  internal_records: "Does this match your approved-vendor file?",
};
