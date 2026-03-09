"""ChatManager：管理 Chat → Agent 映射"""
from typing import Dict, Optional, Callable
import asyncio
import time
import logging
from src.claude.agent import Agent
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

logger = logging.getLogger(__name__)


class ChatManager:
    """管理多个 Chat 的 Agent 实例"""

    def __init__(self):
        from src.config import config
        self.chats: Dict[str, dict] = {}  # chat_id -> {cwd, session_id}
        self.agents: Dict[str, Agent] = {}  # chat_id -> Agent
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
                await asyncio.wait_for(agent.destroy(), timeout=2.0)
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

    def get_or_create_agent(self, chat_id: str) -> Agent:
        """获取或创建 Agent"""
        agent = self.agents.get(chat_id)

        # 检查是否存活
        if agent and agent.client:
            return agent
        elif agent:
            # Agent 已损坏，清理
            logger.warning('Agent damaged, cleaning up', extra={'chat_id': chat_id})
            self.agents.pop(chat_id, None)

        # 创建新 Agent
        chat_data = self.chats.get(chat_id, {})
        cwd = chat_data.get('cwd', self.default_cwd)
        session_id = chat_data.get('session_id')

        try:
            agent = Agent(chat_id, cwd, session_id)
            self.agents[chat_id] = agent

            # 初始化 chat 数据
            if chat_id not in self.chats:
                self.chats[chat_id] = {'cwd': cwd, 'session_id': session_id}

            return agent
        except Exception as e:
            logger.error('Failed to create agent', extra={
                'chat_id': chat_id,
                'error': str(e)
            })
            raise RuntimeError(f'创建 Agent 失败: {e}')

    async def send_message(self, chat_id: str, text: str):
        """发送消息并等待响应（会阻塞）"""
        agent = self.get_or_create_agent(chat_id)

        try:
            await agent.ensure_connected()
            await agent.client.query(text)

            collected_text = []
            async for msg in agent.client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            collected_text.append(block.text)

                elif isinstance(msg, ResultMessage):
                    # 更新 session_id
                    agent.session_id = msg.session_id
                    if chat_id not in self.chats:
                        self.chats[chat_id] = {}
                    self.chats[chat_id]['session_id'] = msg.session_id
                    self.chats[chat_id]['cwd'] = agent.cwd

                    # 发送完整响应
                    full_text = ''.join(collected_text)
                    await self._send_response(chat_id, full_text)

                    # 触发回调
                    if self.response_complete_callback:
                        self.response_complete_callback()
                    break

        except ConnectionError as e:
            await self._send_response(chat_id, f'❌ {e}\n提示：使用 /new 重置会话')
            raise

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
            await asyncio.wait_for(agent.client.interrupt(), timeout=3.0)
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

        # 保留 cwd，清空 session_id
        cwd = self.chats.get(chat_id, {}).get('cwd', self.default_cwd)
        self.chats[chat_id] = {'cwd': cwd, 'session_id': None}

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

        # 更新 cwd，清空 session_id
        self.chats[chat_id] = {'cwd': new_cwd, 'session_id': None}
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
            agent_status = '运行中' if agent else '未启动'
            session_id = data.get('session_id', '无')
            if session_id and session_id != '无':
                session_id = session_id[:8] + '...'

            info.append(
                f'- Chat: `{chat_id[:8]}...`\n'
                f'  - Agent: {agent_status}\n'
                f'  - Session: `{session_id}`\n'
                f'  - CWD: `{data.get("cwd", "N/A")}`'
            )

        return '\n'.join(info)

    async def _send_response(self, chat_id: str, text: str):
        """发送响应到飞书"""
        from src.services.message_service import message_service

        if not text.strip():
            logger.warning('Empty response, skipping', extra={'chat_id': chat_id})
            return

        logger.info('Sending response', extra={
            'chat_id': chat_id,
            'text_length': len(text)
        })

        try:
            # 优先使用卡片消息（支持 Markdown）
            await message_service.send_card_message(chat_id, text)
            logger.info('Response sent successfully', extra={'chat_id': chat_id})
        except Exception as e:
            logger.error('Failed to send card message', extra={
                'chat_id': chat_id,
                'error': str(e)
            })
            # 降级到纯文本
            try:
                await message_service.send_text_message(chat_id, text)
                logger.warning('Fallback to text message', extra={'chat_id': chat_id})
            except Exception as e2:
                logger.error('Failed to send fallback text message', extra={
                    'chat_id': chat_id,
                    'error': str(e2)
                })


# 单例
chat_manager = ChatManager()
