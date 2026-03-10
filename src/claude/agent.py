"""Agent 类：封装单个 Claude Code CLI 会话"""
import asyncio
import time
import logging
from typing import Optional, Callable, Awaitable

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AssistantMessage, ResultMessage, TextBlock

logger = logging.getLogger(__name__)

_agent_counter = 0


def next_agent_id(chat_id: str) -> str:
    """生成唯一的 agent ID"""
    global _agent_counter
    _agent_counter += 1
    return f"agent{_agent_counter}_{chat_id}"


class Agent:
    """封装单个 Claude Code CLI 会话"""

    def __init__(
        self,
        chat_id: str,
        cwd: str,
        resume_session_id: Optional[str],
        on_response: Callable[[str], Awaitable[None]]
    ):
        """
        创建 Agent 实例

        Args:
            chat_id: 飞书 chat ID
            cwd: 工作目录
            resume_session_id: 要恢复的 session ID（可选）
            on_response: 响应回调函数，接收响应文本
        """
        self.agent_id = next_agent_id(chat_id)
        self.chat_id = chat_id
        self.cwd = cwd
        self.session_id = resume_session_id
        self.start_time = time.time()
        self._connected = False
        self._is_busy = False  # 是否正在处理消息
        self.on_response = on_response

        # 消息队列
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._processing_task: Optional[asyncio.Task] = None

        # 创建 SDK 客户端
        from src.config import config
        options = ClaudeAgentOptions(
            cwd=cwd,
            resume=resume_session_id,
            permission_mode='bypassPermissions',
            model=config.claude.model,
        )
        self.client = ClaudeSDKClient(options=options)

        logger.info('Agent created', extra={
            'agent_id': self.agent_id,
            'cwd': cwd,
            'resume_session_id': resume_session_id,
        })

    async def ensure_connected(self):
        """确保已连接（懒加载）"""
        if not self._connected:
            # 清除 CLAUDECODE 环境变量防止嵌套检测
            import os
            original_claudecode = os.environ.get('CLAUDECODE')
            if 'CLAUDECODE' in os.environ:
                del os.environ['CLAUDECODE']

            try:
                await asyncio.wait_for(
                    self.client.connect(),
                    timeout=10.0
                )
                self._connected = True
                logger.info('Agent connected', extra={'agent_id': self.agent_id})
            except asyncio.TimeoutError:
                raise ConnectionError('连接 Claude CLI 超时')
            except Exception as e:
                raise ConnectionError(f'连接 Claude CLI 失败: {e}')
            finally:
                # 恢复环境变量
                if original_claudecode is not None:
                    os.environ['CLAUDECODE'] = original_claudecode

    def is_busy(self) -> bool:
        """检查是否正在处理消息"""
        return self._is_busy

    async def send_message(self, text: str):
        """
        发送消息（入队，立即返回）

        Args:
            text: 消息内容
        """
        await self._message_queue.put(text)

        # 启动处理任务（如果未启动）
        if self._processing_task is None or self._processing_task.done():
            self._processing_task = asyncio.create_task(self._process_queue())

    async def _process_queue(self):
        """后台任务：循环处理队列"""
        while True:
            try:
                text = await self._message_queue.get()
                await self._handle_message(text)
            except asyncio.CancelledError:
                logger.info('Queue processing cancelled', extra={'agent_id': self.agent_id})
                break
            except Exception as e:
                logger.error('Error processing message', extra={
                    'agent_id': self.agent_id,
                    'error': str(e)
                })

    async def _handle_message(self, text: str):
        """实际处理单条消息"""
        self._is_busy = True

        try:
            await self.ensure_connected()

            response_parts = []

            logger.info('Sending message to CLI', extra={
                'agent_id': self.agent_id,
                'text_length': len(text)
            })

            try:
                await self.client.query(text)
                async for msg in self.client.receive_response():
                    if isinstance(msg, AssistantMessage):
                        for block in msg.content:
                            if isinstance(block, TextBlock):
                                response_parts.append(block.text)

                    elif isinstance(msg, ResultMessage):
                        if msg.session_id:
                            self.session_id = msg.session_id
                            logger.info('Session ID updated', extra={
                                'agent_id': self.agent_id,
                                'session_id': msg.session_id
                            })

            except asyncio.CancelledError:
                logger.info('Message processing cancelled', extra={
                    'agent_id': self.agent_id
                })
                raise

            # 调用回调
            full_response = ''.join(response_parts)
            if full_response.strip():
                logger.info('Invoking response callback', extra={
                    'agent_id': self.agent_id,
                    'response_length': len(full_response)
                })
                await self.on_response(full_response)
            else:
                logger.warning('Empty response from CLI', extra={
                    'agent_id': self.agent_id
                })

        finally:
            self._is_busy = False
            logger.debug('Agent no longer busy', extra={'agent_id': self.agent_id})

    async def interrupt(self):
        """中断当前操作并清空队列"""
        logger.info('Interrupt requested', extra={'agent_id': self.agent_id})

        # 清空队列
        cleared = 0
        while not self._message_queue.empty():
            try:
                self._message_queue.get_nowait()
                cleared += 1
            except asyncio.QueueEmpty:
                break

        if cleared > 0:
            logger.info('Cleared message queue', extra={
                'agent_id': self.agent_id,
                'cleared_count': cleared
            })

        # 中断当前任务
        try:
            await self.client.interrupt()
        except Exception as e:
            logger.error('Error sending interrupt', extra={
                'agent_id': self.agent_id,
                'error': str(e)
            })
            raise

    async def destroy(self):
        """销毁 Agent（尽力优雅关闭）"""
        logger.info('Destroying agent', extra={'agent_id': self.agent_id})

        # 取消处理任务
        if self._processing_task and not self._processing_task.done():
            self._processing_task.cancel()
            try:
                await self._processing_task
            except asyncio.CancelledError:
                pass

        try:
            await self.client.disconnect()
        except Exception as e:
            logger.error('Error disconnecting client', extra={
                'agent_id': self.agent_id,
                'error': str(e)
            })

    def get_agent_id(self) -> str:
        """获取 agent ID"""
        return self.agent_id

    def get_cwd(self) -> str:
        """获取工作目录"""
        return self.cwd

    def get_session_id(self) -> Optional[str]:
        """获取 session ID"""
        return self.session_id

    def get_start_time(self) -> float:
        """获取启动时间"""
        return self.start_time
