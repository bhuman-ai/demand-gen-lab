type SuggestionQualityInput = {
  name: string;
  audience: string;
  offer: string;
  cta: string;
  emailPreview: string;
  successTarget: string;
  rationale: string;
};

const PLACEHOLDER_PATTERNS = [
  /\bdefine one clear ask\b/i,
  /\bdefine (a|the)\b/i,
  /\btbd\b/i,
  /\bto be defined\b/i,
  /\bnot defined\b/i,
  /\bnot set\b/i,
  /\bn\/a\b/i,
  /\bplaceholder\b/i,
];

const CTA_VERB_PATTERN =
  /\b(reply|book|schedule|share|send|confirm|approve|join|start|review|forward|introduce|connect)\b/i;

const OFFER_NOUN_PATTERN =
  /\b(teardown|diagnostic|audit|benchmark|blueprint|plan|video|walkthrough|assessment|case study|report|review)\b/i;

const METRIC_PATTERN = /\b(reply|positive|meeting|booked|sent|rate|conversion)\b/i;
const NUMBER_PATTERN = /\d/;

function wordCount(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isPlaceholder(value: string) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

export function validateConcreteSuggestion(input: SuggestionQualityInput) {
  const errors: string[] = [];

  if (!input.name.trim() || wordCount(input.name) < 4 || isPlaceholder(input.name)) {
    errors.push("name is missing or too generic");
  }
  if (!input.audience.trim() || wordCount(input.audience) < 5 || isPlaceholder(input.audience)) {
    errors.push("audience is missing or too generic");
  }
  if (
    !input.offer.trim() ||
    wordCount(input.offer) < 7 ||
    isPlaceholder(input.offer) ||
    !OFFER_NOUN_PATTERN.test(input.offer)
  ) {
    errors.push("offer must describe a concrete artifact");
  }
  if (
    !input.cta.trim() ||
    wordCount(input.cta) < 4 ||
    isPlaceholder(input.cta) ||
    !CTA_VERB_PATTERN.test(input.cta)
  ) {
    errors.push("cta must contain a concrete action");
  }
  if (
    !input.emailPreview.trim() ||
    wordCount(input.emailPreview) < 8 ||
    wordCount(input.emailPreview) > 30 ||
    isPlaceholder(input.emailPreview)
  ) {
    errors.push("email preview must be specific and concise");
  }
  if (
    !input.successTarget.trim() ||
    isPlaceholder(input.successTarget) ||
    !NUMBER_PATTERN.test(input.successTarget) ||
    !METRIC_PATTERN.test(input.successTarget)
  ) {
    errors.push("success target must be measurable");
  }
  if (!input.rationale.trim() || wordCount(input.rationale) < 8 || isPlaceholder(input.rationale)) {
    errors.push("rationale must explain why this idea should work");
  }

  return errors;
}

export function isConcreteSuggestion(input: SuggestionQualityInput) {
  return validateConcreteSuggestion(input).length === 0;
}
