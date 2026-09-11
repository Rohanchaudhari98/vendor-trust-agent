import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import type { CheckDetail } from "../lib/types";
import { Button } from "./ui/Button";
import { Field, TextInput } from "./ui/Field";
import { Spinner } from "./ui/Spinner";
import { ReportCard } from "./ReportCard";

/**
 * Primary dashboard form for a live vendor check (Tavily + LLM +
 * internal vendor master). Honest about the 15–60s wait.
 */
export function NewCheckForm({ onDone }: { onDone?: (check: CheckDetail) => void }) {
  const queryClient = useQueryClient();
  const [vendorName, setVendorName] = useState("");
  const [address, setAddress] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.createCheck({
        vendor_name: vendorName.trim(),
        address: address.trim() || null,
        invoice_amount: invoiceAmount ? Number(invoiceAmount) : null,
      }),
    onSuccess: (check) => {
      queryClient.invalidateQueries({ queryKey: ["checks"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      queryClient.invalidateQueries({ queryKey: ["observability"] });
      onDone?.(check);
    },
  });

  if (mutation.isSuccess) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          Done — see Pay / Hold / Review below, with sources from the open web and your vendor list.
        </div>
        <ReportCard check={mutation.data} />
        <Button variant="secondary" className="w-full" onClick={() => mutation.reset()}>
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
          placeholder="e.g. Acme Textiles LLC"
          disabled={mutation.isPending}
        />
      </Field>
      <Field label="Address" hint="Optional — improves internal-record matching">
        <TextInput
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. Dallas, TX"
          disabled={mutation.isPending}
        />
      </Field>
      <Field label="Invoice amount" hint="Optional — shown on the report and KPI totals">
        <TextInput
          type="number"
          min="0"
          step="0.01"
          value={invoiceAmount}
          onChange={(e) => setInvoiceAmount(e.target.value)}
          placeholder="e.g. 45231.00"
          disabled={mutation.isPending}
        />
      </Field>

      {mutation.isError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {mutation.error instanceof Error ? mutation.error.message : "Check failed. Please try again."}
        </p>
      )}

      {mutation.isPending && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          Looking up this payee on the open web (<span className="font-bold">Tavily</span>) and
          comparing to your approved-vendor list…
        </div>
      )}

      <Button type="submit" className="w-full" disabled={mutation.isPending || !vendorName.trim()}>
        {mutation.isPending ? (
          <>
            <Spinner className="h-4 w-4 text-white" /> Checking — up to about a minute…
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
