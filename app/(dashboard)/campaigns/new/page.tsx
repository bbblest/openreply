import CampaignBuilder from "@/components/campaign-builder";
import { connection } from "next/server";
import {
  isFollowRequiredByDeployment,
  SAFE_FOLLOW_MESSAGES,
} from "@/lib/instagram/follow-policy";

export default async function NewCampaignPage() {
  await connection();
  return (
    <CampaignBuilder
      mode="new"
      followPolicy={{
        required: isFollowRequiredByDeployment(),
        messages: SAFE_FOLLOW_MESSAGES,
      }}
    />
  );
}
