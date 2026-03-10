"""消息发送服务"""
import lark_oapi as lark
from lark_oapi.api.im.v1 import *
import logging
import json
from src.bot.client import feishu_client

logger = logging.getLogger(__name__)


class MessageService:
    """消息发送服务"""

    def add_reaction(self, message_id: str, emoji_type: str) -> str | None:
        """添加消息表情反应"""
        try:
            client = feishu_client.get_client()
            request = CreateMessageReactionRequest.builder() \
                .message_id(message_id) \
                .request_body(CreateMessageReactionRequestBody.builder()
                    .reaction_type(Emoji.builder()
                        .emoji_type(emoji_type)
                        .build())
                    .build()) \
                .build()

            response = client.im.v1.message_reaction.create(request)

            if not response.success():
                logger.warning(f'Failed to add reaction: code={response.code}, msg={response.msg}', extra={
                    'message_id': message_id,
                    'code': response.code,
                    'msg': response.msg
                })
                return None

            return response.data.reaction_id

        except Exception as e:
            logger.warning(f'Failed to add reaction: {str(e)}', extra={
                'message_id': message_id,
                'error': str(e),
                'error_type': type(e).__name__
            })
            return None

    def remove_reaction(self, message_id: str, reaction_id: str):
        """移除消息表情反应"""
        try:
            client = feishu_client.get_client()
            request = DeleteMessageReactionRequest.builder() \
                .message_id(message_id) \
                .reaction_id(reaction_id) \
                .build()

            response = client.im.v1.message_reaction.delete(request)

            if not response.success():
                logger.warning('Failed to remove reaction', extra={
                    'message_id': message_id,
                    'reaction_id': reaction_id,
                    'code': response.code
                })

        except Exception as e:
            logger.warning('Failed to remove reaction', extra={
                'message_id': message_id,
                'error': str(e)
            })

    async def send_text_message(self, chat_id: str, text: str):
        """发送文本消息"""
        try:
            client = feishu_client.get_client()
            request = CreateMessageRequest.builder() \
                .receive_id_type('chat_id') \
                .request_body(CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type('text')
                    .content(json.dumps({'text': text}))
                    .build()) \
                .build()

            response = client.im.v1.message.create(request)

            if not response.success():
                logger.error('Failed to send text message', extra={
                    'chat_id': chat_id,
                    'code': response.code,
                    'msg': response.msg
                })
                raise Exception(f'发送消息失败: {response.msg}')

            logger.info('Text message sent', extra={'chat_id': chat_id})

        except Exception as e:
            logger.error('Failed to send text message', extra={
                'chat_id': chat_id,
                'error': str(e)
            })
            raise

    async def send_card_message(self, chat_id: str, markdown: str):
        """发送 Markdown 卡片消息"""
        try:
            client = feishu_client.get_client()

            card_content = {
                'config': {'wide_screen_mode': True},
                'elements': [
                    {'tag': 'markdown', 'content': markdown}
                ]
            }

            request = CreateMessageRequest.builder() \
                .receive_id_type('chat_id') \
                .request_body(CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type('interactive')
                    .content(json.dumps(card_content))
                    .build()) \
                .build()

            response = client.im.v1.message.create(request)

            if not response.success():
                logger.error('Failed to send card message', extra={
                    'chat_id': chat_id,
                    'code': response.code,
                    'msg': response.msg
                })
                raise Exception(f'发送卡片消息失败: {response.msg}')

            logger.info('Card message sent', extra={
                'chat_id': chat_id,
                'content_length': len(markdown)
            })

        except Exception as e:
            logger.error('Failed to send card message', extra={
                'chat_id': chat_id,
                'error': str(e)
            })
            raise


# 单例
message_service = MessageService()
