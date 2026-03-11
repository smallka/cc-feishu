"""WebSocket lifecycle tests."""
import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.bot.websocket import WebSocketManager


@pytest.mark.asyncio
async def test_websocket_manager_stop_stops_thread():
    """stop() should disconnect the client and let the worker thread exit."""
    manager = WebSocketManager()
    started = asyncio.Event()
    fake_client = MagicMock()
    fake_client._disconnect = AsyncMock()

    def fake_start():
        manager.event_loop.call_soon_threadsafe(started.set)
        while not manager._stop_requested.is_set():
            time.sleep(0.01)

    fake_client.start = fake_start

    fake_ws_loop = MagicMock()
    fake_ws_loop.is_closed.return_value = False
    fake_ws_loop.is_running.return_value = True
    fake_ws_loop.call_soon_threadsafe = MagicMock()
    fake_ws_loop.stop = MagicMock()

    class ImmediateFuture:
        def result(self, timeout=None):
            return None

    def fake_run_coroutine_threadsafe(coro, loop):
        asyncio.get_running_loop().create_task(coro)
        return ImmediateFuture()

    with patch("src.bot.websocket.lark.ws.Client", return_value=fake_client), patch(
        "src.bot.websocket.lark_ws_client_module.loop", fake_ws_loop
    ), patch(
        "src.bot.websocket.asyncio.run_coroutine_threadsafe",
        side_effect=fake_run_coroutine_threadsafe,
    ):
        start_task = asyncio.create_task(manager.start(AsyncMock()))
        await asyncio.wait_for(started.wait(), timeout=1)

        await manager.stop()
        await asyncio.wait_for(start_task, timeout=1)
        await asyncio.sleep(0)

        fake_client._disconnect.assert_awaited_once()
        assert manager.ws_thread is None
        assert manager.ws_client is None
        fake_ws_loop.call_soon_threadsafe.assert_called()


@pytest.mark.asyncio
async def test_websocket_manager_start_raises_on_unexpected_exit():
    """Unexpected thread exit should be surfaced to the caller."""
    manager = WebSocketManager()
    fake_client = MagicMock()
    fake_client.start = MagicMock(return_value=None)

    with patch("src.bot.websocket.lark.ws.Client", return_value=fake_client):
        with pytest.raises(ConnectionError, match="closed unexpectedly"):
            await manager.start(AsyncMock())
