import { CodexExec } from "./exec.js";
import { Thread } from "./thread.js";

export class Codex {
  constructor(options = {}) {
    const { codexPathOverride = null, codexArgsPrefix = [], env, config, ...rest } = options;
    this.exec = new CodexExec(codexPathOverride, codexArgsPrefix, env, config);
    this.options = rest;
  }

  startThread(options = {}) {
    return new Thread(this.exec, this.options, options);
  }

  resumeThread(id, options = {}) {
    return new Thread(this.exec, this.options, options, id);
  }
}
