"""ChatManager：管理 Chat → Agent 映射"""
from typing import Dict, Optional, Callable, Awaitable
import asyncio
import time
import logging
from src.claude.agent import Agent

logger = logging.getLogger(__name__)


class ChatManager:
    """管理多个 Chat 的 Agent 实例"""

    def __init__(self):
        from src.config import config
        self.chats: Dict[str, dict] = {}  # chat_id -> {cwd, session_id, session_notified}
        self.agents: Dict[str, Agent] = {}  # chat_id -> Agent
        self.current_reactions: Dict[str, tuple] = {}  # chat_id -> (message_id, reaction_id)
        self.default_cwd = config.claude.work_root
        self.start_time = time.time()
        self.response_complete_callback: Optional[Callable[[], None]] = None

    async def start(self):
        """启动 ChatManager"""
        logger.info('ChatManager started')

    async def stop(self):
        """停止 ChatManager，清理所有 Agent"""
        for chat_id, agent in list(self.agents.items()):
            try:
                # 增加超时时间，给 Windows 管道更多关闭时间
                await asyncio.wait_for(agent.destroy(), timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning('Agent destroy timeout', extra={'chat_id': chat_id})
            except Exception as e:
                logger.error('Error destroying agent', extra={
                    'chat_id': chat_id,
                    'error': str(e)
                })

        self.agents.clear()
        logger.info('ChatManager stopped')

    def on_response_complete(self, callback: Callable[[], None]):
        """注册响应完成回调"""
        self.response_complete_callback = callback

    def get_or_create_agent(self, chat_id: str) -> tuple[Agent, str | None]:
        """
        获取或创建 Agent

        Returns:
            (agent, expected_session_id): Agent 实例和期望的 session ID
        """
        agent = self.agents.get(chat_id)

        # 如果已存在，直接返回
        if agent:
            return agent, agent.get_session_id()

        # 创建新 Agent
        chat_data = self.chats.get(chat_id, {})
        cwd = chat_data.get('cwd', self.default_cwd)
        session_id = chat_data.get('session_id')

        # 定义消息开始处理回调
        async def on_message_start(message_id: str):
            # 移除旧 reaction
            if chat_id in self.current_reactions:
                old_message_id, old_reaction_id = self.current_reactions[chat_id]
                from src.services.message_service import message_service
                try:
                    message_service.remove_reaction(old_message_id, old_reaction_id)
                except Exception as e:
                    logger.warning('Failed to remove old reaction', extra={
                        'chat_id': chat_id,
                        'error': str(e)
                    })

            # 添加新 reaction
            from src.services.message_service import message_service
            try:
                reaction_id = message_service.add_reaction(message_id, 'Typing')
                self.current_reactions[chat_id] = (message_id, reaction_id)
                logger.debug('Added reaction', extra={
                    'chat_id': chat_id,
                    'message_id': message_id
                })
            except Exception as e:
                logger.warning('Failed to add reaction', extra={
                    'chat_id': chat_id,
                    'error': str(e)
                })

        # 定义响应回调
        async def on_response(response_text: str):
            # 移除 reaction
            if chat_id in self.current_reactions:
                message_id, reaction_id = self.current_reactions.pop(chat_id)
                from src.services.message_service import message_service
                try:
                    message_service.remove_reaction(message_id, reaction_id)
                except Exception as e:
                    logger.warning('Failed to remove reaction', extra={
                        'chat_id': chat_id,
                        'error': str(e)
                    })

            # 检查 session 是否变化（仅首次响应）
            chat_data = self.chats.get(chat_id, {})
            if not chat_data.get('session_notified', False):
                actual_session_id = agent.get_session_id()
                session_changed = actual_session_id != session_id

                # 生成通知消息
                notification = None
                if not session_id:
                    # 首次创建会话
                    notification = f'🆕 新会话: {agent.get_cwd()} ({actual_session_id})'
                elif session_changed:
                    # 恢复失败
                    notification = f'⚠️ 恢复失败，已创建新会话: {agent.get_cwd()} ({actual_session_id})'

                # 发送通知
                if notification:
                    from src.services.message_service import message_service
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
                self.chats[chat_id]['session_notified'] = True

            # 发送响应消息
            from src.services.message_service import message_service
            try:
                await message_service.send_text_message(chat_id, response_text)
            except Exception as e:
                logger.error('Failed to send response', extra={
                    'chat_id': chat_id,
                    'error': str(e)
                })

        try:
            agent = Agent(chat_id, cwd, session_id, on_message_start, on_response)
            self.agents[chat_id] = agent

            # 初始化 chat 数据（重置 session_notified）
            if chat_id not in self.chats:
                self.chats[chat_id] = {'cwd': cwd, 'session_id': session_id, 'session_notified': False}
            else:
                self.chats[chat_id]['session_notified'] = False

            # 返回期望的 session_id（用于后续对比）
            return agent, session_id
        except Exception as e:
            logger.error('Failed to create agent', extra={
                'chat_id': chat_id,
                'error': str(e)
            })
            raise RuntimeError(f'创建 Agent 失败: {e}')

    async def send_message(
        self,
        chat_id: str,
        message_id: str,
        text: str
    ):
        """
        发送消息

        Args:
            chat_id: 会话 ID
            message_id: 消息 ID
            text: 消息内容
        """
        agent, _ = self.get_or_create_agent(chat_id)

        try:
            # 调用 agent（消息入队，立即返回）
            await agent.send_message(message_id, text)

            # 更新 chat 数据中的 session_id
            if agent.session_id:
                if chat_id not in self.chats:
                    self.chats[chat_id] = {}
                self.chats[chat_id]['session_id'] = agent.session_id
                self.chats[chat_id]['cwd'] = agent.cwd

            # 触发回调
            if self.response_complete_callback:
                self.response_complete_callback()

        except asyncio.CancelledError:
            logger.info('Message processing cancelled', extra={'chat_id': chat_id})
            raise

        except Exception as e:
            logger.error('Error in send_message', extra={
                'chat_id': chat_id,
                'error': str(e)
            })
            raise

    async def interrupt(self, chat_id: str) -> str:
        """尝试中断当前任务"""
        agent = self.agents.get(chat_id)
        if not agent:
            return 'no_session'

        try:
            await asyncio.wait_for(agent.interrupt(), timeout=3.0)

            # 清理 reaction
            if chat_id in self.current_reactions:
                message_id, reaction_id = self.current_reactions.pop(chat_id)
                from src.services.message_service import message_service
                try:
                    message_service.remove_reaction(message_id, reaction_id)
                except Exception as e:
                    logger.warning('Failed to remove reaction after interrupt', extra={
                        'chat_id': chat_id,
                        'error': str(e)
                    })

            return 'success'
        except asyncio.TimeoutError:
            logger.warning('Interrupt timeout', extra={'chat_id': chat_id})
            return 'timeout'
        except Exception as e:
            logger.error('Interrupt failed', extra={
                'chat_id': chat_id,
                'error': str(e)
            })
            return 'error'

    async def reset(self, chat_id: str) -> str:
        """重置会话（强制清理）"""
        agent = self.agents.get(chat_id)

        if agent:
            try:
                await asyncio.wait_for(agent.destroy(), timeout=2.0)
            except asyncio.TimeoutError:
                logger.warning('Agent destroy timeout', extra={'chat_id': chat_id})
            except Exception as e:
                logger.error('Error destroying agent', extra={
                    'chat_id': chat_id,
                    'error': str(e)
                })

            # 强制清理
            self.agents.pop(chat_id, None)

        # 保留 cwd，清空 session_id 和通知标志
        cwd = self.chats.get(chat_id, {}).get('cwd', self.default_cwd)
        self.chats[chat_id] = {'cwd': cwd, 'session_id': None, 'session_notified': False}

        logger.info('Session reset', extra={'chat_id': chat_id})
        return cwd

    async def switch_cwd(self, chat_id: str, new_cwd: str):
        """切换工作目录（强制清理 Agent）"""
        current_cwd = self.chats.get(chat_id, {}).get('cwd', self.default_cwd)
        if current_cwd == new_cwd:
            logger.debug('Cwd unchanged', extra={
                'chat_id': chat_id,
                'cwd': new_cwd
            })
            return

        agent = self.agents.get(chat_id)
        if agent:
            try:
                await asyncio.wait_for(agent.destroy(), timeout=2.0)
            except asyncio.TimeoutError:
                logger.warning('Agent destroy timeout when switching cwd', extra={
                    'chat_id': chat_id
                })
            except Exception as e:
                logger.error('Error destroying agent when switching cwd', extra={
                    'chat_id': chat_id,
                    'error': str(e)
                })

            # 强制清理
            self.agents.pop(chat_id, None)

        # 更新 cwd，清空 session_id 和通知标志
        self.chats[chat_id] = {'cwd': new_cwd, 'session_id': None, 'session_notified': False}
        logger.info('Switched cwd', extra={
            'chat_id': chat_id,
            'new_cwd': new_cwd
        })

    def get_session_info(self, chat_id: str) -> str:
        """获取会话信息"""
        agent = self.agents.get(chat_id)
        chat_data = self.chats.get(chat_id, {})

        if not agent:
            cwd = chat_data.get('cwd', self.default_cwd)
            return f'当前没有活跃的会话\n工作目录: {cwd}'

        session_id = agent.get_session_id() or '无'
        cwd = agent.get_cwd()
        uptime = time.time() - agent.get_start_time()

        return (
            f'会话信息:\n'
            f'- Session ID: {session_id[:16]}...\n'
            f'- 工作目录: {cwd}\n'
            f'- 运行时长: {int(uptime)}秒'
        )

    def get_debug_info(self) -> str:
        """获取调试信息"""
        uptime = time.time() - self.start_time
        info = [
            '**系统状态**',
            f'- 运行时长: {int(uptime)}秒',
            f'- 活跃会话: {len(self.chats)}',
            f'- 活跃 Agent: {len(self.agents)}',
            '',
            '**会话列表**',
        ]

        for chat_id, data in self.chats.items():
            agent = self.agents.get(chat_id)
            session_id = data.get('session_id', '无')
            if session_id and session_id != '无':
                session_id = session_id[:8] + '...'

            if agent:
                agent_id = agent.get_agent_id()
                # 截断 agent_id，只保留前 12 个字符
                agent_id_short = agent_id[:12] + '...' if len(agent_id) > 12 else agent_id

                # 获取状态（优先显示更重要的状态）
                if not agent._connected:
                    status = '未连接'
                elif agent.is_busy():
                    status = '处理中'
                else:
                    status = '空闲'

                info.append(
                    f'- Chat: `{chat_id[:8]}...`\n'
                    f'  - Agent: {status} `{agent_id_short}`\n'
                    f'  - Session: `{session_id}`\n'
                    f'  - CWD: `{data.get("cwd", "N/A")}`'
                )
            else:
                info.append(
                    f'- Chat: `{chat_id[:8]}...`\n'
                    f'  - Agent: 未启动\n'
                    f'  - Session: `{session_id}`\n'
                    f'  - CWD: `{data.get("cwd", "N/A")}`'
                )

        return '\n'.join(info)


# 单例
chat_manager = ChatManager()
