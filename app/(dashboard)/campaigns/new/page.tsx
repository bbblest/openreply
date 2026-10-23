import CampaignBuilder from "@/components/campaign-builder";
import { connection } from "next/server";
import {
  isFollowRequiredByDeployment,
  isEmailRequiredByDeployment,
  SAFE_FOLLOW_MESSAGES,
} from "@/lib/instagram/follow-policy";

export default async function NewCampaignPage() {
  await connection();
  return (
    <CampaignBuilder
      mode="new"
      emailPolicy={{ required: isEmailRequiredByDeployment() }}
      followPolicy={{
        required: isFollowRequiredByDeployment(),
        messages: {
          ...SAFE_FOLLOW_MESSAGES,
          prompt: isEmailRequiredByDeployment() ? SAFE_FOLLOW_MESSAGES.emailPrompt : SAFE_FOLLOW_MESSAGES.prompt,
        },
      }}
    />
  );
}
