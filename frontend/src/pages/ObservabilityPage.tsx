import { useQuery } from "@tanstack/react-query";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Activity, Clock, DollarSign, Hash, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { KpiCard } from "../components/KpiCard";
import { LoadingBlock } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SOURCE_LABEL } from "../lib/tiers";
import { formatCurrencyPrecise, formatDate, formatLatency, formatNumber } from "../lib/format";

function shortChartTime(iso: string): string {
  const date = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ObservabilityPage() {
  const observability = useQuery({ queryKey: ["observability"], queryFn: api.getObservability });

  if (observability.isLoading) return <div className="page-shell"><LoadingBlock /></div>;
  const data = observability.data;
  if (!data) return null;

  // Chronological left → right (oldest run first). X = when the report ran.
  const chartData = [...data.rows]
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((row, i) => ({
      order: i + 1,
      label: shortChartTime(row.created_at),
      cost: Number(row.cost_usd.toFixed(4)),
      vendor: row.vendor_name,
      when: formatDate(row.created_at),
    }));

  const tickInterval = chartData.length <= 8 ? 0 : Math.ceil(chartData.length / 6) - 1;

  return (
    <div className="page-shell">
      <PageHeader
        title="Costs & traces"
        subtitle="What each vendor report cost (Tavily + AI) and how long it took. Open Langfuse for the project trace list, or View for one run (opens Langfuse — not this app)."
        actions={
          data.langfuse_url ? (
            <a
              href={data.langfuse_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50"
            >
              Open Langfuse traces
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null
        }
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
          <div>
            <CardTitle>Spend per report</CardTitle>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Each point is one vendor report.{" "}
              <span className="font-semibold text-slate-600">Left → right</span> = time order
              (oldest run to newest).{" "}
              <span className="font-semibold text-slate-600">Up</span> = higher Tavily + AI cost.
              Hover a point for the vendor name.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {chartData.length < 2 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Run a few more checks to see a spend trend here.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  interval={tickInterval}
                  angle={chartData.length > 6 ? -25 : 0}
                  textAnchor={chartData.length > 6 ? "end" : "middle"}
                  height={chartData.length > 6 ? 50 : 30}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: "When the report ran (oldest → newest)",
                    position: "insideBottom",
                    offset: chartData.length > 6 ? -18 : -12,
                    style: { fontSize: 11, fill: "#64748b", fontWeight: 600 },
                  }}
                />
                <YAxis
                  width={56}
                  tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: "Cost (USD)",
                    angle: -90,
                    position: "insideLeft",
                    offset: 10,
                    style: { fontSize: 11, fill: "#64748b", fontWeight: 600, textAnchor: "middle" },
                  }}
                />
                <Tooltip
                  formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
                  labelFormatter={(_, payload) => {
                    const point = payload?.[0]?.payload;
                    if (!point) return "";
                    return `${point.vendor} · ${point.when}`;
                  }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  name="Cost"
                  stroke="#0e7490"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#0e7490" }}
                />
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
                        <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300">
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
