"""Agent 类：封装单个 Claude Code CLI 会话"""
import asyncio
import time
import logging
from typing import Optional

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

logger = logging.getLogger(__name__)

_agent_counter = 0


def next_agent_id() -> str:
    """生成唯一的 agent ID"""
    global _agent_counter
    _agent_counter += 1
    return f"agent{_agent_counter}"


class Agent:
    """封装单个 Claude Code CLI 会话"""

    def __init__(self, chat_id: str, cwd: str, resume_session_id: Optional[str]):
        """
        创建 Agent 实例

        Args:
            chat_id: 飞书 chat ID
            cwd: 工作目录
            resume_session_id: 要恢复的 session ID（可选）
        """
        self.agent_id = next_agent_id()
        self.chat_id = chat_id
        self.cwd = cwd
        self.session_id = resume_session_id
        self.start_time = time.time()
        self._connected = False

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
            'chat_id': chat_id,
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

    async def destroy(self):
        """销毁 Agent（尽力优雅关闭）"""
        logger.info('Destroying agent', extra={'agent_id': self.agent_id})
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
