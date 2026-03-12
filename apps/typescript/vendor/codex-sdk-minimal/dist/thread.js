function normalizeInput(input) {
  if (typeof input === "string") {
    return input;
  }

  const textParts = [];
  for (const item of input) {
    if (item && item.type === "text" && typeof item.text === "string") {
      textParts.push(item.text);
    }
  }

  return textParts.join("\n\n");
}

export class Thread {
  constructor(exec, options, threadOptions, id = null) {
    this.exec = exec;
    this.options = options;
    this.threadOptions = threadOptions;
    this.idValue = id;
  }

  get id() {
    return this.idValue;
  }

  async run(input, turnOptions = {}) {
    const items = [];
    let finalResponse = "";
    let usage = null;
    let turnFailure = null;

    const generator = this.exec.run({
      input: normalizeInput(input),
      baseUrl: this.options.baseUrl,
      apiKey: this.options.apiKey,
      threadId: this.idValue,
      model: this.threadOptions.model,
      sandboxMode: this.threadOptions.sandboxMode,
      workingDirectory: this.threadOptions.workingDirectory,
      skipGitRepoCheck: this.threadOptions.skipGitRepoCheck,
      approvalPolicy: this.threadOptions.approvalPolicy,
      additionalDirectories: this.threadOptions.additionalDirectories,
      networkAccessEnabled: this.threadOptions.networkAccessEnabled,
      signal: turnOptions.signal,
    });

    for await (const rawItem of generator) {
      const event = JSON.parse(rawItem);
      if (event.type === "thread.started") {
        this.idValue = event.thread_id;
        continue;
      }

      if (event.type === "item.completed") {
        items.push(event.item);
        if (event.item && event.item.type === "agent_message" && typeof event.item.text === "string") {
          finalResponse = event.item.text;
        }
        continue;
      }

      if (event.type === "turn.completed") {
        usage = event.usage ?? null;
        continue;
      }

      if (event.type === "turn.failed") {
        turnFailure = event.error ?? { message: "turn failed" };
        break;
      }

      if (event.type === "error") {
        throw new Error(event.message || "Codex stream error");
      }
    }

    if (turnFailure) {
      throw new Error(turnFailure.message || "turn failed");
    }

    return { items, finalResponse, usage };
  }
}
