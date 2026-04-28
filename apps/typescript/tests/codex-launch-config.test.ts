import assert from 'node:assert/strict';

const launchModulePath = '../src/codex/launch';

function loadResolveCodexLaunchConfig() {
  delete require.cache[require.resolve(launchModulePath)];
  return (require(launchModulePath) as typeof import('../src/codex/launch')).resolveCodexLaunchConfig;
}

const originalCodexCmd = process.env.CODEX_CMD;

try {
  process.env.CODEX_CMD = '';
  const defaultConfig = loadResolveCodexLaunchConfig()();
  assert.equal(defaultConfig.executablePath, 'codex');
  assert.deepEqual(defaultConfig.argsPrefix, []);

  process.env.CODEX_CMD = 'C:\\tools\\codex.cmd';
  const overrideConfig = loadResolveCodexLaunchConfig()();
  assert.equal(overrideConfig.executablePath, 'C:\\tools\\codex.cmd');
  assert.deepEqual(overrideConfig.argsPrefix, []);

  console.log('codex launch config contract: PASS');
} finally {
  if (originalCodexCmd === undefined) {
    delete process.env.CODEX_CMD;
  } else {
    process.env.CODEX_CMD = originalCodexCmd;
  }
}
