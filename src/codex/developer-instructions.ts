import config from '../config';
import { detectLarkDriveUploadAvailable } from '../lark-cli/drive-upload-capability';

const LARK_DRIVE_UPLOAD_INSTRUCTIONS = [
  '当前环境可使用 lark-cli 上传文件到飞书云盘。',
  '对于 agent 为当前对话请求新建、导出、渲染或整理出来的交付产物，如果文件类型为 .docx、.pdf、.xlsx、.pptx、.png、.jpg、.jpeg 或 .md，上传到飞书云盘是默认交付动作，无需逐次询问用户。',
  '',
  '默认上传不支持目录。目录、源码集合、多文件工程产物不自动上传；如用户需要交付目录内容，应先询问是否打包为单个文件。',
  '',
  '默认上传仅限明显用于交付的非敏感产物；如果产物可能包含密钥、凭据、隐私数据、内部日志、聊天记录或超出当前请求范围的内容，应先询问。',
  '',
  '上传完成后，应明确告知用户上传结果、文件名、飞书链接或标识（如可获得），以及本地路径是否仍保留。',
].join('\n');

export async function resolveCodexDeveloperInstructions(): Promise<string | null> {
  const baseInstructions = config.codex.developerInstructions;
  if (!baseInstructions) {
    return null;
  }

  const sections = [baseInstructions];
  if (await detectLarkDriveUploadAvailable()) {
    sections.push(LARK_DRIVE_UPLOAD_INSTRUCTIONS);
  }

  return sections.join('\n\n');
}
