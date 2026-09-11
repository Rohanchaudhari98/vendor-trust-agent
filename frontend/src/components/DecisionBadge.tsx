import { getPaymentDecision } from "../lib/tiers";
import type { InternalMatchStatus, RiskTier } from "../lib/types";
import { Badge } from "./ui/Badge";

/** Dominant action chip — Pay / Hold / Review. No tooltip required. */
export function DecisionBadge({
  riskTier,
  internalMatchStatus,
  showReason = false,
}: {
  riskTier: RiskTier;
  internalMatchStatus: InternalMatchStatus;
  showReason?: boolean;
}) {
  const meta = getPaymentDecision({
    risk_tier: riskTier,
    internal_match_status: internalMatchStatus,
  });

  return (
    <div className="min-w-0">
      <Badge className={`${meta.badgeClass} text-xs`}>{meta.label}</Badge>
      {showReason ? (
        <p className="mt-1 max-w-xs text-[11px] leading-snug text-slate-600">{meta.reason}</p>
      ) : null}
    </div>
  );
}
