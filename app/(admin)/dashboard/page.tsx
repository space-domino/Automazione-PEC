import { StatTile } from "@/components/ui/stat-tile";
import { aiCostSummary } from "@/services/ai-gateway";
import { getOverview } from "@/services/catalog/overview";
import { getTimeseries } from "@/services/catalog/timeseries";
import { OverviewCharts } from "./overview-charts";

export const dynamic = "force-dynamic";

const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export default async function DashboardPage() {
  const [o, ts, ai] = await Promise.all([getOverview(), getTimeseries(14), aiCostSummary()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Overview</h1>
        <p className="text-sm text-neutral-500">Andamento degli ultimi 14 giorni.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Aziende importate" value={o.companiesImported} />
        <StatTile label="Domini analizzati" value={o.domainsAnalyzed} />
        <StatTile label="Domini disponibili" value={o.domainsAvailable} />
        <StatTile label="Domini acquistati" value={o.domainsPurchased} />
        <StatTile label="Offerte pubblicate" value={o.offersPublished} />
        <StatTile label="PEC inviate" value={o.pecSent} />
        <StatTile label="Visite landing" value={o.landingViews} />
        <StatTile label="Ordini" value={o.orders} hint={`${o.ordersPaid} pagati`} />
        <StatTile label="Fatturato" value={eur(o.revenueEur)} />
        <StatTile
          label="Conversion"
          value={`${(o.conversionRate * 100).toFixed(1)}%`}
          hint="ordini pagati / PEC"
        />
        <StatTile
          label="AI 24h"
          value={`$${ai.last24hCostUsd.toFixed(3)}`}
          hint={`budget $${ai.budgetUsd.toFixed(0)}`}
        />
        <StatTile
          label="AI totale"
          value={`$${ai.totalCostUsd.toFixed(3)}`}
          hint={`${ai.totalCalls} chiamate · ${ai.failedCalls} ko`}
        />
      </div>

      <OverviewCharts data={ts} />
    </div>
  );
}
