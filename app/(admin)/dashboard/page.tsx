import { Metric, PageHeader } from "@/components/ui/page";
import { aiCostSummary } from "@/services/ai-gateway";
import { getOverview } from "@/services/catalog/overview";
import { getTimeseries } from "@/services/catalog/timeseries";
import { OverviewCharts } from "./overview-charts";

export const dynamic = "force-dynamic";

const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export default async function DashboardPage() {
  const [o, ts, ai] = await Promise.all([getOverview(), getTimeseries(14), aiCostSummary()]);

  const funnel: { label: string; value: number }[] = [
    { label: "Aziende", value: o.companiesImported },
    { label: "Domini analizzati", value: o.domainsAnalyzed },
    { label: "Disponibili", value: o.domainsAvailable },
    { label: "Acquistati", value: o.domainsPurchased },
    { label: "Offerte pubbl.", value: o.offersPublished },
    { label: "PEC inviate", value: o.pecSent },
    { label: "Ordini pagati", value: o.ordersPaid },
  ];

  return (
    <div>
      <PageHeader title="Panoramica" sub="Stato della pipeline e ultimi 14 giorni" />

      <div className="panel mb-5 flex flex-wrap items-stretch">
        {funnel.map((s, i) => (
          <div
            key={s.label}
            className="min-w-[7.5rem] flex-1 border-[var(--border)] px-4 py-3"
            style={{ borderLeftWidth: i === 0 ? 0 : 1 }}
          >
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-xs text-[var(--ink-soft)]">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Fatturato" value={eur(o.revenueEur)} accent />
        <Metric
          label="Conversione"
          value={`${(o.conversionRate * 100).toFixed(1)}%`}
          hint="ordini pagati / PEC"
        />
        <Metric label="Visite landing" value={o.landingViews} />
        <Metric
          label="AI 24h"
          value={`$${ai.last24hCostUsd.toFixed(2)}`}
          hint={`budget $${ai.budgetUsd.toFixed(0)}`}
        />
        <Metric
          label="AI totale"
          value={`$${ai.totalCostUsd.toFixed(2)}`}
          hint={`${ai.totalCalls} chiamate · ${ai.failedCalls} ko`}
        />
      </div>

      <OverviewCharts data={ts} />
    </div>
  );
}
