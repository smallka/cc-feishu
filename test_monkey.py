"""Monkey patch 调试"""
import lark_oapi as lark
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
import os
from dotenv import load_dotenv

load_dotenv()

# Monkey patch do_without_validation
original_do = EventDispatcherHandler.do_without_validation

def patched_do(self, payload):
    print(f"\n>>> do_without_validation 被调用！")
    print(f">>> payload 长度: {len(payload)}")
    try:
        result = original_do(self, payload)
        print(f">>> 返回结果: {result}")
        return result
    except Exception as e:
        print(f">>> 异常: {e}")
        import traceback
        traceback.print_exc()
        raise

EventDispatcherHandler.do_without_validation = patched_do

print("Monkey patch 已应用")

# 创建处理器
def handler(data: P2ImMessageReceiveV1):
    print(f"\n>>> 用户处理器被调用！\n")

event_handler = EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(handler).build()

# 创建客户端
client = lark.ws.Client(
    app_id=os.getenv('FEISHU_APP_ID'),
    app_secret=os.getenv('FEISHU_APP_SECRET'),
    event_handler=event_handler,
    log_level=lark.LogLevel.DEBUG,
)

print(f"客户端创建完成，event_handler: {client._event_handler is not None}")
print("请发送消息...\n")

try:
    client.start()
except KeyboardInterrupt:
    print("\n程序被中断")
