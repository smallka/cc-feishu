"""测试 session 变化通知功能"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from src.bot.chat_manager import ChatManager


async def test_session_notification():
    """测试 session 变化通知"""

    # 创建 ChatManager
    manager = ChatManager()

    # Mock message_service
    with patch('src.services.message_service.message_service') as mock_service:
        mock_service.send_text_message = AsyncMock()

        # Mock Agent
        with patch('src.bot.chat_manager.Agent') as MockAgent:
            mock_agent = MagicMock()
            mock_agent.client = True  # 模拟存活
            mock_agent.get_session_id.return_value = 'new-session-123'
            mock_agent.get_cwd.return_value = '/test/path'
            mock_agent.session_id = 'new-session-123'
            mock_agent.cwd = '/test/path'

            # 模拟 send_message 调用回调
            async def mock_send_message(text, callback):
                await callback('AI response')

            mock_agent.send_message = mock_send_message
            MockAgent.return_value = mock_agent

            # 场景 1: 首次创建会话（expected_session_id = None）
            print("测试场景 1: 首次创建会话")
            chat_id = 'test-chat-1'

            user_response = []
            async def capture_response(text):
                user_response.append(text)

            await manager.send_message(chat_id, 'Hello', capture_response)

            # 验证通知
            assert mock_service.send_text_message.called
            call_args = mock_service.send_text_message.call_args
            assert call_args[0][0] == chat_id
            assert '新会话' in call_args[0][1]
            assert 'new-session-123' in call_args[0][1]
            print("[OK] 通知消息已发送（包含新会话和 session ID）")

            # 验证用户响应
            assert len(user_response) == 1
            assert user_response[0] == 'AI response'
            print("[OK] 用户收到响应")

            # 验证 session_notified 标志
            assert manager.chats[chat_id]['session_notified'] is True
            print("[OK] session_notified 标志已设置")

            # 场景 2: 第二次消息（不应再通知）
            print("\n测试场景 2: 第二次消息（不应重复通知）")
            mock_service.send_text_message.reset_mock()
            user_response.clear()

            await manager.send_message(chat_id, 'Hello again', capture_response)

            # 验证不再通知
            assert not mock_service.send_text_message.called
            print("[OK] 未发送重复通知")

            # 场景 3: 恢复失败（expected != actual）
            print("\n测试场景 3: 恢复失败")
            chat_id_2 = 'test-chat-2'

            # 预设一个旧 session_id
            manager.chats[chat_id_2] = {
                'cwd': '/test/path',
                'session_id': 'old-session-456',
                'session_notified': False
            }

            # 创建新 Agent 时会尝试恢复 old-session-456
            # 但实际返回 new-session-789
            mock_agent.get_session_id.return_value = 'new-session-789'
            mock_agent.session_id = 'new-session-789'

            mock_service.send_text_message.reset_mock()
            user_response.clear()

            await manager.send_message(chat_id_2, 'Resume test', capture_response)

            # 验证恢复失败通知
            assert mock_service.send_text_message.called
            call_args = mock_service.send_text_message.call_args
            assert '恢复失败' in call_args[0][1]
            assert 'new-session-789' in call_args[0][1]
            print("[OK] 恢复失败通知已发送")

            print("\n[OK] 所有测试通过！")


if __name__ == '__main__':
    asyncio.run(test_session_notification())
