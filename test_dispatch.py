"""测试事件分发逻辑"""
import json
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
from lark_oapi.event.dispatcher_handler import EventDispatcherHandler

# 模拟的 payload（从之前的日志中复制）
payload_str = '{"schema":"2.0","header":{"event_id":"c1dbd586beebd4dc107fea87b9026ee7","token":"","create_time":"1773066971207","event_type":"im.message.receive_v1","tenant_key":"1424b73fd71dd75d","app_id":"cli_a91ab8424ab85cc0"},"event":{"message":{"chat_id":"oc_be1c0d5643c22484f687109af2367db5","chat_type":"p2p","content":"{\\"text\\":\\"test\\"}","create_time":"1773066970951","message_id":"om_x100b55d9e360b0a0b32bf294c928fe1","message_type":"text","update_time":"1773066970951"},"sender":{"sender_id":{"open_id":"ou_d3dbb481d843078b19fc93e37d326fe1","union_id":"on_b672a3e63b7f135c65273c9b46882f98","user_id":"e1a389cd"},"sender_type":"user","tenant_key":"1424b73fd71dd75d"}}}'

payload_bytes = payload_str.encode('utf-8')

print("Step 1: 创建处理器")
def handler(data: P2ImMessageReceiveV1):
    print(f"\n>>> 处理器被调用！数据类型: {type(data)}\n")
    if hasattr(data, 'event') and hasattr(data.event, 'message'):
        print(f">>> Message ID: {data.event.message.message_id}")

print("Step 2: 注册事件")
event_handler = EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(handler).build()

print("Step 3: 调用 do_without_validation")
try:
    result = event_handler.do_without_validation(payload_bytes)
    print(f"Result: {result}")
except Exception as e:
    print(f"错误: {e}")
    import traceback
    traceback.print_exc()
