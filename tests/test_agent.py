"""Agent basic tests."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.claude.agent import Agent


async def noop_response(_: str):
    """No-op callback for Agent tests."""


@pytest.mark.asyncio
async def test_agent_creation():
    """Agent should keep constructor state."""
    mock_client = MagicMock()

    with patch("src.claude.agent.ClaudeSDKClient", return_value=mock_client):
        agent = Agent(
            chat_id="test_chat",
            cwd="/tmp",
            resume_session_id=None,
            on_response=noop_response,
        )

    assert agent.agent_id.startswith("agent")
    assert agent.chat_id == "test_chat"
    assert agent.cwd == "/tmp"
    assert agent.session_id is None
    assert not agent._connected


@pytest.mark.asyncio
async def test_agent_connect_and_destroy():
    """Agent should connect and disconnect through the SDK client."""
    mock_client = MagicMock()
    mock_client.connect = AsyncMock()
    mock_client.disconnect = AsyncMock()

    with patch("src.claude.agent.ClaudeSDKClient", return_value=mock_client):
        agent = Agent(
            chat_id="test_chat",
            cwd="/tmp",
            resume_session_id=None,
            on_response=noop_response,
        )

        await agent.ensure_connected()
        assert agent._connected
        mock_client.connect.assert_awaited_once()

        await agent.destroy()
        mock_client.disconnect.assert_awaited_once()
