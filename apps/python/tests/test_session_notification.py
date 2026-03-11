"""Session notification tests at the message handler layer."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.handlers.message_handler import handle_message


class FakeAgent:
    """Agent stub for session notification tests."""

    def __init__(self, cwd: str, actual_session_id: str):
        self.cwd = cwd
        self.session_id = None
        self._actual_session_id = actual_session_id

    def get_session_id(self):
        return self._actual_session_id

    def get_cwd(self):
        return self.cwd


class FakeChatManager:
    """Small chat manager stub for handler-level notification checks."""

    def __init__(self):
        self.chats = {}
        self.default_cwd = "/test/root"
        self._agents = {}
        self._actual_session_ids = {}

    def prime_chat(
        self,
        chat_id: str,
        *,
        expected_session_id: str | None = None,
        actual_session_id: str | None = None,
        cwd: str = "/test/path",
    ):
        self.chats[chat_id] = {
            "cwd": cwd,
            "session_id": expected_session_id,
            "session_notified": False,
        }
        self._actual_session_ids[chat_id] = actual_session_id or expected_session_id

    def get_or_create_agent(self, chat_id: str):
        if chat_id not in self.chats:
            self.prime_chat(chat_id, actual_session_id=f"session-{chat_id}")

        if chat_id not in self._agents:
            chat = self.chats[chat_id]
            actual_session_id = self._actual_session_ids[chat_id]
            self._agents[chat_id] = FakeAgent(chat["cwd"], actual_session_id)

        return self._agents[chat_id], self.chats[chat_id]["session_id"]

    async def send_message(self, chat_id: str, message_id: str, text: str):
        agent = self._agents[chat_id]
        actual_session_id = self._actual_session_ids[chat_id]
        agent.session_id = actual_session_id
        self.chats[chat_id]["session_id"] = actual_session_id
        self.chats[chat_id]["cwd"] = agent.cwd

    async def enqueue_message(self, chat_id: str, message_id: str, text: str):
        await self.send_message(chat_id, message_id, text)


def make_message(chat_id: str, message_id: str, text: str) -> dict:
    return {
        "message": {
            "message_id": message_id,
            "chat_id": chat_id,
            "message_type": "text",
            "content": f'{{"text": "{text}"}}',
        }
    }


@pytest.mark.asyncio
async def test_session_notification():
    """Handler should notify on new sessions and failed resume only once."""
    fake_manager = FakeChatManager()
    service = MagicMock()
    service.send_text_message = AsyncMock()
    service.add_reaction = MagicMock(return_value="reaction-1")
    service.remove_reaction = MagicMock()

    with patch("src.handlers.message_handler.chat_manager", fake_manager), patch(
        "src.handlers.message_handler.message_service", service
    ):
        await handle_message(make_message("chat-1", "msg-1", "Hello"))

        service.send_text_message.assert_awaited_once()
        first_call = service.send_text_message.await_args.args
        assert first_call[0] == "chat-1"
        assert first_call[1].endswith("/test/path (session-chat-1)")
        assert fake_manager.chats["chat-1"]["session_notified"] is True

        service.send_text_message.reset_mock()
        await handle_message(make_message("chat-1", "msg-2", "Hello again"))
        service.send_text_message.assert_not_awaited()

        fake_manager.prime_chat(
            "chat-2",
            expected_session_id="old-session-456",
            actual_session_id="new-session-789",
        )
        service.send_text_message.reset_mock()

        await handle_message(make_message("chat-2", "msg-3", "Resume test"))

        service.send_text_message.assert_awaited_once()
        second_call = service.send_text_message.await_args.args
        assert second_call[0] == "chat-2"
        assert "恢复失败" in second_call[1]
        assert second_call[1].endswith("/test/path (new-session-789)")
