"""主入口"""
import asyncio
import signal
import sys
import logging
from src.config import config
from src.utils.logger import setup_logger
from src.bot.chat_manager import chat_manager
from src.bot.websocket import websocket_manager
from src.handlers.message_handler import handle_message

logger = logging.getLogger(__name__)

# 全局标志，用于优雅关闭
shutdown_event = asyncio.Event()


def handle_signal(signum, frame):
    """处理系统信号"""
    logger.info('Received signal', extra={'signal': signum})
    shutdown_event.set()


async def main():
    """主入口"""
    # 注册信号处理器
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        logger.info('Application starting', extra={
            'config': {
                'work_root': config.claude.work_root,
                'model': config.claude.model,
                'message_timeout': config.message_timeout
            }
        })

        # 启动 ChatManager
        await chat_manager.start()

        # 启动 WebSocket（会阻塞到断开）
        websocket_task = asyncio.create_task(websocket_manager.start(handle_message))
        shutdown_task = asyncio.create_task(shutdown_event.wait())

        # 等待 WebSocket 断开或收到关闭信号
        done, pending = await asyncio.wait(
            [websocket_task, shutdown_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        # 取消未完成的任务
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # 检查是哪个任务完成了
        if websocket_task in done:
            logger.error('WebSocket disconnected, exiting')
            sys.exit(1)
        else:
            logger.info('Shutdown signal received, exiting gracefully')

    except Exception as e:
        logger.error('Fatal error', extra={'error': str(e)})
        sys.exit(1)
    finally:
        logger.info('Shutting down')
        await chat_manager.stop()
        await websocket_manager.stop()
        logger.info('Application stopped')


if __name__ == '__main__':
    setup_logger(level=config.log_level)
    asyncio.run(main())
