"""飞书客户端"""
import lark_oapi as lark
import logging
from src.config import config

logger = logging.getLogger(__name__)


class FeishuClient:
    """飞书客户端封装"""

    def __init__(self):
        self.client = lark.Client.builder() \
            .app_id(config.feishu.app_id) \
            .app_secret(config.feishu.app_secret) \
            .build()

        logger.info('Feishu client initialized', extra={
            'app_id': config.feishu.app_id
        })

    def get_client(self) -> lark.Client:
        """获取飞书客户端实例"""
        return self.client


# 单例
feishu_client = FeishuClient()
