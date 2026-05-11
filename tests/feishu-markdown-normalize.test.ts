import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const { normalizeFeishuMarkdown } = require('../src/services/message.service') as typeof import('../src/services/message.service');

function main(): void {
  const wrappedUrl = '新链接如下：\n\n`https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=abc&user_code=XYZ`';
  const normalizedWrappedUrl = normalizeFeishuMarkdown(wrappedUrl);
  assert.equal(
    normalizedWrappedUrl,
    '新链接如下：\n\n[https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=abc&user_code=XYZ](https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=abc&user_code=XYZ)',
  );

  const mixedContent = '回复 `已授权`，然后打开 `https://example.com/path?q=1`。';
  const normalizedMixedContent = normalizeFeishuMarkdown(mixedContent);
  assert.equal(
    normalizedMixedContent,
    '回复 `已授权`，然后打开 [https://example.com/path?q=1](https://example.com/path?q=1)。',
  );

  const unchangedMarkdown = '命令是 `lark-cli auth login`，不要改这个 code span。';
  assert.equal(normalizeFeishuMarkdown(unchangedMarkdown), unchangedMarkdown);

  console.log('feishu-markdown-normalize.test.ts passed');
}

main();
