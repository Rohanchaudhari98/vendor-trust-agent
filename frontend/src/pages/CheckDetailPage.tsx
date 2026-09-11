import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileWarning } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody } from "../components/ui/Card";
import { LoadingBlock } from "../components/ui/Spinner";
import { ReportCard } from "../components/ReportCard";
import { EmptyState } from "../components/ui/EmptyState";
import { formatCurrencyPrecise, formatLatency } from "../lib/format";

export function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const checkId = Number(id);

  const check = useQuery({
    queryKey: ["checks", checkId],
    queryFn: () => api.getCheck(checkId),
    enabled: Number.isFinite(checkId),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-5">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
      </button>

      {check.isLoading ? (
        <LoadingBlock label="Loading report…" />
      ) : check.isError || !check.data ? (
        <EmptyState
          icon={FileWarning}
          title="Report not found"
          description="This vendor report may have been removed."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetaTile label="Report" value={`#${check.data.id}`} tone="neutral" />
            <MetaTile label="Cost" value={formatCurrencyPrecise(check.data.cost_usd)} tone="success" />
            <MetaTile label="Took" value={formatLatency(check.data.latency_ms)} tone="warn" />
          </div>

          <Card>
            <CardBody className="bg-white p-5">
              <ReportCard check={check.data} />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function MetaTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "info" | "success" | "warn";
}) {
  const bar =
    tone === "info"
      ? "border-l-teal-500"
      : tone === "success"
        ? "border-l-green-500"
        : tone === "warn"
          ? "border-l-amber-500"
          : "border-l-blue-500";
  return (
    <div className={`rounded-xl border border-slate-300 border-l-4 bg-white px-3.5 py-3 shadow-sm ${bar}`}>
      <p className="section-label">{label}</p>
      <p className="mt-1 text-sm font-bold capitalize text-slate-800">{value}</p>
    </div>
  );
}
