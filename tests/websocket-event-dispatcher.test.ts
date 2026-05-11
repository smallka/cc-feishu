import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin';

function main(): void {
  const websocketModule = require('../src/bot/websocket') as {
    createEventDispatcher?: () => {
      handles: Map<string, Function>;
    };
  };

  assert.equal(
    typeof websocketModule.createEventDispatcher,
    'function',
    'websocket module should export createEventDispatcher for event registration tests',
  );

  const eventDispatcher = websocketModule.createEventDispatcher!();

  assert.equal(eventDispatcher.handles.has('im.message.receive_v1'), true);
  assert.equal(eventDispatcher.handles.has('im.message.reaction.created_v1'), true);
  assert.equal(eventDispatcher.handles.has('im.message.reaction.deleted_v1'), true);

  console.log('websocket-event-dispatcher.test.ts passed');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
