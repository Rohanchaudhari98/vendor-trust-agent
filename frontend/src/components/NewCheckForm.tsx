import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileUp, Search } from "lucide-react";
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
 * Upload a PDF to extract the same three fields, then run the identical pipeline.
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [vendorName, setVendorName] = useState("");
  const [address, setAddress] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<ProgressStep[]>(initialProgressSteps);
  const [resultCheck, setResultCheck] = useState<CheckDetail | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload?: {
      vendor_name: string;
      address: string | null;
      invoice_amount: number | null;
    }) => {
      setProgress(initialProgressSteps());
      const body = payload ?? {
        vendor_name: vendorName.trim(),
        address: address.trim() || null,
        invoice_amount: invoiceAmount ? Number(invoiceAmount) : null,
      };
      return api.streamCreateCheck(body, (event) => {
        if (event.type === "step") {
          setProgress((prev) => applyProgressEvent(prev, event));
        }
      });
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

  const applyExtractedAndRun = async (file: File) => {
    setExtractError(null);
    setExtracting(true);
    try {
      const extracted = await api.extractInvoice(file);
      const name = (extracted.vendor_name || "").trim();
      if (!name) {
        throw new Error("Could not find a vendor name in this PDF.");
      }
      const addr = (extracted.address || "").trim();
      const amount =
        extracted.invoice_amount != null && !Number.isNaN(extracted.invoice_amount)
          ? String(extracted.invoice_amount)
          : "";
      setVendorName(name);
      setAddress(addr);
      setInvoiceAmount(amount);
      setSourceFile(extracted.filename || file.name);
      await mutation.mutateAsync({
        vendor_name: name,
        address: addr || null,
        invoice_amount: amount ? Number(amount) : null,
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Could not read this PDF.");
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
            setSourceFile(null);
            mutation.reset();
          }}
        >
          Check another invoice
        </Button>
      </div>
    );
  }

  const busy = mutation.isPending || extracting;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!vendorName.trim() || busy) return;
        mutation.mutate(undefined);
      }}
    >
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void applyExtractedAndRun(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-blue-400 hover:bg-blue-50/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {extracting ? (
            <>
              <Spinner className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-medium text-slate-700">Reading invoice…</span>
            </>
          ) : (
            <>
              <FileUp className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-semibold text-slate-800">Upload invoice PDF</span>
              <span className="text-xs text-slate-500">
                Extracts vendor, remittance address, and amount — then runs the same check
              </span>
            </>
          )}
        </button>
        {sourceFile && !extracting && (
          <p className="text-xs text-slate-500">
            From <span className="font-medium text-slate-700">{sourceFile}</span> — edit fields below if needed, or wait for research.
          </p>
        )}
        {extractError && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {extractError}
          </p>
        )}
        <div className="relative py-1 text-center text-[11px] uppercase tracking-wide text-slate-400">
          <span className="bg-white px-2 relative z-10">or enter manually</span>
          <span className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
        </div>
      </div>

      <Field label="Vendor name" hint="Exactly as it appears on the invoice">
        <TextInput
          required
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="Procter & Gamble"
          disabled={busy}
        />
      </Field>
      <Field label="Remittance address" hint="Optional — improves match against your approved list">
        <TextInput
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="1 Procter and Gamble Plaza, Cincinnati, OH"
          disabled={busy}
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
          disabled={busy}
        />
      </Field>

      {mutation.isError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {mutation.error instanceof Error ? mutation.error.message : "Check failed. Please try again."}
        </p>
      )}

      {mutation.isPending && <CheckProgress steps={progress} />}

      <Button type="submit" className="w-full" disabled={busy || !vendorName.trim()}>
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
