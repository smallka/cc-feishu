"""Logging helpers."""
import json
import logging
import sys
from typing import Any


_BASE_LOG_RECORD_KEYS = set(logging.makeLogRecord({}).__dict__.keys())


class JsonFormatter(logging.Formatter):
    """JSON formatter that preserves structured fields from `extra`."""

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        extra_fields = getattr(record, "extra_fields", None)
        if isinstance(extra_fields, dict):
            log_data.update(extra_fields)

        for key, value in record.__dict__.items():
            if key in _BASE_LOG_RECORD_KEYS or key == "extra_fields":
                continue
            log_data[key] = value

        return json.dumps(log_data, ensure_ascii=False)


def setup_logger(level: str = "INFO") -> logging.Logger:
    """Configure the root logger once for the whole application."""
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root_logger.handlers.clear()
    root_logger.addHandler(handler)

    return root_logger


class StructuredLogger(logging.LoggerAdapter):
    """Adapter that stores `extra` fields under a single record key."""

    def process(self, msg: str, kwargs: Any) -> tuple[str, Any]:
        extra = kwargs.get("extra", {})
        if extra:
            kwargs["extra"] = {"extra_fields": extra}
        return msg, kwargs
