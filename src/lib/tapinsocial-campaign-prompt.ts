import {
  youtubePolicyPromptLines,
  type SocialDiscoveryYouTubePolicy,
} from "@/lib/social-discovery-youtube-policy";

export function buildTapInCampaignPrompt(input: {
  campaignType: "comment" | "thread";
  openingCommentPrompt: string;
  delayedReplyPrompt: string;
  youtubePolicy: SocialDiscoveryYouTubePolicy;
}) {
  return [
    "TapIn campaign instructions:",
    "Opening comment instructions:",
    input.openingCommentPrompt,
    input.campaignType === "thread"
      ? "Delayed reply instructions:"
      : "Campaign type: Comment only.",
    input.campaignType === "thread" ? input.delayedReplyPrompt : "",
    ...youtubePolicyPromptLines(input.youtubePolicy),
    "Runtime context:",
    "- TapIn supplies the matched YouTube video title and description to the generator automatically.",
    "- Opening comment instructions apply only to commentDraft.",
    "- Delayed reply instructions apply only to replyDraft.",
  ].join("\n");
}
