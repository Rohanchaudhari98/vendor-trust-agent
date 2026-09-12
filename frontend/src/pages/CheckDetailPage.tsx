import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileWarning, MessageSquare } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody } from "../components/ui/Card";
import { LoadingBlock } from "../components/ui/Spinner";
import { ReportCard } from "../components/ReportCard";
import { EmptyState } from "../components/ui/EmptyState";
import { useCopilot } from "../components/copilot/CopilotContext";

export function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const checkId = Number(id);
  const { openCopilot, setContextCheckId } = useCopilot();

  const check = useQuery({
    queryKey: ["checks", checkId],
    queryFn: () => api.getCheck(checkId),
    enabled: Number.isFinite(checkId),
  });

  // Quietly attach this report as Ask AI context while the page is open;
  // clear on leave so Home / Vendors don't inherit a stale check id.
  useEffect(() => {
    if (!Number.isFinite(checkId)) return;
    setContextCheckId(checkId);
    return () => setContextCheckId(null);
  }, [checkId, setContextCheckId]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Invoice desk
        </button>
        {check.data ? (
          <button
            type="button"
            onClick={() =>
              openCopilot({
                contextCheckId: checkId,
                draft: `Why was ${check.data.vendor_name} flagged — walk me through the evidence?`,
              })
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 hover:bg-teal-100"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Ask about this report
          </button>
        ) : null}
      </div>

      {check.isLoading ? (
        <LoadingBlock label="Loading report…" />
      ) : check.isError || !check.data ? (
        <EmptyState
          icon={FileWarning}
          title="Report not found"
          description="This vendor report may have been removed."
        />
      ) : (
        <Card>
          <CardBody className="bg-white p-5 sm:p-6">
            <ReportCard
              check={check.data}
              onDecisionRecorded={() => {
                // Brief success state on the card, then back to Home results.
                window.setTimeout(() => navigate("/"), 1400);
              }}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
