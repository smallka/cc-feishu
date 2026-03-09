"""最小化测试"""
import lark_oapi as lark
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
import os
from dotenv import load_dotenv

load_dotenv()

print("Step 1: 创建处理器")
def handler(data: P2ImMessageReceiveV1):
    print(f"\n>>> 收到消息！类型: {type(data)}\n")

print("Step 2: 注册事件")
event_handler = EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(handler).build()
print(f"  - event_handler 类型: {type(event_handler)}")
print(f"  - processor map: {list(event_handler._processorMap.keys())}")

print("Step 3: 创建 WebSocket 客户端")
client = lark.ws.Client(
    app_id=os.getenv('FEISHU_APP_ID'),
    app_secret=os.getenv('FEISHU_APP_SECRET'),
    event_handler=event_handler,
    log_level=lark.LogLevel.DEBUG,
)
print(f"  - client._event_handler: {client._event_handler}")
print(f"  - 是否为 None: {client._event_handler is None}")

if client._event_handler:
    print(f"  - client._event_handler._processorMap: {list(client._event_handler._processorMap.keys())}")

print("\nStep 4: 启动连接")
print("请发送消息测试...\n")

try:
    client.start()
except KeyboardInterrupt:
    print("\n程序被中断")
