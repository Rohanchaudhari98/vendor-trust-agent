import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Activity, Clock, DollarSign, Hash, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { KpiCard } from "../components/KpiCard";
import { LoadingBlock } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SOURCE_LABEL } from "../lib/tiers";
import { formatCurrencyPrecise, formatDate, formatLatency, formatNumber } from "../lib/format";

export function ObservabilityPage() {
  const observability = useQuery({ queryKey: ["observability"], queryFn: api.getObservability });

  if (observability.isLoading) return <div className="page-shell"><LoadingBlock /></div>;
  const data = observability.data;
  if (!data) return null;

  const chartData = [...data.rows]
    .reverse()
    .map((row, i) => ({ index: i + 1, cost: Number(row.cost_usd.toFixed(4)), vendor: row.vendor_name }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Costs & traces"
        subtitle="What each vendor report cost (Tavily + AI) and how long it took. For engineers: open View trace for Langfuse spans."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total reports" value={formatNumber(data.aggregate.total_checks)} icon={Hash} tone="neutral" />
        <KpiCard
          label="Total Spend"
          value={formatCurrencyPrecise(data.aggregate.total_cost_usd, 3)}
          icon={DollarSign}
          tone="danger"
        />
        <KpiCard
          label="Avg cost / report"
          value={formatCurrencyPrecise(data.aggregate.avg_cost_usd)}
          icon={DollarSign}
          tone="info"
        />
        <KpiCard label="Avg Latency" value={formatLatency(data.aggregate.avg_latency_ms)} icon={Clock} tone="warn" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spend per report</CardTitle>
        </CardHeader>
        <CardBody>
          {chartData.length < 2 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Run a few more checks to see a spend trend here.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="index" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis
                  width={52}
                  tickFormatter={(v) => `$${v}`}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.vendor ?? ""}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                  }}
                />
                <Line type="monotone" dataKey="cost" stroke="#0e7490" strokeWidth={2} dot={{ r: 3, fill: "#0e7490" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-check detail</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {data.rows.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No checks yet"
              description="Cost and latency data will appear here once checks run."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="table-head">
                    <th>Vendor</th>
                    <th>Channel</th>
                    <th>Cost</th>
                    <th>Tavily credits</th>
                    <th>Tokens (in/out)</th>
                    <th>Latency</th>
                    <th>When</th>
                    <th>Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id} className="table-row">
                      <td className="font-semibold text-slate-900">{row.vendor_name}</td>
                      <td>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300">
                          {SOURCE_LABEL[row.source] ?? row.source}
                        </span>
                      </td>
                      <td className="font-medium text-slate-800">{formatCurrencyPrecise(row.cost_usd)}</td>
                      <td className="text-xs text-slate-600">
                        {row.search_credits} search / {row.extract_credits} extract
                      </td>
                      <td className="text-xs text-slate-600">
                        {formatNumber(row.llm_input_tokens)} / {formatNumber(row.llm_output_tokens)}
                      </td>
                      <td className="font-medium text-slate-800">{formatLatency(row.latency_ms)}</td>
                      <td className="text-xs text-slate-500">{formatDate(row.created_at)}</td>
                      <td>
                        {row.langfuse_trace_url ? (
                          <a
                            href={row.langfuse_trace_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
