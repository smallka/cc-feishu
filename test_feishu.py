"""测试飞书集成"""
import asyncio
from src.services.message_service import message_service
from src.bot.client import feishu_client
from src.utils.logger import logger


async def test_message_service():
    """测试消息服务"""
    # 注意：需要一个真实的 chat_id 才能发送消息
    # 这里只是测试客户端初始化

    logger.info('Testing Feishu client initialization')
    client = feishu_client.get_client()
    logger.info('Feishu client initialized successfully', extra={
        'client_type': type(client).__name__
    })

    logger.info('Message service is ready')

    # 如果你有一个测试 chat_id，可以取消注释下面的代码
    # test_chat_id = "oc_xxx"  # 替换为真实的 chat_id
    # await message_service.send_text_message(test_chat_id, "测试消息")
    # logger.info('Test message sent')


if __name__ == '__main__':
    asyncio.run(test_message_service())
