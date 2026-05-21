import assert from 'node:assert/strict';
import {
  detectLarkDriveUploadAvailableWithRunner,
} from '../src/lark-cli/drive-upload-capability';

async function main(): Promise<void> {
  {
    const observedArgs: string[][] = [];
    const available = await detectLarkDriveUploadAvailableWithRunner(async (args) => {
      observedArgs.push(args);
      return {
        exitCode: 0,
        stdout: '{}',
        stderr: '',
        timedOut: false,
      };
    });

    assert.equal(available, true);
    assert.deepEqual(observedArgs, [
      ['auth', 'status'],
      ['auth', 'check', '--scope', 'drive:file:upload'],
    ]);
  }

  {
    const observedArgs: string[][] = [];
    const available = await detectLarkDriveUploadAvailableWithRunner(async (args) => {
      observedArgs.push(args);
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'not logged in',
        timedOut: false,
      };
    });

    assert.equal(available, false);
    assert.deepEqual(observedArgs, [
      ['auth', 'status'],
    ]);
  }

  {
    let calls = 0;
    const available = await detectLarkDriveUploadAvailableWithRunner(async () => {
      calls += 1;
      return {
        exitCode: calls === 1 ? 0 : null,
        stdout: '',
        stderr: '',
        timedOut: calls === 2,
      };
    });

    assert.equal(available, false);
    assert.equal(calls, 2);
  }

  console.log('lark-drive-upload-capability.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
