"""ChatManager 集成测试"""
import pytest
import asyncio
from src.bot.chat_manager import ChatManager


@pytest.mark.asyncio
async def test_send_message():
    """测试发送消息"""
    manager = ChatManager()
    await manager.start()

    try:
        # 收集响应
        responses = []
        async def collect_response(text: str):
            responses.append(text)

        # 发送消息
        await manager.send_message('test_chat', 'What is 2+2?', collect_response)

        # 验证 Agent 已创建
        assert 'test_chat' in manager.agents
        assert 'test_chat' in manager.chats

        # 验证 session_id 已更新
        assert manager.chats['test_chat']['session_id'] is not None

        # 验证收到响应
        assert len(responses) > 0

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_multiple_chats():
    """测试多个 chat 独立工作"""
    manager = ChatManager()
    await manager.start()

    try:
        # 收集响应
        responses1 = []
        responses2 = []

        async def collect_response1(text: str):
            responses1.append(text)

        async def collect_response2(text: str):
            responses2.append(text)

        # 并发发送消息到两个 chat
        await asyncio.gather(
            manager.send_message('chat1', 'Hello from chat1', collect_response1),
            manager.send_message('chat2', 'Hello from chat2', collect_response2),
        )

        # 验证两个 Agent 都已创建
        assert len(manager.agents) == 2
        assert 'chat1' in manager.agents
        assert 'chat2' in manager.agents

        # 验证两个 session_id 不同
        session1 = manager.chats['chat1']['session_id']
        session2 = manager.chats['chat2']['session_id']
        assert session1 != session2

        # 验证都收到响应
        assert len(responses1) > 0
        assert len(responses2) > 0

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_interrupt():
    """测试中断功能"""
    manager = ChatManager()
    await manager.start()

    try:
        # 没有 Agent 时中断
        result = await manager.interrupt('nonexistent')
        assert result == 'no_session'

        # 创建 Agent
        agent, _ = manager.get_or_create_agent('chat1')
        await agent.ensure_connected()

        # 中断（可能成功或超时，取决于是否有任务在运行）
        result = await manager.interrupt('chat1')
        assert result in ['success', 'timeout', 'error']

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_reset_with_active_agent():
    """测试重置活跃的 Agent"""
    manager = ChatManager()
    await manager.start()

    try:
        # 创建并连接 Agent
        agent, _ = manager.get_or_create_agent('chat1')
        await agent.ensure_connected()

        # 重置
        cwd = await manager.reset('chat1')
        assert isinstance(cwd, str)
        assert 'chat1' not in manager.agents
        assert manager.chats['chat1']['session_id'] is None

    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_switch_cwd_with_active_agent():
    """测试切换活跃 Agent 的工作目录"""
    manager = ChatManager()
    await manager.start()

    try:
        # 创建并连接 Agent
        agent, _ = manager.get_or_create_agent('chat1')
        await agent.ensure_connected()
        original_cwd = agent.cwd

        # 切换目录
        new_cwd = '/tmp/test'
        await manager.switch_cwd('chat1', new_cwd)

        # 验证 Agent 被销毁
        assert 'chat1' not in manager.agents
        assert manager.chats['chat1']['cwd'] == new_cwd
        assert manager.chats['chat1']['session_id'] is None

    finally:
        await manager.stop()
