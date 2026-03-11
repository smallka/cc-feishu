"""Main entry point."""
import asyncio
import logging
import signal
import sys

from src.bot.chat_manager import chat_manager
from src.bot.websocket import websocket_manager
from src.config import config
from src.handlers.message_handler import handle_message
from src.utils.logger import setup_logger

logger = logging.getLogger(__name__)

shutdown_event = asyncio.Event()


def handle_signal(signum, frame):
    """Handle process signals."""
    logger.info("Received signal", extra={"signal": signum})
    shutdown_event.set()


async def main():
    """Run the application."""
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        logger.info(
            "Application starting",
            extra={
                "config": {
                    "work_root": config.claude.work_root,
                    "model": config.claude.model,
                    "message_timeout": config.message_timeout,
                }
            },
        )

        await chat_manager.start()

        websocket_task = asyncio.create_task(websocket_manager.start(handle_message))
        shutdown_task = asyncio.create_task(shutdown_event.wait())

        done, pending = await asyncio.wait(
            [websocket_task, shutdown_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        if shutdown_task in done:
            logger.info("Shutdown signal received, exiting gracefully")
            await websocket_manager.stop()
            await asyncio.gather(websocket_task, return_exceptions=True)
        else:
            await websocket_task

    except Exception as e:
        logger.error("Fatal error", extra={"error": str(e)})
        sys.exit(1)
    finally:
        logger.info("Shutting down")
        await chat_manager.stop()
        await websocket_manager.stop()

        await asyncio.sleep(0.5)

        logger.info("Application stopped")


if __name__ == "__main__":
    import platform
    import warnings

    if platform.system() == "Windows":
        warnings.filterwarnings("ignore", category=ResourceWarning)

    setup_logger(config.log_level)
    asyncio.run(main())
