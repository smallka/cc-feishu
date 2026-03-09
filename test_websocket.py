"""测试 WebSocket 连接和事件接收"""
import lark_oapi as lark
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
import os
from dotenv import load_dotenv
import time

load_dotenv()

def message_handler(data: P2ImMessageReceiveV1):
    """消息处理器"""
    try:
        print(f"\n{'='*50}")
        print(f"收到消息事件！")
        print(f"数据类型: {type(data)}")
        print(f"属性列表: {[attr for attr in dir(data) if not attr.startswith('_')]}")

        if hasattr(data, 'event'):
            event = data.event
            print(f"Event 类型: {type(event)}")
            if hasattr(event, 'message'):
                msg = event.message
                print(f"Message ID: {msg.message_id}")
                print(f"Chat ID: {msg.chat_id}")
                print(f"Message Type: {msg.message_type}")
                print(f"Content: {msg.content}")
        print(f"{'='*50}\n")
    except Exception as e:
        print(f"处理器错误: {e}")
        import traceback
        traceback.print_exc()

# 创建事件处理器
print("开始创建事件处理器...")
handler = EventDispatcherHandler.builder("", "") \
    .register_p2_im_message_receive_v1(message_handler) \
    .build()

print("事件处理器创建成功")
print(f"Handler type: {type(handler)}")
print(f"Processor map keys: {list(handler._processorMap.keys()) if hasattr(handler, '_processorMap') else 'N/A'}")

# 创建 WebSocket 客户端
client = lark.ws.Client(
    app_id=os.getenv('FEISHU_APP_ID'),
    app_secret=os.getenv('FEISHU_APP_SECRET'),
    event_handler=handler,
    log_level=lark.LogLevel.DEBUG,
)

print(f"WebSocket 客户端创建成功")
print(f"Client event_handler: {client._event_handler}")
print(f"Event handler is None: {client._event_handler is None}")
print(f"App ID: {os.getenv('FEISHU_APP_ID')}")
print(f"开始连接...")
print(f"请在飞书中发送消息测试\n")

try:
    client.start()
except KeyboardInterrupt:
    print("\n\n程序被中断")
except Exception as e:
    print(f"\n\n错误: {e}")
    import traceback
    traceback.print_exc()
