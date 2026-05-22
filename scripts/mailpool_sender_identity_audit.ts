import fs from "fs";
import path from "path";

type NameParts = {
  firstName: string;
  lastName: string;
};

type IdentityRow = {
  email: string;
  mailboxId: string;
  currentName: string;
  status: string;
  linkedAccountId: string;
  linkedAccountName: string;
  linkedAccountStatus: string;
  suspect: boolean;
  reasons: string[];
  proposedName?: string;
};

type CliOptions = {
  apply: boolean;
  identityFile: string;
  identities: Map<string, NameParts>;
  allowBrandOverlapEmails: Set<string>;
};

const APPROVED_BRAND_OVERLAP_IDENTITIES = new Map<string, string>([
  ["hello@backthebrush.org", "don bosco"],
]);

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    if (process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "").trim();
  }
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseName(value: unknown): NameParts | null {
  const raw = clean(value);
  if (!raw) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function parseIdentityEntry(value: unknown): NameParts | null {
  if (typeof value === "string") return parseName(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const directFirst = clean(record.firstName ?? record.first_name);
  const directLast = clean(record.lastName ?? record.last_name);
  if (directFirst && directLast) {
    return { firstName: directFirst, lastName: directLast };
  }
  return parseName(record.name ?? record.displayName ?? record.display_name);
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const identities = new Map<string, NameParts>();
  const allowBrandOverlapEmails = new Set<string>();
  let identityFile = "";
  let apply = false;

  const take = (flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) return "";
    const value = args[index + 1] ?? "";
    args.splice(index, 2);
    return value;
  };
  const takeAll = (flag: string) => {
    const values: string[] = [];
    for (;;) {
      const value = take(flag);
      if (!value) break;
      values.push(value);
    }
    return values;
  };

  if (args.includes("--apply")) {
    apply = true;
    args.splice(args.indexOf("--apply"), 1);
  }
  identityFile = take("--identity-file");
  for (const value of takeAll("--allow-brand-overlap")) {
    const email = clean(value).toLowerCase();
    if (email) allowBrandOverlapEmails.add(email);
  }

  for (const value of takeAll("--identity")) {
    const separator = value.indexOf("=");
    if (separator === -1) {
      throw new Error("Use --identity email@example.com='First Last'.");
    }
    const email = clean(value.slice(0, separator)).toLowerCase();
    const parsed = parseName(value.slice(separator + 1));
    if (!email || !parsed) {
      throw new Error(`Invalid identity mapping: ${value}`);
    }
    identities.set(email, parsed);
  }

  if (args.length) {
    throw new Error(`Unknown arguments: ${args.join(" ")}`);
  }

  return { apply, identityFile, identities, allowBrandOverlapEmails };
}

function loadIdentityFile(filePath: string, identities: Map<string, NameParts>) {
  if (!filePath) return;
  const raw = fs.readFileSync(path.resolve(filePath), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Identity file must be a JSON object keyed by email.");
  }
  for (const [email, value] of Object.entries(parsed as Record<string, unknown>)) {
    const identity = parseIdentityEntry(value);
    if (!identity) {
      throw new Error(`Invalid identity for ${email}; use \"First Last\" or {\"firstName\":\"First\",\"lastName\":\"Last\"}.`);
    }
    identities.set(clean(email).toLowerCase(), identity);
  }
}

function genericMailboxWord(value: string) {
  return [
    "admin",
    "contact",
    "hello",
    "help",
    "info",
    "mail",
    "marketing",
    "ops",
    "research",
    "sales",
    "support",
    "team",
  ].includes(normalizeIdentity(value));
}

function domainIdentityTokens(email: string) {
  const domain = clean(email.split("@")[1]).toLowerCase();
  const sld = domain.split(".")[0] ?? "";
  const stripped = sld.replace(/^(use|get|go|try|my|the)/, "");
  return Array.from(new Set([domain, sld, stripped].filter((value) => value.length >= 4)));
}

function brandIdentityTokens(brands: Array<{ name?: string }>) {
  const tokens = new Set<string>();
  for (const brand of brands) {
    const normalized = normalizeIdentity(brand.name);
    if (!normalized) continue;
    tokens.add(normalized);
    for (const token of normalized.split(" ")) {
      if (token.length >= 4) tokens.add(token);
    }
  }
  return [...tokens].filter((token) => token.length >= 4);
}

function isApprovedBrandOverlap(email: string, displayName: string, allowBrandOverlapEmails: Set<string>) {
  const normalizedEmail = clean(email).toLowerCase();
  if (allowBrandOverlapEmails.has(normalizedEmail)) return true;
  return APPROVED_BRAND_OVERLAP_IDENTITIES.get(normalizedEmail) === normalizeIdentity(displayName);
}

function validatePersonName(
  email: string,
  identity: NameParts,
  brandTokens: string[],
  allowBrandOverlapEmails: Set<string>
) {
  const firstName = clean(identity.firstName);
  const lastName = clean(identity.lastName);
  const displayName = `${firstName} ${lastName}`.trim();
  if (!firstName || !lastName) return "missing first or last name";
  if (genericMailboxWord(firstName) || genericMailboxWord(lastName)) return "generic mailbox word";
  if (displayName.includes("@") || displayName.includes(".")) return "email or domain-like name";
  const comparableDisplay = normalizeIdentity(displayName);
  for (const token of domainIdentityTokens(email)) {
    const comparableToken = normalizeIdentity(token);
    if (comparableToken && comparableDisplay.includes(comparableToken)) {
      return `name contains domain token ${token}`;
    }
  }
  if (!isApprovedBrandOverlap(email, displayName, allowBrandOverlapEmails)) {
    for (const token of brandTokens) {
      if (token && comparableDisplay.includes(token)) {
        return `name contains brand token ${token}`;
      }
    }
  }
  return "";
}

function senderIdentityIssues(input: {
  email: string;
  firstName: string;
  lastName: string;
  brandTokens: string[];
  allowBrandOverlapEmails: Set<string>;
}) {
  const issues: string[] = [];
  const displayName = `${input.firstName} ${input.lastName}`.trim();
  if (!input.firstName || !input.lastName) issues.push("missing first/last name");
  if (genericMailboxWord(input.firstName) || genericMailboxWord(input.lastName)) {
    issues.push("generic mailbox word");
  }
  if (displayName.includes("@") || displayName.includes(".")) {
    issues.push("email/domain in name");
  }
  const comparableDisplay = normalizeIdentity(displayName);
  for (const token of domainIdentityTokens(input.email)) {
    const comparableToken = normalizeIdentity(token);
    if (comparableToken && comparableDisplay.includes(comparableToken)) {
      issues.push(`domain token: ${token}`);
    }
  }
  if (!isApprovedBrandOverlap(input.email, displayName, input.allowBrandOverlapEmails)) {
    for (const token of input.brandTokens) {
      if (token && comparableDisplay.includes(token)) {
        issues.push(`brand token: ${token}`);
      }
    }
  }
  return issues;
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  loadIdentityFile(options.identityFile, options.identities);

  const { getOutreachProvisioningSettingsSecrets } = await import("@/lib/outreach-provider-settings");
  const { listMailpoolMailboxes, updateMailpoolMailbox } = await import("@/lib/mailpool-client");
  const { listOutreachAccounts, updateOutreachAccount } = await import("@/lib/outreach-data");
  const { listBrands } = await import("@/lib/factory-data");

  const secrets = await getOutreachProvisioningSettingsSecrets();
  const apiKey = clean(secrets.mailpoolApiKey);
  if (!apiKey) {
    throw new Error("Mailpool API key is not configured.");
  }

  const [mailboxes, accounts, brands] = await Promise.all([
    listMailpoolMailboxes(apiKey),
    listOutreachAccounts(),
    listBrands(),
  ]);
  const brandTokens = brandIdentityTokens(brands);
  const accountsByEmail = new Map<string, typeof accounts>();
  for (const account of accounts) {
    const email = clean(account.config.mailbox.email).toLowerCase();
    if (!email) continue;
    accountsByEmail.set(email, [...(accountsByEmail.get(email) ?? []), account]);
  }

  const rows: IdentityRow[] = [];
  const applied: Array<{ email: string; name: string; accountId: string }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];

  for (const mailbox of mailboxes) {
    const email = clean(mailbox.email).toLowerCase();
    if (!email) continue;
    const firstName = clean(mailbox.firstName);
    const lastName = clean(mailbox.lastName);
    const currentName = `${firstName} ${lastName}`.trim();
    const linkedAccounts = accountsByEmail.get(email) ?? [];
    const account =
      linkedAccounts.find((item) => item.status === "active") ??
      linkedAccounts[0] ??
      null;
    const reasons = senderIdentityIssues({
      email,
      firstName,
      lastName,
      brandTokens,
      allowBrandOverlapEmails: options.allowBrandOverlapEmails,
    });
    const identity = options.identities.get(email) ?? null;
    const proposedName = identity ? `${clean(identity.firstName)} ${clean(identity.lastName)}`.trim() : undefined;

    rows.push({
      email,
      mailboxId: clean(mailbox.id),
      currentName: currentName || "(blank)",
      status: clean(mailbox.status),
      linkedAccountId: clean(account?.id),
      linkedAccountName: clean(account?.name),
      linkedAccountStatus: clean(account?.status),
      suspect: reasons.length > 0,
      reasons,
      proposedName,
    });

    if (!identity) continue;
    const invalidReason = validatePersonName(
      email,
      identity,
      brandTokens,
      options.allowBrandOverlapEmails
    );
    if (invalidReason) {
      skipped.push({ email, reason: invalidReason });
      continue;
    }
    if (!options.apply) continue;

    const nextFirstName = clean(identity.firstName);
    const nextLastName = clean(identity.lastName);
    const nextName = `${nextFirstName} ${nextLastName}`.trim();
    await updateMailpoolMailbox({
      apiKey,
      mailboxId: clean(mailbox.id),
      patch: {
        firstName: nextFirstName,
        lastName: nextLastName,
        signature: `Best regards,\n${nextName}`,
      },
    });
    for (const linkedAccount of linkedAccounts) {
      await updateOutreachAccount(linkedAccount.id, { name: nextName });
    }
    applied.push({
      email,
      name: nextName,
      accountId: linkedAccounts.map((item) => item.id).join(","),
    });
  }

  rows.sort((left, right) => Number(right.suspect) - Number(left.suspect) || left.email.localeCompare(right.email));
  console.log(JSON.stringify({
    ok: true,
    mode: options.apply ? "apply" : "audit",
    count: rows.length,
    suspects: rows.filter((row) => row.suspect).length,
    identitiesLoaded: options.identities.size,
    applied,
    skipped,
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
