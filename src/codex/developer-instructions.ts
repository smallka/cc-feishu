import config from '../config';
import { detectLarkImFileDeliveryAvailable } from '../lark-cli/im-file-delivery-capability';

function buildLarkImFileDeliveryInstructions(chatId?: string): string {
  return [
    '当前环境可将文件上传并发送到飞书会话。',
    chatId ? `当前飞书会话 chat_id: ${chatId}。` : '',
    '对于 agent 为当前对话请求新建、导出、渲染或整理出来的交付产物，如果文件类型为 .docx、.pdf、.xlsx、.pptx、.png、.jpg、.jpeg 或 .md，上传并发送到当前飞书会话是默认交付动作，无需逐次询问用户。',
    '',
    '默认上传不支持目录。目录、源码集合、多文件工程产物不自动上传；如用户需要交付目录内容，应先询问是否打包为单个文件。',
    '',
    '默认上传仅限明显用于交付的非敏感产物；如果产物可能包含密钥、凭据、隐私数据、内部日志、聊天记录或超出当前请求范围的内容，应先询问。',
    '',
    '上传并发送完成后，应明确告知用户发送结果、文件名、飞书消息 ID 或标识（如可获得），以及本地路径是否仍保留。',
  ].filter(Boolean).join('\n');
}

export async function resolveCodexDeveloperInstructions(chatId?: string): Promise<string | null> {
  const baseInstructions = config.codex.developerInstructions;
  if (!baseInstructions) {
    return null;
  }

  const sections = [baseInstructions];
  if (await detectLarkImFileDeliveryAvailable(chatId)) {
    sections.push(buildLarkImFileDeliveryInstructions(chatId));
  }

  return sections.join('\n\n');
}
