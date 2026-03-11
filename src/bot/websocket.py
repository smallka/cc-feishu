import asyncio
import concurrent.futures
import logging
import threading
from typing import Awaitable, Callable, Optional

import lark_oapi as lark
import lark_oapi.ws.client as lark_ws_client_module

from src.config import config

logger = logging.getLogger(__name__)


class WebSocketManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        self.ws_client = None
        self.ws_thread = None
        self.event_loop = None
        self._stop_requested = threading.Event()
        self._thread_exit_future: Optional[asyncio.Future] = None

    async def start(self, event_handler: Callable[[lark.im.v1.P2ImMessageReceiveV1], Awaitable[None]]):
        """Start the Feishu WebSocket client in a background thread."""
        try:
            if self.ws_thread and self.ws_thread.is_alive():
                raise RuntimeError('WebSocket thread is already running')

            # 保存当前事件循环
            self.event_loop = asyncio.get_running_loop()
            self._thread_exit_future = self.event_loop.create_future()
            self._stop_requested.clear()

            def sync_handler(data: lark.im.v1.P2ImMessageReceiveV1):
                """Schedule the async handler back onto the main event loop."""
                try:
                    logger.info('Received WebSocket event', extra={
                        'event_type': type(data.event).__name__ if hasattr(data, 'event') else 'unknown'
                    })
                    asyncio.run_coroutine_threadsafe(
                        event_handler(data),
                        self.event_loop
                    )
                except Exception as e:
                    logger.error('Error scheduling event handler', extra={'error': str(e)})

            handler = lark.EventDispatcherHandler.builder("", "") \
                .register_p2_im_message_receive_v1(sync_handler) \
                .build()

            self.ws_client = lark.ws.Client(
                app_id=config.feishu.app_id,
                app_secret=config.feishu.app_secret,
                event_handler=handler,
                auto_reconnect=False,
            )
            client = self.ws_client

            def notify_thread_exit(error: Exception | None = None):
                if not self.event_loop or not self._thread_exit_future:
                    return

                def resolve_future():
                    if not self._thread_exit_future or self._thread_exit_future.done():
                        return
                    if error is None:
                        self._thread_exit_future.set_result(None)
                    else:
                        self._thread_exit_future.set_exception(error)

                self.event_loop.call_soon_threadsafe(resolve_future)

            def run_websocket():
                thread_error = None
                try:
                    logger.info('WebSocket thread started')
                    client.start()
                    if self._stop_requested.is_set():
                        logger.info('WebSocket thread exited after stop request')
                    else:
                        logger.error('WebSocket connection closed unexpectedly')
                        thread_error = ConnectionError('WebSocket connection closed unexpectedly')
                except RuntimeError as e:
                    if self._stop_requested.is_set() and 'Event loop stopped before Future completed' in str(e):
                        logger.info('WebSocket loop stopped')
                    else:
                        thread_error = e
                        logger.error('WebSocket thread error', extra={'error': str(e)})
                except Exception as e:
                    if self._stop_requested.is_set():
                        logger.info('WebSocket thread exited during shutdown', extra={'error': str(e)})
                    else:
                        thread_error = e
                        logger.error('WebSocket thread error', extra={'error': str(e)})
                finally:
                    notify_thread_exit(thread_error)

            self.ws_thread = threading.Thread(target=run_websocket, daemon=True)
            self.ws_thread.start()

            logger.info('WebSocket connection started in background thread')
            await self._thread_exit_future

        except Exception as e:
            logger.error('WebSocket error', extra={'error': str(e)})
            raise

    def _stop_ws_loop(self):
        """Cancel lark WebSocket loop tasks and stop its event loop."""
        loop = getattr(lark_ws_client_module, 'loop', None)
        if loop is None or loop.is_closed():
            return

        def stop_loop():
            current_task = asyncio.current_task()
            tasks = [task for task in asyncio.all_tasks() if task is not current_task]
            for task in tasks:
                task.cancel()
            loop.stop()

        loop.call_soon_threadsafe(stop_loop)

    async def stop(self):
        """Stop the WebSocket client and wait for its thread to exit."""
        client = self.ws_client
        thread = self.ws_thread

        if not client and not thread:
            return

        self._stop_requested.set()
        logger.info('WebSocket stopping')

        loop = getattr(lark_ws_client_module, 'loop', None)
        if client and loop and not loop.is_closed():
            try:
                if loop.is_running():
                    disconnect_future = asyncio.run_coroutine_threadsafe(client._disconnect(), loop)
                    disconnect_future.result(timeout=5.0)
                    self._stop_ws_loop()
                elif client._conn is not None:
                    await client._disconnect()
            except concurrent.futures.TimeoutError:
                logger.warning('WebSocket disconnect timeout')
            except Exception as e:
                logger.warning('Error stopping WebSocket', extra={'error': str(e)})

        if thread and thread.is_alive():
            await asyncio.to_thread(thread.join, 5.0)
            if thread.is_alive():
                logger.warning('WebSocket thread did not stop in time')

        if self._thread_exit_future and not self._thread_exit_future.done():
            self._thread_exit_future.set_result(None)

        self.ws_client = None
        self.ws_thread = None


# 单例
websocket_manager = WebSocketManager()
