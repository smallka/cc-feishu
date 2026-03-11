"""Logger setup tests."""
import json
import logging

from src.utils.logger import setup_logger


def test_setup_logger_configures_root_json_logging(capsys):
    """Root logger should emit JSON and keep structured extra fields."""
    root = setup_logger("INFO")
    logger = logging.getLogger("test.logger")

    logger.info("hello", extra={"chat_id": "chat-1", "attempt": 2})

    captured = capsys.readouterr()
    payload = json.loads(captured.out.strip())

    assert root is logging.getLogger()
    assert payload["level"] == "INFO"
    assert payload["logger"] == "test.logger"
    assert payload["message"] == "hello"
    assert payload["chat_id"] == "chat-1"
    assert payload["attempt"] == 2
