"""消息处理器"""
from collections import OrderedDict
import asyncio
import time
import logging
from pathlib import Path
from src.bot.chat_manager import chat_manager
from src.services.message_service import message_service
from src.config import config

logger = logging.getLogger(__name__)

# 消息去重
processed_messages = OrderedDict()
MAX_CACHE_SIZE = 500


def is_duplicate(message_id: str) -> bool:
    """检查消息是否重复"""
    if message_id in processed_messages:
        return True

    processed_messages[message_id] = True

    # 淘汰最旧的
    if len(processed_messages) > MAX_CACHE_SIZE:
        processed_messages.popitem(last=False)

    return False


def extract_text(message: dict) -> str:
    """从消息中提取文本内容"""
    try:
        import json
        content = json.loads(message.get('content', '{}'))
        return content.get('text', '').strip()
    except Exception as e:
        logger.error('Failed to extract text from message', extra={'error': str(e)})
        return ''


def resolve_work_path(input_path: str) -> str | None:
    """解析工作路径"""
    work_root = Path(config.claude.work_root)

    if Path(input_path).is_absolute():
        target = Path(input_path)
    else:
        target = work_root / input_path

    if not target.exists() or not target.is_dir():
        return None

    return str(target.resolve())


async def handle_message(data):
    """处理飞书消息（外层超时保护）"""
    start_time = time.time()

    # 处理飞书 SDK 的数据结构
    # data 是 P2ImMessageReceiveV1 对象
    if hasattr(data, 'event'):
        event = data.event
        message = {
            'message_id': event.message.message_id,
            'chat_id': event.message.chat_id,
            'message_type': event.message.message_type,
            'content': event.message.content,
        }
        data_dict = {'message': message}
    else:
        # 兼容测试数据
        data_dict = data
        message = data_dict.get('message', {})

    message_id = message.get('message_id', '')
    chat_id = message.get('chat_id', '')

    # 消息去重
    if is_duplicate(message_id):
        logger.debug('Skipping duplicate message', extra={'message_id': message_id})
        return

    logger.info('Processing message', extra={
        'message_id': message_id,
        'chat_id': chat_id
    })

    try:
        timeout = config.message_timeout / 1000  # 转换为秒
        await asyncio.wait_for(
            handle_message_internal(data_dict, start_time),
            timeout=timeout
        )

    except asyncio.TimeoutError:
        duration = time.time() - start_time
        logger.error('Message processing timeout', extra={
            'message_id': message_id,
            'chat_id': chat_id,
            'duration': duration
        })

        await message_service.send_text_message(
            chat_id,
            f'⚠️ 消息处理超时（{int(timeout)}秒）\n提示：使用 /new 重置会话'
        )

    except Exception as e:
        logger.error('Unexpected error in handle_message', extra={
            'message_id': message_id,
            'error': str(e)
        })


