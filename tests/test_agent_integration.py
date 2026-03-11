"""Agent flow tests with a fake Claude SDK client."""
import asyncio
from unittest.mock import patch

import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from src.claude.agent import Agent


class FakeClaudeClient:
    """Small SDK client stub for Agent tests."""

    def __init__(self):
        self.connected = False
        self.disconnected = False
        self.interrupted = False
        self.queries: list[str] = []

    async def connect(self):
        self.connected = True

    async def disconnect(self):
        self.disconnected = True

    async def interrupt(self):
        self.interrupted = True

    async def query(self, text: str):
        self.queries.append(text)

    async def receive_response(self):
        yield AssistantMessage(content=[TextBlock(text="4")], model="fake-model")
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-123",
            result="4",
        )


@pytest.mark.asyncio
async def test_agent_send_message():
    """Agent should process a queued message and invoke the callback."""
    fake_client = FakeClaudeClient()
    responses: list[str] = []
    response_received = asyncio.Event()

    async def on_response(text: str):
        responses.append(text)
        response_received.set()

    with patch(
        "src.claude.agent.ClaudeSDKClient",
        side_effect=lambda *args, **kwargs: fake_client,
    ):
        agent = Agent(
            chat_id="test_chat",
            cwd="/tmp",
            resume_session_id=None,
            on_response=on_response,
        )

        await agent.send_message("msg-1", "What is 2+2?")
        await asyncio.wait_for(response_received.wait(), timeout=1)

        assert fake_client.connected is True
        assert fake_client.queries == ["What is 2+2?"]
        assert responses == ["4"]
        assert agent.session_id == "session-123"
        assert agent.is_busy() is False

        await agent.destroy()
        assert fake_client.disconnected is True
