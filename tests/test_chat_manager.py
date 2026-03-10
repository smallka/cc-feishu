"""ChatManager 单元测试"""
import pytest
import asyncio
from src.bot.chat_manager import ChatManager


@pytest.mark.asyncio
async def test_chat_manager_creation():
    """测试 ChatManager 创建"""
    manager = ChatManager()
    await manager.start()

    assert len(manager.chats) == 0
    assert len(manager.agents) == 0

    await manager.stop()


@pytest.mark.asyncio
async def test_get_or_create_agent():
    """测试获取或创建 Agent"""
    manager = ChatManager()
    await manager.start()

    # 创建第一个 Agent
    agent1 = manager.get_or_create_agent('chat1')
    assert agent1.chat_id == 'chat1'
    assert len(manager.agents) == 1

    # 再次获取，应该返回同一个
    agent2 = manager.get_or_create_agent('chat1')
    assert agent1 is agent2

    # 创建第二个 Agent
    agent3 = manager.get_or_create_agent('chat2')
    assert agent3.chat_id == 'chat2'
    assert len(manager.agents) == 2

    await manager.stop()


@pytest.mark.asyncio
async def test_reset():
    """测试重置会话"""
    manager = ChatManager()
    await manager.start()

    # 创建 Agent
    agent = manager.get_or_create_agent('chat1')
    assert 'chat1' in manager.agents

    # 重置
    cwd = await manager.reset('chat1')
    assert 'chat1' not in manager.agents
    assert 'chat1' in manager.chats
    assert manager.chats['chat1']['session_id'] is None

    await manager.stop()


@pytest.mark.asyncio
async def test_switch_cwd():
    """测试切换目录"""
    manager = ChatManager()
    await manager.start()

    # 创建 Agent
    agent = manager.get_or_create_agent('chat1')
    original_cwd = agent.cwd

    # 切换目录
    new_cwd = '/tmp/test'
    await manager.switch_cwd('chat1', new_cwd)

    assert 'chat1' not in manager.agents  # Agent 被销毁
    assert manager.chats['chat1']['cwd'] == new_cwd

    await manager.stop()


@pytest.mark.asyncio
async def test_get_session_info():
    """测试获取会话信息"""
    manager = ChatManager()
    await manager.start()

    # 没有 Agent 时
    info = manager.get_session_info('chat1')
    assert '没有活跃的会话' in info

    # 创建 Agent 后
    agent = manager.get_or_create_agent('chat1')
    info = manager.get_session_info('chat1')
    assert 'Session ID' in info
    assert '工作目录' in info
    assert '运行时长' in info

    await manager.stop()


@pytest.mark.asyncio
async def test_get_debug_info():
    """测试获取调试信息"""
    manager = ChatManager()
    await manager.start()

    # 创建几个 Agent
    manager.get_or_create_agent('chat1')
    manager.get_or_create_agent('chat2')

    debug_info = manager.get_debug_info()
    assert '系统状态' in debug_info
    assert '活跃会话: 2' in debug_info
    assert '活跃 Agent: 2' in debug_info

    await manager.stop()
