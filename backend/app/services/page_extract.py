"""Fetch a public URL and return readable text; YouTube gets title/description/comments via yt-dlp when possible."""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
import trafilatura
from trafilatura import metadata as tf_metadata
from fastapi import HTTPException

_USER_AGENT = (
    "Mozilla/5.0 (compatible; TitanitPageExtract/1.0; +https://example.local) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_MAX_HTML_BYTES = 2_000_000
_MAX_COMMENTS = 80


@dataclass
class PageExtractResult:
    url: str
    kind: str
    title: str | None
    text: str | None
    comments: list[str]
    note: str | None = None


def _host_is_youtube(hostname: str) -> bool:
    h = hostname.lower().rstrip(".")
    return h == "youtu.be" or h == "youtube.com" or h.endswith(".youtube.com")


def _assert_public_http_url(url: str) -> None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http/https URLs are allowed")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")
    host = parsed.hostname.lower()
    if host == "localhost" or host.endswith(".local"):
        raise HTTPException(status_code=400, detail="Host not allowed")

    try:
        infos = socket.getaddrinfo(parsed.hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail=f"Could not resolve host: {e!s}") from e

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        ):
            raise HTTPException(
                status_code=400,
                detail="URLs that resolve to private or local addresses are not allowed",
            )


async def _fetch_html(client: httpx.AsyncClient, url: str) -> str:
    response = await client.get(
        url,
        follow_redirects=True,
        timeout=httpx.Timeout(45.0),
        headers={"User-Agent": _USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"},
    )
    response.raise_for_status()
    body = response.content
    if len(body) > _MAX_HTML_BYTES:
        raise HTTPException(status_code=413, detail="Page HTML exceeds size limit")
    return body.decode(response.encoding or "utf-8", errors="replace")


def _extract_youtube(url: str) -> PageExtractResult:
    try:
        import yt_dlp
    except ImportError:
        return PageExtractResult(
            url=url,
            kind="youtube",
            title=None,
            text=None,
            comments=[],
            note="yt-dlp is not installed; cannot read YouTube metadata.",
        )

    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 60,
        "extractor_args": {
            "youtube": {
                "max_comments": [str(_MAX_COMMENTS)],
                "comment_sort": ["top"],
            }
        },
    }
    comments: list[str] = []
    title: str | None = None
    description: str | None = None
    note: str | None = None
    info: dict[str, Any] | None = None
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception:
        fallback: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "socket_timeout": 60,
        }
        try:
            with yt_dlp.YoutubeDL(fallback) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:  # noqa: BLE001
            return PageExtractResult(
                url=url,
                kind="youtube",
                title=None,
                text=None,
                comments=[],
                note=f"yt-dlp failed: {e!s}",
            )

    if not isinstance(info, dict):
        return PageExtractResult(
            url=url,
            kind="youtube",
            title=None,
            text=None,
            comments=[],
            note="yt-dlp returned no video metadata (playlist or unsupported URL).",
        )

    title = info.get("title")
    description = info.get("description")
    raw = info.get("comments")
    if isinstance(raw, list):
        for c in raw[:_MAX_COMMENTS]:
            if isinstance(c, dict):
                t = c.get("text")
                if isinstance(t, str) and t.strip():
                    comments.append(re.sub(r"\s+", " ", t.strip()))
            elif isinstance(c, str) and c.strip():
                comments.append(re.sub(r"\s+", " ", c.strip()))
    if not comments:
        note = (
            "No comments returned (disabled by site, login wall, or extractor). "
            "Use the browser tool on the same URL if you need the visible thread."
        )

    parts: list[str] = []
    if title:
        parts.append(f"# {title}")
    if description:
        parts.append(description.strip())
    text = "\n\n".join(parts) if parts else None

    return PageExtractResult(
        url=url,
        kind="youtube",
        title=title,
        text=text,
        comments=comments,
        note=note,
    )


async def extract_page(client: httpx.AsyncClient, url: str) -> PageExtractResult:
    cleaned = url.strip()
    _assert_public_http_url(cleaned)
    host = urlparse(cleaned).hostname or ""
    if _host_is_youtube(host):
        return _extract_youtube(cleaned)

    html = await _fetch_html(client, cleaned)
    extracted = trafilatura.extract(
        html,
        url=cleaned,
        include_tables=True,
        favor_precision=True,
    )
    meta = tf_metadata.extract_metadata(html, default_url=cleaned)
    meta_title = meta.title if meta else None

    return PageExtractResult(
        url=cleaned,
        kind="html",
        title=meta_title,
        text=(extracted.strip() if extracted else None) or None,
        comments=[],
        note=None
        if extracted
        else "No main text extracted (try browser for JS-heavy pages).",
    )
