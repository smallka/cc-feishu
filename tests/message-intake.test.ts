import assert from 'assert/strict';

const {
  parseMessageTask,
} = require('../src/handlers/message-intake') as typeof import('../src/handlers/message-intake');
import type { MessageEvent } from '../src/handlers/message-intake';

function createEvent(messageType: string, content: string): MessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: 'ou_admin',
      },
      sender_type: 'user',
    },
    message: {
      message_id: `om_intake_${messageType}_${Date.now()}`,
      message_type: messageType,
      content,
      chat_id: 'oc_message_intake',
      chat_type: 'p2p',
    },
  };
}

function main(): void {
  const textEvent = createEvent('text', JSON.stringify({ text: '  hello  ' }));
  assert.deepEqual(
    parseMessageTask(textEvent),
    {
      data: textEvent,
      text: 'hello',
      messageType: 'text',
    },
  );

  assert.equal(parseMessageTask(createEvent('text', JSON.stringify({ text: '   ' }))), null);
  assert.equal(parseMessageTask(createEvent('text', '{bad-json')), null);

  const imageEvent = createEvent('image', JSON.stringify({ image_key: ' img_key ' }));
  assert.deepEqual(
    parseMessageTask(imageEvent),
    {
      data: imageEvent,
      text: '用户发送了一张图片，请结合图片内容继续处理当前请求。',
      messageType: 'image',
      imageKey: 'img_key',
    },
  );
  assert.equal(parseMessageTask(createEvent('image', JSON.stringify({ image_key: ' ' }))), null);
  assert.equal(parseMessageTask(createEvent('image', '{bad-json')), null);

  const fileEvent = createEvent('file', JSON.stringify({ file_key: ' file_key ', file_name: 'report.txt' }));
  assert.deepEqual(
    parseMessageTask(fileEvent),
    {
      data: fileEvent,
      text: '用户发送了一个文件。',
      messageType: 'file',
      fileKey: 'file_key',
      fileName: 'report.txt',
    },
  );
  assert.equal(parseMessageTask(createEvent('file', JSON.stringify({ file_key: ' ' }))), null);
  assert.equal(parseMessageTask(createEvent('file', '{bad-json')), null);
  assert.equal(parseMessageTask(createEvent('audio', JSON.stringify({ file_key: 'audio_key' }))), null);

  console.log('message-intake.test.ts passed');
}

main();
