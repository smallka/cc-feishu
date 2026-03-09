"""配置模块"""
import os
from dataclasses import dataclass
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()


@dataclass
class FeishuConfig:
    """飞书配置"""
    app_id: str
    app_secret: str


@dataclass
class ClaudeConfig:
    """Claude 配置"""
    work_root: str
    model: str


@dataclass
class Config:
    """应用配置"""
    feishu: FeishuConfig
    claude: ClaudeConfig
    message_timeout: int  # 毫秒
    log_level: str


def load_config() -> Config:
    """加载配置"""
    # 验证必需配置
    app_id = os.getenv('FEISHU_APP_ID')
    app_secret = os.getenv('FEISHU_APP_SECRET')

    if not app_id or not app_secret:
        raise ValueError('Missing required config: FEISHU_APP_ID and FEISHU_APP_SECRET')

    # 加载配置
    feishu = FeishuConfig(
        app_id=app_id,
        app_secret=app_secret,
    )

    claude = ClaudeConfig(
        work_root=os.getenv('CLAUDE_WORK_ROOT', os.getcwd()),
        model=os.getenv('CLAUDE_MODEL', 'claude-opus-4-6'),
    )

    return Config(
        feishu=feishu,
        claude=claude,
        message_timeout=int(os.getenv('MESSAGE_TIMEOUT', '300000')),
        log_level=os.getenv('LOG_LEVEL', 'INFO'),
    )


# 全局配置实例
config = load_config()
