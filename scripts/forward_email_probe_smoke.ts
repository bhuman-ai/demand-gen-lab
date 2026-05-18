import fs from "fs";
import path from "path";
import {
  createForwardEmailAlias,
  deleteForwardEmailAlias,
  generateForwardEmailAliasPassword,
  getForwardEmailDomain,
  getForwardEmailProbeConfig,
  verifyForwardEmailDomainRecords,
} from "@/lib/forward-email-client";

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env.production.local"]) {
    const envPath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(envPath)) continue;
    const text = fs.readFileSync(envPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!match || process.env[match[1]]) continue;
      let value = match[2] ?? "";
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

async function main() {
  loadLocalEnv();
  const config = getForwardEmailProbeConfig();
  if (!config) {
    console.log("Forward Email probe config missing. Set FORWARD_EMAIL_API_TOKEN and FORWARD_EMAIL_PROBE_DOMAIN.");
    return;
  }

  await getForwardEmailDomain(config);
  let recordVerification = "pass";
  try {
    await verifyForwardEmailDomainRecords(config);
  } catch (error) {
    recordVerification = error instanceof Error ? error.message : "Forward Email record verification failed";
  }
  const alias = await createForwardEmailAlias({
    config,
    name: `lastb2b-smoke-${Date.now().toString(36)}`,
    description: "LastB2B Forward Email probe smoke test",
    labels: ["lastb2b", "smoke-test"],
    hasImap: true,
  });
  const credentials = await generateForwardEmailAliasPassword({
    config,
    aliasId: alias.id || alias.name,
  });
  await deleteForwardEmailAlias({
    config,
    aliasId: alias.id || alias.name,
  });

  console.log(JSON.stringify({
    ok: Boolean(alias.email && credentials.username && credentials.password),
    domain: config.domain,
    aliasEmail: alias.email,
    hasUsername: Boolean(credentials.username),
    hasPassword: Boolean(credentials.password),
    recordVerification,
    deleted: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
