"""Agent 基本功能测试"""
import pytest
import asyncio
from src.claude.agent import Agent


@pytest.mark.asyncio
async def test_agent_creation():
    """测试 Agent 创建"""
    agent = Agent(
        chat_id='test_chat',
        cwd='/tmp',
        resume_session_id=None
    )

    assert agent.agent_id.startswith('agent')
    assert agent.chat_id == 'test_chat'
    assert agent.cwd == '/tmp'
    assert agent.session_id is None
    assert not agent._connected


@pytest.mark.asyncio
async def test_agent_connect_and_destroy():
    """测试 Agent 连接和销毁"""
    agent = Agent(
        chat_id='test_chat',
        cwd='/tmp',
        resume_session_id=None
    )

    # 连接
    await agent.ensure_connected()
    assert agent._connected

    # 销毁
    await agent.destroy()
