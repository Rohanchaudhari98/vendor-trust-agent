import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import type { CheckDetail } from "../lib/types";
import { Button } from "./ui/Button";
import { Field, TextInput } from "./ui/Field";
import { Spinner } from "./ui/Spinner";
import { ReportCard } from "./ReportCard";
import {
  applyProgressEvent,
  CheckProgress,
  initialProgressSteps,
  markAllProgressDone,
  type ProgressStep,
} from "./CheckProgress";

/**
 * Primary dashboard form for a live vendor check (Tavily + LLM +
 * internal vendor master). Shows each research stage as it completes.
 */
export function NewCheckForm({
  onDone,
  onDecisionRecorded,
}: {
  onDone?: (check: CheckDetail) => void;
  /** After confirm pay/hold — parent can close the drawer / navigate. */
  onDecisionRecorded?: (check: CheckDetail) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [vendorName, setVendorName] = useState("");
  const [address, setAddress] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [progress, setProgress] = useState<ProgressStep[]>(initialProgressSteps);
  const [resultCheck, setResultCheck] = useState<CheckDetail | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      setProgress(initialProgressSteps());
      return api.streamCreateCheck(
        {
          vendor_name: vendorName.trim(),
          address: address.trim() || null,
          invoice_amount: invoiceAmount ? Number(invoiceAmount) : null,
        },
        (event) => {
          if (event.type === "step") {
            setProgress((prev) => applyProgressEvent(prev, event));
          }
        }
      );
    },
    onSuccess: (check) => {
      setProgress((prev) => markAllProgressDone(prev));
      setResultCheck(check);
      queryClient.invalidateQueries({ queryKey: ["checks"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      queryClient.invalidateQueries({ queryKey: ["observability"] });
      onDone?.(check);
    },
  });

  if (resultCheck) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          Research complete. Review below, then confirm payment or hold — or open the{" "}
          {resultCheck.id != null ? (
            <button
              type="button"
              className="font-semibold underline underline-offset-2 hover:no-underline"
              onClick={() => navigate(`/checks/${resultCheck.id}`)}
            >
              full report
            </button>
          ) : (
            "full report"
          )}{" "}
          for the complete evidence trail.
        </div>
        <ReportCard
          check={resultCheck}
          onDecisionRecorded={(updated) => {
            setResultCheck(updated);
            queryClient.setQueryData(["checks", updated.id], updated);
            onDecisionRecorded?.(updated);
          }}
        />
        {resultCheck.id != null ? (
          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-50"
            onClick={() => navigate(`/checks/${resultCheck.id}`)}
          >
            Open full report →
          </button>
        ) : null}
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            setResultCheck(null);
            mutation.reset();
          }}
        >
          Check another invoice
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!vendorName.trim()) return;
        mutation.mutate();
      }}
    >
      <Field label="Vendor name" hint="Exactly as it appears on the invoice">
        <TextInput
          required
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="Procter & Gamble"
          disabled={mutation.isPending}
        />
      </Field>
      <Field label="Remittance address" hint="Optional — improves match against your approved list">
        <TextInput
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="1 Procter and Gamble Plaza, Cincinnati, OH"
          disabled={mutation.isPending}
        />
      </Field>
      <Field label="Invoice amount" hint="Optional — shown on the report and Invoice desk totals">
        <TextInput
          type="number"
          min="0"
          step="0.01"
          value={invoiceAmount}
          onChange={(e) => setInvoiceAmount(e.target.value)}
          placeholder="48500.00"
          disabled={mutation.isPending}
        />
      </Field>

      {mutation.isError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {mutation.error instanceof Error ? mutation.error.message : "Check failed. Please try again."}
        </p>
      )}

      {mutation.isPending && <CheckProgress steps={progress} />}

      <Button type="submit" className="w-full" disabled={mutation.isPending || !vendorName.trim()}>
        {mutation.isPending ? (
          <>
            <Spinner className="h-4 w-4 text-white" /> Researching payee…
          </>
        ) : (
          <>
            <Search className="h-4 w-4" /> Check this payee
          </>
        )}
      </Button>
    </form>
  );
}
