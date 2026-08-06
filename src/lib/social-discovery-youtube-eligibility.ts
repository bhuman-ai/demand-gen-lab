export const MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS = 100;

export function meetsYouTubeSubscriberMinimum(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) && count >= MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS;
}

export function youtubeSubscriberMinimumMessage() {
  return `Channel needs at least ${MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS.toLocaleString()} subscribers before drafting.`;
}
