import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { ReportCard } from "./ReportCard";
import { Spinner } from "./ui/Spinner";

/** Compact ReportCard for a check the copilot referenced. */
export function InlineCheckCard({ checkId }: { checkId: number }) {
  const navigate = useNavigate();
  const check = useQuery({ queryKey: ["checks", checkId], queryFn: () => api.getCheck(checkId) });

  if (check.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
        <Spinner /> Loading check #{checkId}…
      </div>
    );
  }
  if (!check.data) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <ReportCard check={check.data} compact />
      <button
        onClick={() => navigate(`/checks/${checkId}`)}
        className="mt-3 text-xs font-semibold text-blue-600 hover:text-blue-700"
      >
        View full report →
      </button>
    </div>
  );
}
