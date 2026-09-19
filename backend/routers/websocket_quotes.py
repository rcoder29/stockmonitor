"""WebSocket Live Quotes — powers real-time price updates across the app.

_fetch_quote is still in main.py (shared by many other not-yet-extracted
sections) — imported with a function-scoped deferred import since
main.py imports this router to register it, which would otherwise
cycle.
"""
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter()

# ── WebSocket live quotes ─────────────────────────────────────────────────────

@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket, symbols: str = ""):
    from main import _fetch_quote

    await websocket.accept()
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        await websocket.close()
        return
    loop = asyncio.get_event_loop()
    try:
        while True:
            results = await loop.run_in_executor(
                None,
                lambda: [_fetch_quote(s) for s in syms],
            )
            await websocket.send_json(results)
            await asyncio.sleep(4)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("WS quotes error: %s", e)


