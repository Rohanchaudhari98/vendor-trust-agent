import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody } from "../components/ui/Card";
import { LoadingBlock } from "../components/ui/Spinner";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";

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

/** Who you’ve already approved — not a duplicate of Home reports. */
export function VendorsPage() {
  const records = useQuery({ queryKey: ["vendor-master"], queryFn: api.listVendorMaster });

  return (
    <div className="page-shell">
      <PageHeader
        title="Approved vendors"
        subtitle="Your internal vendor list. When you check a payee on Home, we compare against this file for name/address mismatches."
      />

      {records.isLoading ? (
        <LoadingBlock />
      ) : !records.data || records.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No vendors on file yet"
          description="Add approved vendors here so new invoice payees can be cross-checked against what you already trust."
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
