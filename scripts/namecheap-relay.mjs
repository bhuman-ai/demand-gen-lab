import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const DEFAULT_TARGET_URL = "https://api.namecheap.com/xml.response";
const ALLOWED_TARGET_HOSTS = new Set(["api.namecheap.com", "api.sandbox.namecheap.com"]);
const bind = String(process.env.NAMECHEAP_RELAY_BIND ?? "0.0.0.0").trim() || "0.0.0.0";
const port = Number(process.env.PORT ?? process.env.NAMECHEAP_RELAY_PORT ?? 8788) || 8788;
const relayToken = String(process.env.NAMECHEAP_RELAY_TOKEN ?? "").trim();
const targetUrl = String(process.env.NAMECHEAP_TARGET_URL ?? DEFAULT_TARGET_URL).trim() || DEFAULT_TARGET_URL;

if (!relayToken) {
  console.error("NAMECHEAP_RELAY_TOKEN is required.");
  process.exit(1);
}

const target = new URL(targetUrl);
if (target.protocol !== "https:" || !ALLOWED_TARGET_HOSTS.has(target.hostname)) {
  console.error(
    `NAMECHEAP_TARGET_URL must use https and point to ${[...ALLOWED_TARGET_HOSTS].join(" or ")}.`
  );
  process.exit(1);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  const header = String(request.headers.authorization ?? "");
  if (!header.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(header.slice("Bearer ".length).trim());
  const expected = Buffer.from(relayToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) {
      throw new Error("Request body too large.");
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function normalizeParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("params must be an object.");
  }
  const params = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim()) {
      continue;
    }
    params[key] = String(raw ?? "");
  }
  return params;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, {
        ok: true,
        targetHost: target.hostname,
      });
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/namecheap") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: "Unauthorized." });
      return;
    }

    const body = await readJsonBody(request);
    const command = String(body.command ?? "").trim();
    if (!command) {
      sendJson(response, 400, { error: "command is required." });
      return;
    }

    const params = normalizeParams(body.params);
    params.Command = command;

    const query = new URLSearchParams(params);
    const upstream = await fetch(`${target.toString()}?${query.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const upstreamBody = await upstream.text();

    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(upstreamBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected relay error.";
    sendJson(response, 500, { error: message });
  }
});

server.listen(port, bind, () => {
  console.log(`Namecheap relay listening on http://${bind}:${port}/namecheap`);
});
