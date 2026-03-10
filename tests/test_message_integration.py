"""集成测试：验证消息处理流程"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from src.handlers.message_handler import handle_message


@pytest.mark.asyncio
async def test_help_command():
    """测试 /help 命令"""
    data = {
        'message': {
            'message_id': 'test_msg_1',
            'chat_id': 'test_chat_1',
            'message_type': 'text',
            'content': '{"text": "/help"}'
        }
    }

    with patch('src.handlers.message_handler.message_service') as mock_service:
        mock_service.send_text_message = AsyncMock()

        await handle_message(data)

        # 验证发送了帮助信息
        mock_service.send_text_message.assert_called_once()
        call_args = mock_service.send_text_message.call_args
        assert call_args[0][0] == 'test_chat_1'
        assert '可用命令' in call_args[0][1]


@pytest.mark.asyncio
async def test_stat_command():
    """测试 /stat 命令"""
    data = {
        'message': {
            'message_id': 'test_msg_2',
            'chat_id': 'test_chat_2',
            'message_type': 'text',
            'content': '{"text": "/stat"}'
        }
    }

    with patch('src.handlers.message_handler.message_service') as mock_service, \
         patch('src.handlers.message_handler.chat_manager') as mock_manager:

        mock_service.send_text_message = AsyncMock()
        mock_manager.get_session_info = MagicMock(return_value='Session info')

        await handle_message(data)

        # 验证调用了 get_session_info
        mock_manager.get_session_info.assert_called_once_with('test_chat_2')
        mock_service.send_text_message.assert_called_once_with('test_chat_2', 'Session info')


@pytest.mark.asyncio
async def test_unknown_command():
    """测试未知命令"""
    data = {
        'message': {
            'message_id': 'test_msg_3',
            'chat_id': 'test_chat_3',
            'message_type': 'text',
            'content': '{"text": "/unknown"}'
        }
    }

    with patch('src.handlers.message_handler.message_service') as mock_service:
        mock_service.send_text_message = AsyncMock()

        await handle_message(data)

        # 验证发送了错误提示
        mock_service.send_text_message.assert_called_once()
        call_args = mock_service.send_text_message.call_args
        assert '未知命令' in call_args[0][1]


@pytest.mark.asyncio
async def test_duplicate_message():
    """测试消息去重"""
    data = {
        'message': {
            'message_id': 'test_msg_dup',
            'chat_id': 'test_chat_4',
            'message_type': 'text',
            'content': '{"text": "/help"}'
        }
    }

    with patch('src.handlers.message_handler.message_service') as mock_service:
        mock_service.send_text_message = AsyncMock()

        # 第一次处理
        await handle_message(data)
        assert mock_service.send_text_message.call_count == 1

        # 第二次处理（应该被去重）
        await handle_message(data)
        assert mock_service.send_text_message.call_count == 1  # 没有增加


@pytest.mark.asyncio
async def test_non_text_message():
    """测试非文本消息"""
    data = {
        'message': {
            'message_id': 'test_msg_5',
            'chat_id': 'test_chat_5',
            'message_type': 'image',
            'content': '{}'
        }
    }

    with patch('src.handlers.message_handler.message_service') as mock_service:
        mock_service.send_text_message = AsyncMock()

        await handle_message(data)

        # 验证没有发送任何消息
        mock_service.send_text_message.assert_not_called()
