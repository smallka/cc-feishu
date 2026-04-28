import assert from 'assert/strict';

type AppConfig = typeof import('../src/config').default;

function loadConfig(overrides: Record<string, string | undefined>): AppConfig {
  const originalEnv = process.env;
  const nextEnv: NodeJS.ProcessEnv = {
    ...originalEnv,
    FEISHU_APP_ID: 'test-app-id',
    FEISHU_APP_SECRET: 'test-app-secret',
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
  const ownerOnlyConfig = loadConfig({
    FEISHU_ALLOWED_OPEN_IDS: undefined,
    FEISHU_OWNER_OPEN_ID: 'ou_owner',
  });
  assert.deepEqual(
    ownerOnlyConfig.feishu.allowedOpenIds,
    ['ou_owner'],
    'owner open_id should be allowed even without FEISHU_ALLOWED_OPEN_IDS',
  );

  const mergedConfig = loadConfig({
    FEISHU_ALLOWED_OPEN_IDS: 'ou_admin,ou_ops',
    FEISHU_OWNER_OPEN_ID: 'ou_owner',
  });
  assert.deepEqual(
    mergedConfig.feishu.allowedOpenIds,
    ['ou_admin', 'ou_ops', 'ou_owner'],
    'owner open_id should be merged into the allowlist',
  );

  const dedupedConfig = loadConfig({
    FEISHU_ALLOWED_OPEN_IDS: 'ou_admin,ou_owner',
    FEISHU_OWNER_OPEN_ID: 'ou_owner',
  });
  assert.deepEqual(
    dedupedConfig.feishu.allowedOpenIds,
    ['ou_admin', 'ou_owner'],
    'owner open_id should not be duplicated in the allowlist',
  );

  console.log('config-access.test.ts passed');
}

main();
