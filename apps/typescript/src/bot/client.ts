import * as lark from '@larksuiteoapi/node-sdk';
import config from '../config';
import logger from '../utils/logger';

class FeishuClient {
  private client: lark.Client;

  constructor() {
    this.client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    logger.info('Feishu client initialized', {
      appId: config.feishu.appId,
    });
  }

  getClient(): lark.Client {
    return this.client;
  }
}

export default new FeishuClient();
