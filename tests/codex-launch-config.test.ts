import assert from 'node:assert/strict';

const launchModulePath = '../src/codex/launch';

function loadLaunchModule() {
  delete require.cache[require.resolve(launchModulePath)];
  return require(launchModulePath) as typeof import('../src/codex/launch');
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });

  try {
    return fn();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(process, 'platform', originalDescriptor);
    }
  }
}

const originalCodexCmd = process.env.CODEX_CMD;

try {
  process.env.CODEX_CMD = '';
  const defaultConfig = loadLaunchModule().resolveCodexLaunchConfig();
  const defaultExecutablePath: string = defaultConfig.executablePath;
  const defaultArgsPrefix: string[] = defaultConfig.argsPrefix;
  assert.equal(defaultExecutablePath, 'codex');
  assert.deepEqual(defaultArgsPrefix, []);
  assert.equal(defaultConfig.executablePath, 'codex');
  assert.deepEqual(defaultConfig.argsPrefix, []);

  process.env.CODEX_CMD = '  C:\\tools\\codex.cmd  ';
  const overrideConfig = loadLaunchModule().resolveCodexLaunchConfig();
  assert.equal(overrideConfig.executablePath, 'C:\\tools\\codex.cmd');
  assert.deepEqual(overrideConfig.argsPrefix, []);

  process.env.CODEX_CMD = '';
  const legacyWindowsConfig = withPlatform('win32', () =>
    loadLaunchModule().resolveLegacyCodexLaunchOverrides()
  );
  assert.equal(legacyWindowsConfig.executablePath, undefined);
  assert.equal(legacyWindowsConfig.argsPrefix, undefined);

  process.env.CODEX_CMD = '';
  const legacyNonWindowsConfig = withPlatform('linux', () =>
    loadLaunchModule().resolveLegacyCodexLaunchOverrides()
  );
  assert.equal(legacyNonWindowsConfig.executablePath, 'codex');
  assert.deepEqual(legacyNonWindowsConfig.argsPrefix, []);

  process.env.CODEX_CMD = '  C:\\tools\\codex.cmd  ';
  const legacyOverrideConfig = withPlatform('win32', () =>
    loadLaunchModule().resolveLegacyCodexLaunchOverrides()
  );
  assert.equal(legacyOverrideConfig.executablePath, 'C:\\tools\\codex.cmd');
  assert.deepEqual(legacyOverrideConfig.argsPrefix, []);

  console.log('codex launch config contract: PASS');
} finally {
  if (originalCodexCmd === undefined) {
    delete process.env.CODEX_CMD;
  } else {
    process.env.CODEX_CMD = originalCodexCmd;
  }
}
