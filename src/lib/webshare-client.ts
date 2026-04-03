import { URL } from "url";

type WebshareProxyRow = {
  id: string;
  proxy_address: string;
  port: number;
  username: string;
  password: string;
  valid: boolean;
  type: string;
  country_code?: string;
  city_name?: string;
};

type WebshareListResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: WebshareProxyRow[];
};

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function webshareApiKey() {
  return readEnv("WEBSHARE_API_KEY");
}

function webshareProxyMode() {
  return readEnv("WEBSHARE_PROXY_MODE") || "direct";
}

function webshareProxyType() {
  return readEnv("WEBSHARE_PROXY_TYPE");
}

function webshareProxyCountry() {
  return readEnv("WEBSHARE_PROXY_COUNTRY");
}

function buildWebshareUrl(path: string, params: Record<string, string>) {
  const url = new URL(`https://proxy.webshare.io${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function normalizeProxyRow(raw: Record<string, unknown>): WebshareProxyRow | null {
  const proxy_address = String(raw.proxy_address ?? raw.proxyAddress ?? "").trim();
  const port = Number(raw.port ?? raw.proxy_port ?? 0) || 0;
  const username = String(raw.username ?? raw.user ?? "").trim();
  const password = String(raw.password ?? raw.pass ?? "").trim();
  if (!proxy_address || !port || !username || !password) return null;

  return {
    id: String(raw.id ?? `${proxy_address}:${port}`).trim(),
    proxy_address,
    port,
    username,
    password,
    valid: raw.valid === undefined ? true : Boolean(raw.valid),
    type: String(raw.type ?? raw.proxy_type ?? "").trim(),
    country_code: String(raw.country_code ?? raw.countryCode ?? "").trim() || undefined,
    city_name: String(raw.city_name ?? raw.cityName ?? "").trim() || undefined,
  };
}

async function fetchWebsharePage(url: string, apiKey: string): Promise<WebshareListResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Webshare HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
  const payload: unknown = raw ? JSON.parse(raw) : {};
  const row = (payload && typeof payload === "object") ? (payload as Record<string, unknown>) : {};
  return {
    count: Number(row.count ?? 0) || 0,
    next: typeof row.next === "string" ? row.next : null,
    previous: typeof row.previous === "string" ? row.previous : null,
    results: Array.isArray(row.results) ? row.results as WebshareProxyRow[] : [],
  };
}

export async function listWebshareProxies() {
  const apiKey = webshareApiKey();
  if (!apiKey) {
    return { ok: false as const, error: "WEBSHARE_API_KEY missing", proxies: [] as WebshareProxyRow[] };
  }

  const params: Record<string, string> = {
    page_size: "100",
    mode: webshareProxyMode(),
  };
  const type = webshareProxyType();
  if (type) params.type = type;
  const country = webshareProxyCountry();
  if (country) params.country_code = country.toUpperCase();

  const proxies: WebshareProxyRow[] = [];
  let url = buildWebshareUrl("/api/v2/proxy/list/", params);
  for (let page = 0; page < 20; page += 1) {
    const payload = await fetchWebsharePage(url, apiKey);
    for (const raw of payload.results) {
      const normalized = normalizeProxyRow(raw as unknown as Record<string, unknown>);
      if (normalized) proxies.push(normalized);
    }
    if (!payload.next) break;
    url = payload.next;
  }

  return { ok: true as const, error: "", proxies };
}

export type WebshareProxyChoice = {
  host: string;
  port: number;
  username: string;
  password: string;
  url: string;
};

export async function pickWebshareProxy(usedKeys: Set<string>) {
  const result = await listWebshareProxies();
  if (!result.ok) {
    return { ok: false as const, error: result.error, proxy: null as WebshareProxyChoice | null };
  }
  const candidate = result.proxies.find((proxy) => {
    if (!proxy.valid) return false;
    const key = `${proxy.proxy_address}:${proxy.port}`;
    return !usedKeys.has(key);
  });
  if (!candidate) {
    return { ok: false as const, error: "No unused Webshare proxies available", proxy: null as WebshareProxyChoice | null };
  }
  return {
    ok: true as const,
    error: "",
    proxy: {
      host: candidate.proxy_address,
      port: candidate.port,
      username: candidate.username,
      password: candidate.password,
      url: `http://${candidate.username}:${candidate.password}@${candidate.proxy_address}:${candidate.port}`,
    },
  };
}
