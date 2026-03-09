"""WebSocket 连接管理"""
import lark_oapi as lark
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
import logging
import asyncio
import sys
import threading
from typing import Callable, Awaitable
from src.config import config

logger = logging.getLogger(__name__)


class WebSocketManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        self.ws_client = None
        self.ws_thread = None
        self.event_loop = None

    async def start(self, event_handler: Callable[[P2ImMessageReceiveV1], Awaitable[None]]):
        """启动 WebSocket 连接"""
        try:
            # 保存当前事件循环
            self.event_loop = asyncio.get_event_loop()

            # 创建事件处理器（使用同步包装）
            def sync_handler(data: P2ImMessageReceiveV1):
                """同步包装器，将异步处理器调度到主事件循环"""
                try:
                    logger.info('Received WebSocket event', extra={
                        'event_type': type(data.event).__name__ if hasattr(data, 'event') else 'unknown'
                    })
                    # 在主事件循环中调度异步任务
                    asyncio.run_coroutine_threadsafe(
                        event_handler(data),
                        self.event_loop
                    )
                except Exception as e:
                    logger.error('Error scheduling event handler', extra={'error': str(e)})

            # 使用 lark.EventDispatcherHandler 而不是直接导入
            handler = lark.EventDispatcherHandler.builder("", "") \
                .register_p2_im_message_receive_v1(sync_handler) \
                .build()

            # 创建 WebSocket 客户端
            self.ws_client = lark.ws.Client(
                app_id=config.feishu.app_id,
                app_secret=config.feishu.app_secret,
                event_handler=handler,
            )

            # 在单独线程中启动 WebSocket（因为 start() 是阻塞的）
            def run_websocket():
                try:
                    logger.info('WebSocket thread started')
                    self.ws_client.start()
                    logger.error('WebSocket connection closed unexpectedly')
                except Exception as e:
                    logger.error('WebSocket thread error', extra={'error': str(e)})

            self.ws_thread = threading.Thread(target=run_websocket, daemon=True)
            self.ws_thread.start()

            logger.info('WebSocket connection started in background thread')

            # 保持主协程运行
            while True:
                await asyncio.sleep(1)

        except Exception as e:
            logger.error('WebSocket error', extra={'error': str(e)})
            raise

    async def stop(self):
        """停止 WebSocket 连接"""
        if self.ws_client:
            try:
                logger.info('WebSocket stopping')
                # WebSocket Client 没有提供 stop() 方法，只能等待线程结束
            except Exception as e:
                logger.error('Error stopping WebSocket', extra={'error': str(e)})

            self.ws_client = None


# 单例
websocket_manager = WebSocketManager()
