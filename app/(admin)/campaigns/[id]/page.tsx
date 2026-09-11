import { getCampaign } from "@/services/campaigns";
import { notFound } from "next/navigation";
import { CampaignDetail } from "./campaign-detail";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  return <CampaignDetail initial={campaign} />;
}
