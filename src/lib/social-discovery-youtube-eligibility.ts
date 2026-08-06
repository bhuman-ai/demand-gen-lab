export const MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS = 100;

export function meetsYouTubeSubscriberMinimum(
  value: unknown,
  minimum = MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS
) {
  const count = Number(value);
  const normalizedMinimum = Math.max(0, Number(minimum) || 0);
  return Number.isFinite(count) && count >= normalizedMinimum;
}

export function youtubeSubscriberMinimumMessage() {
  return `Channel needs at least ${MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS.toLocaleString()} subscribers before drafting.`;
}
