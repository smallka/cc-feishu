import assert from 'assert/strict';

type AppConfig = typeof import('../src/config').default;

function loadConfig(overrides: Record<string, string | undefined>): AppConfig {
  const originalEnv = process.env;
  const nextEnv: NodeJS.ProcessEnv = {
    ...originalEnv,
    FEISHU_APP_ID: 'test-app-id',
    FEISHU_APP_SECRET: 'test-app-secret',
    FEISHU_ALLOWED_OPEN_IDS: '',
    FEISHU_OWNER_OPEN_ID: '',
    AGENT_PROVIDER: 'codex',
    NODE_ENV: 'test',
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete nextEnv[key];
    } else {
      nextEnv[key] = value;
    }
  }

  const configModulePath = require.resolve('../src/config');

  try {
    process.env = nextEnv;
    delete require.cache[configModulePath];
    return (require('../src/config') as typeof import('../src/config')).default;
  } finally {
    delete require.cache[configModulePath];
    process.env = originalEnv;
  }
}

function main(): void {
  const allowlistConfig = loadConfig({
    FEISHU_ALLOWED_OPEN_IDS: 'ou_admin,ou_ops',
  });
  assert.deepEqual(
    allowlistConfig.feishu.allowedOpenIds,
    ['ou_admin', 'ou_ops'],
    'allowed open ids should be parsed from FEISHU_ALLOWED_OPEN_IDS',
  );

  const trimmedConfig = loadConfig({
    FEISHU_ALLOWED_OPEN_IDS: ' ou_admin , , ou_owner ',
  });
  assert.deepEqual(
    trimmedConfig.feishu.allowedOpenIds,
    ['ou_admin', 'ou_owner'],
    'allowed open ids should be trimmed and empty entries removed',
  );

  const ownerOnlyConfig = loadConfig({
    FEISHU_ALLOWED_OPEN_IDS: '',
    FEISHU_OWNER_OPEN_ID: 'ou_owner',
  });
  assert.deepEqual(
    ownerOnlyConfig.feishu.allowedOpenIds,
    [],
    'owner open id should be ignored when FEISHU_ALLOWED_OPEN_IDS is unset',
  );

  console.log('config-access.test.ts passed');
}

main();
