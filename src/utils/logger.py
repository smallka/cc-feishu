"""日志模块"""
import logging
import json
import sys
from typing import Any


class JsonFormatter(logging.Formatter):
    """JSON 格式化器"""

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            'timestamp': self.formatTime(record, self.datefmt),
            'level': record.levelname,
            'message': record.getMessage(),
        }

        # 添加额外字段
        if hasattr(record, 'extra_fields'):
            log_data.update(record.extra_fields)

        return json.dumps(log_data, ensure_ascii=False)


def setup_logger(name: str = 'cc-feishu', level: str = 'INFO') -> logging.Logger:
    """设置日志器"""
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper()))

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    # Console handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)

    return logger


# 自定义 LoggerAdapter 支持结构化字段
class StructuredLogger(logging.LoggerAdapter):
    """支持结构化字段的日志适配器"""

    def process(self, msg: str, kwargs: Any) -> tuple[str, Any]:
        extra = kwargs.get('extra', {})
        if extra:
            # 将 extra 字段存储到 record
            kwargs['extra'] = {'extra_fields': extra}
        return msg, kwargs


# 全局日志实例
from src.config import config
_logger = setup_logger(level=config.log_level)
logger = StructuredLogger(_logger, {})
