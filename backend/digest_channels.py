"""Digest delivery channels.

Each channel exposes `name`, `configured()` and `send(html_text, plain_text)`
returning {"ok": bool, "error": str | None}. Credentials come from the
environment (backend/.env), never the database. Only Telegram is implemented;
add another channel by appending it to CHANNELS.
"""
import logging
import os

import requests

logger = logging.getLogger(__name__)

TELEGRAM_LIMIT = 4096
_CHUNK = 3800   # headroom under Telegram's hard limit


def split_message(text: str, limit: int = _CHUNK) -> list[str]:
    """Split on blank-line boundaries (whole sections), hard-splitting only a
    single block that is itself over the limit."""
    chunks, cur = [], ""
    for block in text.split("\n\n"):
        while len(block) > limit:
            if cur:
                chunks.append(cur)
                cur = ""
            cut = block.rfind("\n", 0, limit)
            cut = cut if cut > 0 else limit
            chunks.append(block[:cut])
            block = block[cut:].lstrip("\n")
        if cur and len(cur) + 2 + len(block) > limit:
            chunks.append(cur)
            cur = block
        else:
            cur = f"{cur}\n\n{block}" if cur else block
    if cur:
        chunks.append(cur)
    return chunks


class TelegramChannel:
    name = "telegram"

    @staticmethod
    def _creds():
        return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(), os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    def configured(self) -> bool:
        token, chat = self._creds()
        return bool(token and chat)

    def send(self, html_text: str, plain_text: str = "") -> dict:
        token, chat = self._creds()
        if not (token and chat):
            return {"ok": False, "error": "Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)"}

        def redact(msg: str) -> str:
            # The bot token is part of the request URL, and requests' exception
            # text includes the URL — never let it reach logs, the DB or the UI.
            return str(msg).replace(token, "***")

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        for chunk in split_message(html_text):
            try:
                resp = requests.post(
                    url, timeout=15,
                    json={"chat_id": chat, "text": chunk, "parse_mode": "HTML", "disable_web_page_preview": True},
                )
                body = resp.json() if resp.content else {}
            except Exception as exc:
                err = redact(f"{type(exc).__name__}: {exc}")[:300]
                logger.warning("Telegram send failed: %s", err)
                return {"ok": False, "error": err}
            if resp.status_code != 200 or not body.get("ok"):
                err = redact(body.get("description") or f"HTTP {resp.status_code}")[:300]
                logger.warning("Telegram rejected message: %s", err)
                return {"ok": False, "error": err}
        return {"ok": True, "error": None}


CHANNELS = {"telegram": TelegramChannel()}


def configured_channels() -> list[str]:
    return [name for name, ch in CHANNELS.items() if ch.configured()]
