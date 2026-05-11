#!/usr/bin/env node

const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const testsDir = __dirname;
const testFiles = readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.ts'))
  .sort();

if (testFiles.length === 0) {
  console.error('No unit test files matched tests/*.test.ts');
  process.exit(1);
}

for (const file of testFiles) {
  const testPath = join(testsDir, file);
  console.log(`\n> ${file}`);

  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', testPath],
    {
      cwd: join(testsDir, '..'),
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
}
