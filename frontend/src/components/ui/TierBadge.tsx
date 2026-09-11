import type { RiskTier } from "../../lib/types";
import { TIER_META } from "../../lib/tiers";
import { Badge } from "./Badge";
import { HelpTip } from "./HelpTip";

export function TierBadge({ tier }: { tier: RiskTier }) {
  const meta = TIER_META[tier];
  return (
    <HelpTip label={meta.plainEnglish} wide>
      <Badge className={`${meta.badgeClass} cursor-help`} dotClassName={meta.dotClass}>
        {meta.label}
      </Badge>
    </HelpTip>
  );
}