async def handle_message_internal(data: dict, start_time: float):
    """处理飞书消息（内部实现）"""
    message = data.get('message', {})
    message_id = message.get('message_id', '')
    chat_id = message.get('chat_id', '')
    message_type = message.get('message_type', '')

    # 只处理文本消息
    if message_type != 'text':
        return

    text = extract_text(message)
    if not text:
        return

    # 命令处理
    if text == '/help':
        help_text = [
            '可用命令:',
            '/help — 显示帮助',
            '/new — 重置会话',
            '/stop — 打断任务',
            '/stat — 会话状态',
            '/cd <路径> — 切换目录（/cd . 切换到根目录）',
            '/resume — 列出 sessions',
            '/resume <编号|session_id> — 恢复 session',
            '/debug — 系统调试信息',
        ]
        await message_service.send_text_message(chat_id, '\n'.join(help_text))
        return

    if text == '/stop':
        result = await chat_manager.interrupt(chat_id)

        if result == 'success':
            await message_service.send_text_message(
                chat_id,
                '⏸️ 已发送中断信号，AI 将停止当前任务'
            )
        elif result == 'timeout':
            await message_service.send_text_message(
                chat_id,
                '⚠️ 中断信号发送超时，请使用 /new 强制重置会话'
            )
        elif result == 'no_session':
            await message_service.send_text_message(
                chat_id,
                '❌ 当前没有活跃的会话'
            )
        else:
            await message_service.send_text_message(
                chat_id,
                '⚠️ 中断失败，请使用 /new 强制重置会话'
            )
        return

    if text == '/new':
        cwd = await chat_manager.reset(chat_id)
        await message_service.send_text_message(
            chat_id,
            f'✅ 会话已重置，可以开始新的对话\n工作目录: {cwd}'
        )
        return

    if text == '/stat':
        info = chat_manager.get_session_info(chat_id)
        await message_service.send_text_message(chat_id, info)
        return

    if text == '/debug':
        info = chat_manager.get_debug_info()
        await message_service.send_card_message(chat_id, info)
        return

    if text == '/cd':
        await message_service.send_text_message(
            chat_id,
            '用法: /cd <路径>\n使用 /cd . 切换到根目录'
        )
        return

    if text.startswith('/cd '):
        input_path = text[4:].strip()

        # /cd . 切换到根目录
        if input_path == '.':
            target = config.claude.work_root
        else:
            target = resolve_work_path(input_path)

        if not target:
            await message_service.send_text_message(
                chat_id,
                f'目录不存在: {input_path}'
            )
            return

        await chat_manager.switch_cwd(chat_id, target)
        result = await chat_manager.list_sessions(chat_id)
        await message_service.send_card_message(chat_id, result)
        return

    if text == '/resume':
        result = await chat_manager.list_sessions(chat_id)
        await message_service.send_card_message(chat_id, result)
        return

    if text.startswith('/resume '):
        input_value = text[8:].strip()
        if not input_value:
            result = await chat_manager.list_sessions(chat_id)
            await message_service.send_card_message(chat_id, result)
            return

        # 检查是否为数字（编号）
        if input_value.isdigit():
            index = int(input_value)
            if index < 1:
                await message_service.send_text_message(
                    chat_id,
                    '❌ 编号必须大于 0'
                )
                return

            # 获取 session 列表
            sessions = chat_manager._get_session_list(chat_id)
            if index > len(sessions):
                await message_service.send_text_message(
                    chat_id,
                    f'❌ 编号超出范围（共 {len(sessions)} 个 session）\n使用 /resume 查看可用的 sessions'
                )
                return

            session_id, target_cwd = sessions[index - 1]

            # 如果目标目录与当前目录不同，先切换目录
            current_cwd = chat_manager.chats.get(chat_id, {}).get('cwd', chat_manager.default_cwd)
            if target_cwd != current_cwd:
                await chat_manager.switch_cwd(chat_id, target_cwd)

            result = await chat_manager.resume_session(chat_id, session_id)
        else:
            # 直接使用 session ID
            result = await chat_manager.resume_session(chat_id, input_value)

        await message_service.send_text_message(chat_id, result)
        return

    # 未知命令拦截
    if text.startswith('/'):
        await message_service.send_text_message(
            chat_id,
            f'未知命令: {text.split()[0]}\n输入 /help 查看可用命令。'
        )
        return

    # 转发给 Claude Code
    reaction_id = None
    try:
        # 添加 reaction
        reaction_id = message_service.add_reaction(message_id, 'Typing')

        # 获取或创建 agent，检查 session 变化
        agent, expected_session_id = chat_manager.get_or_create_agent(chat_id)

        # 发送消息
        await chat_manager.send_message(chat_id, message_id, text)

        # 检查 session 是否变化（仅首次响应）
        chat_data = chat_manager.chats.get(chat_id, {})
        if not chat_data.get('session_notified', False):
            actual_session_id = agent.get_session_id()
            session_changed = actual_session_id != expected_session_id

            # 生成通知消息
            notification = None
            if not expected_session_id:
                # 首次创建会话
                notification = f'🆕 新会话: {agent.get_cwd()} ({actual_session_id})'
            elif session_changed:
                # 恢复失败
                notification = f'⚠️ 恢复失败，已创建新会话: {agent.get_cwd()} ({actual_session_id})'

            # 发送通知
            if notification:
                try:
                    await message_service.send_text_message(chat_id, notification)
                    logger.info('Session change notification sent', extra={
                        'chat_id': chat_id,
                        'session_changed': session_changed
                    })
                except Exception as e:
                    logger.error('Failed to send session notification', extra={
                        'chat_id': chat_id,
                        'error': str(e)
                    })

            # 标记已通知
            chat_manager.chats[chat_id]['session_notified'] = True

    except asyncio.CancelledError:
        await message_service.send_text_message(
            chat_id,
            '⚠️ 处理被中断\n提示：使用 /new 可以重置会话'
        )
        raise

    except Exception as e:
        logger.error('Error sending message', extra={
            'chat_id': chat_id,
            'error': str(e)
        })
        await message_service.send_text_message(
            chat_id,
            f'❌ 处理消息时出错: {str(e)}\n提示：使用 /new 可以重置会话'
        )

    finally:
        # 移除 reaction
        if reaction_id:
            try:
                message_service.remove_reaction(message_id, reaction_id)
            except Exception as e:
                logger.warning('Failed to remove reaction', extra={'error': str(e)})

    # 记录处理时长
    duration = time.time() - start_time
    timeout = config.message_timeout / 1000
    if duration > timeout * 0.5:
        logger.warning('Message processing took long time', extra={
            'message_id': message_id,
            'chat_id': chat_id,
            'duration': duration,
            'threshold': timeout * 0.5
        })
