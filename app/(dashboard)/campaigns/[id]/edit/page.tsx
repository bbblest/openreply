import CampaignBuilder from "@/components/campaign-builder";
import { connection } from "next/server";
import {
  isFollowRequiredByDeployment,
  SAFE_FOLLOW_MESSAGES,
} from "@/lib/instagram/follow-policy";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  return (
    <CampaignBuilder
      mode="edit"
      campaignId={id}
      followPolicy={{
        required: isFollowRequiredByDeployment(),
        messages: SAFE_FOLLOW_MESSAGES,
      }}
    />
  );
}
