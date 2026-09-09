"use client";

import type { TimeseriesPoint } from "@/services/catalog/timeseries";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function OverviewCharts({ data }: { data: TimeseriesPoint[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ChartCard title="Aziende importate">
        <MiniLine data={data} dataKey="companies" />
      </ChartCard>
      <ChartCard title="Domini generati">
        <MiniLine data={data} dataKey="domains" />
      </ChartCard>
      <ChartCard title="PEC inviate">
        <MiniLine data={data} dataKey="pecSent" />
      </ChartCard>
      <ChartCard title="Fatturato (€)">
        <MiniLine data={data} dataKey="revenue" />
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 text-xs font-medium text-neutral-500">{title}</div>
      <div className="h-40">{children}</div>
    </div>
  );
}

function MiniLine({ data, dataKey }: { data: TimeseriesPoint[]; dataKey: keyof TimeseriesPoint }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickFormatter={(d: string) => (typeof d === "string" ? d.slice(5) : d)}
        />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={40} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey={dataKey} stroke="#4b45c6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
