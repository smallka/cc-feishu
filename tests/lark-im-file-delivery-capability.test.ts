import assert from 'node:assert/strict';
import {
  detectLarkImFileDeliveryAvailableWithRunner,
} from '../src/lark-cli/im-file-delivery-capability';

async function main(): Promise<void> {
  {
    const observedArgs: string[][] = [];
    const available = await detectLarkImFileDeliveryAvailableWithRunner(async (args) => {
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
      ['im', '+messages-send', '--help'],
      ['auth', 'check', '--scope', 'im:message im:resource'],
    ]);
  }

  {
    const observedArgs: string[][] = [];
    const available = await detectLarkImFileDeliveryAvailableWithRunner(async (args) => {
      observedArgs.push(args);
      return {
        exitCode: observedArgs.length === 1 ? 0 : 1,
        stdout: '',
        stderr: 'missing im:resource',
        timedOut: false,
      };
    });

    assert.equal(available, false);
    assert.deepEqual(observedArgs, [
      ['im', '+messages-send', '--help'],
      ['auth', 'check', '--scope', 'im:message im:resource'],
    ]);
  }

  {
    const observedArgs: string[][] = [];
    const available = await detectLarkImFileDeliveryAvailableWithRunner(async (args) => {
      observedArgs.push(args);
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'lark-cli unavailable',
        timedOut: false,
      };
    }, {
      appCredentialsAvailable: true,
      chatId: 'oc_test_chat',
    });

    assert.equal(available, true);
    assert.deepEqual(observedArgs, []);
  }

  {
    const observedArgs: string[][] = [];
    const available = await detectLarkImFileDeliveryAvailableWithRunner(async (args) => {
      observedArgs.push(args);
      return {
        exitCode: 0,
        stdout: '{}',
        stderr: '',
        timedOut: false,
      };
    }, {
      appCredentialsAvailable: true,
    });

    assert.equal(available, true);
    assert.deepEqual(observedArgs, [
      ['im', '+messages-send', '--help'],
      ['auth', 'check', '--scope', 'im:message im:resource'],
    ]);
  }

  {
    let calls = 0;
    const available = await detectLarkImFileDeliveryAvailableWithRunner(async () => {
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

  console.log('lark-im-file-delivery-capability.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
