import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, PlusCircle } from "lucide-react";
import { api } from "../lib/api";
import type { VendorMasterRecord } from "../lib/types";
import { Card, CardBody } from "../components/ui/Card";
import { LoadingBlock } from "../components/ui/Spinner";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { Field, TextInput } from "../components/ui/Field";
import { Spinner } from "../components/ui/Spinner";

const VENDOR_STATUS_META: Record<string, string> = {
  approved: "bg-green-50 text-green-700 border border-green-200",
  watchlist: "bg-amber-50 text-amber-700 border border-amber-200",
  blocked: "bg-red-50 text-red-700 border border-red-200",
};

const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  watchlist: "Watchlist",
  blocked: "Blocked",
};

type VendorFormState = {
  vendor_name: string;
  known_address: string;
  status: "approved" | "watchlist" | "blocked";
  notes: string;
  aliasesText: string;
};

const EMPTY_FORM: VendorFormState = {
  vendor_name: "",
  known_address: "",
  status: "approved",
  notes: "",
  aliasesText: "",
};

function parseAliases(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function formFromRecord(record: VendorMasterRecord): VendorFormState {
  return {
    vendor_name: record.vendor_name,
    known_address: record.known_address ?? "",
    status: record.status,
    notes: record.notes ?? "",
    aliasesText: record.aliases.join(", "),
  };
}

/** Who you’ve already approved — live source for Home checks and Ask AI. */
export function VendorsPage() {
  const queryClient = useQueryClient();
  const records = useQuery({ queryKey: ["vendor-master"], queryFn: api.listVendorMaster });
  const [drawerMode, setDrawerMode] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<VendorMasterRecord | null>(null);
  const [form, setForm] = useState<VendorFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDrawerMode("add");
  }

  function openEdit(record: VendorMasterRecord) {
    setEditing(record);
    setForm(formFromRecord(record));
    setFormError(null);
    setDrawerMode("edit");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setEditing(null);
    setFormError(null);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        vendor_name: form.vendor_name.trim(),
        known_address: form.known_address.trim() || null,
        status: form.status,
        notes: form.notes.trim() || null,
        aliases: parseAliases(form.aliasesText),
      };
      if (drawerMode === "edit" && editing?.id != null) {
        return api.updateVendorMaster(editing.id, payload);
      }
      return api.createVendorMaster(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-master"] });
      closeDrawer();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  return (
    <div className="page-shell">
      <PageHeader
        title="Approved vendors"
        subtitle="Your internal vendor list. Every invoice check on Home compares the payee name and remittance address against this file — add or edit here and the next check uses the update immediately."
        actions={
          <Button onClick={openAdd} icon={<PlusCircle className="h-3.5 w-3.5" />}>
            Add vendor
          </Button>
        }
      />

      {records.isLoading ? (
        <LoadingBlock />
      ) : !records.data || records.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No vendors on file yet"
          description="Add approved vendors so new invoice payees can be cross-checked against what you already trust."
          action={
            <Button onClick={openAdd} icon={<PlusCircle className="h-3.5 w-3.5" />}>
              Add vendor
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="table-head">
                    <th>Vendor</th>
                    <th>Address on file</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th className="w-24"> </th>
                  </tr>
                </thead>
                <tbody>
                  {records.data.map((record) => (
                    <tr key={record.id} className="table-row">
                      <td>
                        <div className="font-semibold text-slate-900">{record.vendor_name}</div>
                        {record.aliases.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {record.aliases.map((alias) => (
                              <span
                                key={alias}
                                className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                              >
                                {alias}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-slate-600">{record.known_address ?? "—"}</td>
                      <td>
                        <Badge
                          className={
                            VENDOR_STATUS_META[record.status] ??
                            "bg-slate-50 text-slate-600 border border-slate-200"
                          }
                        >
                          {STATUS_LABEL[record.status] ?? record.status}
                        </Badge>
                      </td>
                      <td className="text-xs text-slate-500">{record.notes ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => openEdit(record)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <Drawer
        open={drawerMode != null}
        onClose={closeDrawer}
        title={drawerMode === "edit" ? "Edit vendor" : "Add approved vendor"}
        description={
          drawerMode === "edit"
            ? "Update the address or status on file. The next invoice check for this payee will use these details."
            : "New vendors appear in Home checks and Ask AI as soon as you save — no restart needed."
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.vendor_name.trim()) {
              setFormError("Vendor name is required.");
              return;
            }
            setFormError(null);
            saveMutation.mutate();
          }}
        >
          <Field label="Vendor name" hint="Legal or invoice name">
            <TextInput
              required
              value={form.vendor_name}
              onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
              placeholder="Procter & Gamble"
              disabled={saveMutation.isPending}
            />
          </Field>
          <Field
            label="Address on file"
            hint="Remittance / HQ address used for mismatch detection"
          >
            <TextInput
              value={form.known_address}
              onChange={(e) => setForm((f) => ({ ...f, known_address: e.target.value }))}
              placeholder="1 Procter and Gamble Plaza, Cincinnati, OH"
              disabled={saveMutation.isPending}
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  status: e.target.value as VendorFormState["status"],
                }))
              }
              disabled={saveMutation.isPending}
              className="block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              <option value="approved">Approved</option>
              <option value="watchlist">Watchlist</option>
              <option value="blocked">Blocked</option>
            </select>
          </Field>
          <Field label="Aliases" hint="Optional — comma-separated (e.g. P&G, PG)">
            <TextInput
              value={form.aliasesText}
              onChange={(e) => setForm((f) => ({ ...f, aliasesText: e.target.value }))}
              placeholder="P&G, PG"
              disabled={saveMutation.isPending}
            />
          </Field>
          <Field label="Notes" hint="Optional — visible to clerks on match">
            <TextInput
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Preferred remittance contact, contract notes…"
              disabled={saveMutation.isPending}
            />
          </Field>

          {formError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Spinner className="h-3.5 w-3.5 text-white" /> Saving…
                </>
              ) : drawerMode === "edit" ? (
                "Save changes"
              ) : (
                "Add to approved list"
              )}
            </Button>
            <Button type="button" variant="secondary" onClick={closeDrawer} disabled={saveMutation.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
