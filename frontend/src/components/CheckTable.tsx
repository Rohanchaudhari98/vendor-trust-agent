import { useNavigate } from "react-router-dom";
import type { CheckSummary } from "../lib/types";
import { DecisionBadge } from "./DecisionBadge";
import { getPaymentDecision } from "../lib/tiers";
import { formatCurrency, formatRelativeTime } from "../lib/format";
import { EmptyState } from "./ui/EmptyState";
import { Inbox } from "lucide-react";

export function CheckTable({ checks }: { checks: CheckSummary[]; dense?: boolean }) {
  const navigate = useNavigate();

  if (checks.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No invoices checked yet"
        description="Use “Check this invoice” above — each result lands here with a clear Pay, Hold, or Review."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="table-head">
            <th>What to do</th>
            <th>Vendor on the invoice</th>
            <th>Amount</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => {
            const decision = getPaymentDecision({
              risk_tier: check.risk_tier,
              internal_match_status: check.internal_match_status,
            });
            return (
              <tr
                key={check.id}
                onClick={() => check.id !== null && navigate(`/checks/${check.id}`)}
                className={`table-row cursor-pointer border-l-4 ${decision.rowAccent}`}
              >
                <td className="align-top">
                  <DecisionBadge
                    riskTier={check.risk_tier}
                    internalMatchStatus={check.internal_match_status}
                    showReason
                  />
                </td>
                <td>
                  <p className="font-semibold text-slate-900">{check.vendor_name}</p>
                  {check.address ? (
                    <p className="mt-0.5 text-xs text-slate-500">{check.address}</p>
                  ) : null}
                </td>
                <td className="font-medium text-slate-800">
                  {formatCurrency(check.invoice_amount)}
                </td>
                <td className="text-xs text-slate-500">{formatRelativeTime(check.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
