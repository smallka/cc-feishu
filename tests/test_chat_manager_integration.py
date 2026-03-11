"""ChatManager integration tests with a fake Agent."""
import time
from unittest.mock import AsyncMock, patch

import pytest

from src.bot.chat_manager import ChatManager


class FakeAgent:
    """Minimal Agent stub that behaves like the current async contract."""

    def __init__(self, chat_id, cwd, resume_session_id, on_response):
        self.chat_id = chat_id
        self.cwd = cwd
        self.session_id = resume_session_id
        self.on_response = on_response
        self.agent_id = f"agent-{chat_id}"
        self.start_time = time.time()
        self._connected = False
        self._busy = False
        self.destroyed = False
        self.interrupted = False

    async def ensure_connected(self):
        self._connected = True

    async def send_message(self, message_id, text):
        self._busy = True
        await self.ensure_connected()
        if self.session_id is None:
            self.session_id = f"session-{self.chat_id}"
        await self.on_response(f"reply:{text}")
        self._busy = False

    async def interrupt(self):
        self.interrupted = True

    async def destroy(self):
        self.destroyed = True

    def is_busy(self):
        return self._busy

    def get_agent_id(self):
        return self.agent_id

    def get_cwd(self):
        return self.cwd

    def get_session_id(self):
        return self.session_id

    def get_start_time(self):
        return self.start_time


@pytest.mark.asyncio
async def test_enqueue_message():
    """ChatManager should create an Agent and persist its session."""
    manager = ChatManager()
    await manager.start()

    try:
        with patch("src.bot.chat_manager.Agent", FakeAgent), patch(
            "src.services.message_service.message_service.send_text_message",
            new_callable=AsyncMock,
        ) as send_text:
            await manager.enqueue_message("test_chat", "msg-1", "What is 2+2?")

            assert "test_chat" in manager.agents
            assert "test_chat" in manager.chats
            assert manager.chats["test_chat"]["session_id"] == "session-test_chat"
            send_text.assert_awaited_once_with("test_chat", "reply:What is 2+2?")

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_multiple_chats():
    """Different chats should keep separate Agent/session state."""
    manager = ChatManager()
    await manager.start()

    try:
        with patch("src.bot.chat_manager.Agent", FakeAgent), patch(
            "src.services.message_service.message_service.send_text_message",
            new_callable=AsyncMock,
        ) as send_text:
            await manager.enqueue_message("chat1", "msg-1", "Hello from chat1")
            await manager.enqueue_message("chat2", "msg-2", "Hello from chat2")

            assert len(manager.agents) == 2
            assert "chat1" in manager.agents
            assert "chat2" in manager.agents
            assert manager.chats["chat1"]["session_id"] == "session-chat1"
            assert manager.chats["chat2"]["session_id"] == "session-chat2"
            assert send_text.await_count == 2

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_send_message_alias():
    """send_message should remain as a compatibility alias."""
    manager = ChatManager()
    await manager.start()

    try:
        with patch("src.bot.chat_manager.Agent", FakeAgent), patch(
            "src.services.message_service.message_service.send_text_message",
            new_callable=AsyncMock,
        ) as send_text:
            await manager.send_message("alias_chat", "msg-1", "Hello alias")

            assert manager.chats["alias_chat"]["session_id"] == "session-alias_chat"
            send_text.assert_awaited_once_with("alias_chat", "reply:Hello alias")

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_interrupt():
    """Interrupt should work for both missing and existing sessions."""
    manager = ChatManager()
    await manager.start()

    try:
        with patch("src.bot.chat_manager.Agent", FakeAgent):
            result = await manager.interrupt("nonexistent")
            assert result == "no_session"

            agent, _ = manager.get_or_create_agent("chat1")
            await agent.ensure_connected()

            result = await manager.interrupt("chat1")
            assert result == "success"
            assert agent.interrupted is True

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_reset_with_active_agent():
    """Reset should destroy the active Agent and clear the session."""
    manager = ChatManager()
    await manager.start()

    try:
        with patch("src.bot.chat_manager.Agent", FakeAgent):
            agent, _ = manager.get_or_create_agent("chat1")
            await agent.ensure_connected()

            cwd = await manager.reset("chat1")
            assert isinstance(cwd, str)
            assert "chat1" not in manager.agents
            assert manager.chats["chat1"]["session_id"] is None
            assert agent.destroyed is True

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_switch_cwd_with_active_agent():
    """Switching cwd should destroy the old Agent and reset the session."""
    manager = ChatManager()
    await manager.start()

    try:
        with patch("src.bot.chat_manager.Agent", FakeAgent):
            agent, _ = manager.get_or_create_agent("chat1")
            await agent.ensure_connected()

            new_cwd = "/tmp/test"
            await manager.switch_cwd("chat1", new_cwd)

            assert "chat1" not in manager.agents
            assert manager.chats["chat1"]["cwd"] == new_cwd
            assert manager.chats["chat1"]["session_id"] is None
            assert agent.destroyed is True

    finally:
        await manager.stop()
