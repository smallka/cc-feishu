"""Application configuration."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path.cwd() / ".env")


@dataclass
class FeishuConfig:
    """Feishu configuration."""

    app_id: str
    app_secret: str


@dataclass
class ClaudeConfig:
    """Claude configuration."""

    work_root: str
    model: str


@dataclass
class Config:
    """Application configuration."""

    feishu: FeishuConfig
    claude: ClaudeConfig
    message_timeout: int
    log_level: str


def load_config() -> Config:
    """Load configuration from environment variables."""

    app_id = os.getenv("FEISHU_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET")

    if not app_id or not app_secret:
        raise ValueError("Missing required config: FEISHU_APP_ID and FEISHU_APP_SECRET")

    feishu = FeishuConfig(
        app_id=app_id,
        app_secret=app_secret,
    )

    claude = ClaudeConfig(
        work_root=os.getenv("CLAUDE_WORK_ROOT", os.getcwd()),
        model=os.getenv("CLAUDE_MODEL", "claude-opus-4-6"),
    )

    return Config(
        feishu=feishu,
        claude=claude,
        message_timeout=int(os.getenv("MESSAGE_TIMEOUT", "300000")),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
    )


config = load_config()
