"""Agent 集成测试"""
import pytest
import asyncio
from src.claude.agent import Agent
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock


@pytest.mark.asyncio
async def test_agent_send_message():
    """测试 Agent 发送消息并接收响应"""
    agent = Agent(
        chat_id='test_chat',
        cwd='/tmp',
        resume_session_id=None
    )

    await agent.ensure_connected()

    # 发送简单消息
    await agent.client.query("What is 2+2?")

    # 接收响应
    collected_text = []
    session_id = None

    async for msg in agent.client.receive_response():
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock):
                    collected_text.append(block.text)
                    print(f"Received: {block.text}")

        elif isinstance(msg, ResultMessage):
            session_id = msg.session_id
            print(f"Session ID: {session_id}")
            break

    # 验证
    assert len(collected_text) > 0
    assert session_id is not None

    # 更新 agent 的 session_id
    agent.session_id = session_id

    await agent.destroy()
