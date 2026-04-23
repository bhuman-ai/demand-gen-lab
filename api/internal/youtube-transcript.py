from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import os
from datetime import datetime, timezone

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig


def internal_token():
    return (
        os.environ.get("YOUTUBE_TRANSCRIPT_INTERNAL_TOKEN", "").strip()
        or os.environ.get("OUTREACH_CRON_TOKEN", "").strip()
        or os.environ.get("CRON_SECRET", "").strip()
    )


def env(name):
    return os.environ.get(name, "").strip()


def transcript_api(proxy_url=None):
    if not proxy_url:
        return YouTubeTranscriptApi()
    return YouTubeTranscriptApi(
        proxy_config=GenericProxyConfig(
            http_url=proxy_url,
            https_url=proxy_url,
        )
    )


def residential_webshare_api():
    username = env("WEBSHARE_PROXY_USERNAME")
    password = env("WEBSHARE_PROXY_PASSWORD")
    if not username or not password:
        return None
    locations = [env("WEBSHARE_PROXY_COUNTRY").upper()] if env("WEBSHARE_PROXY_COUNTRY") else None
    return YouTubeTranscriptApi(
        proxy_config=WebshareProxyConfig(
            proxy_username=username,
            proxy_password=password,
            filter_ip_locations=locations,
        )
    )


def fetch_transcript(video_id, languages, proxy_url=None):
    return transcript_api(proxy_url).fetch(video_id, languages=languages or ["en", "en-US"])


def fetch_transcript_via_residential_webshare(video_id, languages):
    api = residential_webshare_api()
    if not api:
        raise RuntimeError("residential_webshare_not_configured")
    return api.fetch(video_id, languages=languages or ["en", "en-US"])


def webshare_url(path, params):
    query = "&".join(f"{key}={value}" for key, value in params.items() if value)
    return f"https://proxy.webshare.io{path}?{query}"


def webshare_proxy_urls():
    api_key = env("WEBSHARE_API_KEY")
    if not api_key:
        return []

    params = {
        "page_size": "25",
        "mode": env("WEBSHARE_PROXY_MODE") or "direct",
        "type": env("WEBSHARE_PROXY_TYPE"),
        "country_code": env("WEBSHARE_PROXY_COUNTRY").upper(),
    }
    request = Request(
        webshare_url("/api/v2/proxy/list/", params),
        headers={"Authorization": f"Token {api_key}"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return []

    urls = []
    for row in payload.get("results", []):
        host = str(row.get("proxy_address", "")).strip()
        port = str(row.get("port", "")).strip()
        username = str(row.get("username", "")).strip()
        password = str(row.get("password", "")).strip()
        valid = row.get("valid", True)
        if host and port and username and password and valid:
            urls.append(f"http://{username}:{password}@{host}:{port}")
    return urls


def fetch_with_retries(video_id, languages, request_proxy_url=None):
    attempts = []
    proxy_urls = []
    if request_proxy_url:
        proxy_urls.append(request_proxy_url)
    configured_proxy = env("YOUTUBE_TRANSCRIPT_PROXY_URL")
    if configured_proxy:
        proxy_urls.append(configured_proxy)
    proxy_urls.extend(webshare_proxy_urls()[:5])

    try:
        return fetch_transcript(video_id, languages), attempts
    except Exception as error:
        attempts.append(f"direct:{type(error).__name__}")

    try:
        return fetch_transcript_via_residential_webshare(video_id, languages), attempts
    except Exception as error:
        attempts.append(f"webshare_residential:{type(error).__name__}")

    for proxy_url in proxy_urls:
        try:
            return fetch_transcript(video_id, languages, proxy_url), attempts
        except Exception as error:
            attempts.append(f"proxy:{type(error).__name__}")

    raise RuntimeError(", ".join(attempts) or "transcript unavailable")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        token = internal_token()
        if token and self.headers.get("authorization", "") != f"Bearer {token}":
            return self._json({"error": "unauthorized"}, 401)

        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        video_id = (params.get("videoId") or [""])[0].strip()
        languages = [value.strip() for value in params.get("language", []) if value.strip()]
        if not video_id:
            return self._json({"error": "videoId is required"}, 400)

        request_proxy_url = self.headers.get("x-youtube-transcript-proxy", "").strip()
        try:
            transcript, attempts = fetch_with_retries(video_id, languages, request_proxy_url)
        except Exception as error:
            return self._json(
                {
                    "error": "transcript unavailable",
                    "reason": type(error).__name__,
                    "attempts": str(error),
                },
                404,
            )

        text = " ".join(
            snippet.text.strip() for snippet in transcript if getattr(snippet, "text", "").strip()
        ).strip()
        if not text:
            return self._json({"error": "transcript unavailable"}, 404)

        return self._json(
            {
                "text": text,
                "languageCode": getattr(transcript, "language_code", "") or "",
                "languageName": getattr(transcript, "language", "") or "",
                "isAutoGenerated": bool(getattr(transcript, "is_generated", False)),
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "attempts": attempts,
            },
            200,
        )

    def _json(self, payload, status):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
