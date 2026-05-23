export type AutomatedReplyDetection = {
  skip: boolean;
  kind: "delivery_status" | "out_of_office" | "anti_spam_challenge" | "";
  reason: string;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function detectAutomatedReply(input: {
  from?: unknown;
  subject?: unknown;
  body?: unknown;
}): AutomatedReplyDetection {
  const from = normalize(input.from);
  const subject = normalize(input.subject);
  const body = normalize(input.body);
  const combined = `${subject}\n${body}`;

  if (
    /\b(mailer-daemon|postmaster|mail delivery subsystem)\b/.test(from) ||
    /\b(delivery status notification|undeliverable|delivery has failed|returned mail|failure notice)\b/.test(
      combined
    )
  ) {
    return { skip: true, kind: "delivery_status", reason: "Automated delivery-status reply" };
  }

  if (
    /\b(out of office|automatic reply|autoreply|auto reply|vacation|away from the office|ooo)\b/.test(
      combined
    )
  ) {
    return { skip: true, kind: "out_of_office", reason: "Out-of-office auto reply" };
  }

  const hasSlowResponse =
    /\b(?:may|might|will|can)\s+be\s+(?:slow|delayed)\s+(?:to|in)\s+respond(?:ing)?\b/.test(combined) ||
    /\b(?:slow|delayed)\s+(?:to|in)\s+respond(?:ing)?\b/.test(combined) ||
    /\blimited\s+(?:access|availability)\s+(?:to|for)\s+(?:email|emails)\b/.test(combined) ||
    /\blimited\s+email\s+access\b|\bdelayed\s+response\b/.test(combined);
  const hasTravelOrAway =
    /\b(?:i'?m|i am|we are)?\s*(?:traveling|travelling)\b/.test(combined) ||
    /\b(?:on travel|on the road|offline|away|at (?:a|the) conference|in meetings|on pto|out until|out this week)\b/.test(
      combined
    );
  const hasUrgentDelegate =
    /\bif you need anything urgent(?:ly)?\b/.test(combined) ||
    /\b(?:for|with)\s+urgent\s+(?:matters|requests|issues)\b/.test(combined) ||
    /\bplease\s+(?:also\s+)?(?:copy|cc|contact|reach out to)\b/.test(combined) ||
    /\b(?:in|during)\s+my\s+absence\b/.test(combined);

  if ((hasSlowResponse && (hasTravelOrAway || hasUrgentDelegate)) || (hasTravelOrAway && hasUrgentDelegate)) {
    return { skip: true, kind: "out_of_office", reason: "Automated availability reply" };
  }

  if (
    /\b(verify you are human|challenge[- ]response|approve sender|whitelist this sender|click the link below to complete delivery)\b/.test(
      combined
    )
  ) {
    return { skip: true, kind: "anti_spam_challenge", reason: "Automated anti-spam challenge" };
  }

  return { skip: false, kind: "", reason: "" };
}
