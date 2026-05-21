import assert from 'node:assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const configModulePath = require.resolve('../src/config');
const capabilityModulePath = require.resolve('../src/lark-cli/im-file-delivery-capability');
const instructionsModulePath = require.resolve('../src/codex/developer-instructions');

function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(env)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return run().finally(() => {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function loadInstructionsModule(capabilityAvailable: boolean) {
  delete require.cache[configModulePath];
  delete require.cache[instructionsModulePath];

  const capabilityModule = require(capabilityModulePath) as typeof import('../src/lark-cli/im-file-delivery-capability');
  const originalDetector = capabilityModule.detectLarkImFileDeliveryAvailable;
  (capabilityModule as any).detectLarkImFileDeliveryAvailable = async () => capabilityAvailable;

  return {
    module: require(instructionsModulePath) as typeof import('../src/codex/developer-instructions'),
    restore(): void {
      (capabilityModule as any).detectLarkImFileDeliveryAvailable = originalDetector;
      delete require.cache[configModulePath];
      delete require.cache[instructionsModulePath];
    },
  };
}

async function main(): Promise<void> {
  await withEnv({
    CODEX_DEVELOPER_INSTRUCTIONS: undefined,
  }, async () => {
    const loaded = loadInstructionsModule(false);
    try {
      const instructions = await loaded.module.resolveCodexDeveloperInstructions();
      assert.match(instructions ?? '', /飞书 Bot/);
      assert.doesNotMatch(instructions ?? '', /上传并发送到当前飞书会话是默认交付动作/);
    } finally {
      loaded.restore();
    }
  });

  await withEnv({
    CODEX_DEVELOPER_INSTRUCTIONS: undefined,
  }, async () => {
    const loaded = loadInstructionsModule(true);
    try {
      const instructions = await loaded.module.resolveCodexDeveloperInstructions('oc_test_chat');
      assert.match(instructions ?? '', /飞书 Bot/);
      assert.match(instructions ?? '', /上传并发送到当前飞书会话是默认交付动作/);
      assert.match(instructions ?? '', /当前飞书会话 chat_id: oc_test_chat/);
      assert.match(instructions ?? '', /\.docx、\.pdf、\.xlsx、\.pptx、\.png、\.jpg、\.jpeg 或 \.md/);
    } finally {
      loaded.restore();
    }
  });

  await withEnv({
    CODEX_DEVELOPER_INSTRUCTIONS: '   ',
  }, async () => {
    const loaded = loadInstructionsModule(true);
    try {
      const instructions = await loaded.module.resolveCodexDeveloperInstructions();
      assert.equal(instructions, null);
    } finally {
      loaded.restore();
    }
  });

  console.log('codex-developer-instructions.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
