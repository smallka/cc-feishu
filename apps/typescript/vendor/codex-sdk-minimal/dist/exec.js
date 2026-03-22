import { spawn } from "node:child_process";
import readline from "node:readline";

function inferCodexCommand() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function shouldUseShell(executablePath) {
  return process.platform === "win32" && executablePath.toLowerCase().endsWith(".cmd");
}

function buildEnv(envOverride, baseUrl, apiKey) {
  const env = envOverride ? { ...envOverride } : { ...process.env };

  if (baseUrl) {
    env.OPENAI_BASE_URL = baseUrl;
  }

  if (apiKey) {
    env.CODEX_API_KEY = apiKey;
  }

  if (!env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) {
    env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = "codex_sdk_ts";
  }

  return env;
}

function terminateChild(child) {
  if (child.killed) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => {
      try {
        child.kill();
      } catch {
        // Ignore fallback kill failures.
      }
    });
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // Ignore cleanup errors from already-exited processes.
  }
}

export class CodexExec {
  constructor(executablePath = null, executableArgs = [], env, configOverrides) {
    this.executablePath = executablePath || inferCodexCommand();
    this.executableArgs = executableArgs;
    this.envOverride = env;
    this.configOverrides = configOverrides;
  }

  async *run(args) {
    const commandArgs = [...this.executableArgs, "exec", "--experimental-json"];

    if (args.model) {
      commandArgs.push("--model", args.model);
    }

    if (args.images && args.images.length > 0) {
      for (const imagePath of args.images) {
        commandArgs.push("--image", imagePath);
      }
    }

    if (args.sandboxMode) {
      commandArgs.push("--sandbox", args.sandboxMode);
    }

    if (args.workingDirectory) {
      commandArgs.push("--cd", args.workingDirectory);
    }

    if (args.additionalDirectories && args.additionalDirectories.length > 0) {
      for (const directory of args.additionalDirectories) {
        commandArgs.push("--add-dir", directory);
      }
    }

    if (args.skipGitRepoCheck) {
      commandArgs.push("--skip-git-repo-check");
    }

    if (args.networkAccessEnabled !== undefined) {
      commandArgs.push(
        "--config",
        `sandbox_workspace_write.network_access=${args.networkAccessEnabled}`,
      );
    }

    if (args.approvalPolicy) {
      commandArgs.push("--config", `approval_policy="${args.approvalPolicy}"`);
    }

    if (args.threadId) {
      commandArgs.push("resume", args.threadId);
    }

    const child = spawn(this.executablePath, commandArgs, {
      env: buildEnv(this.envOverride, args.baseUrl, args.apiKey),
      signal: args.signal,
      shell: shouldUseShell(this.executablePath),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const abortHandler = () => {
      terminateChild(child);
    };

    if (args.signal) {
      if (args.signal.aborted) {
        abortHandler();
      } else {
        args.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });

    if (!child.stdin) {
      terminateChild(child);
      throw new Error("Child process has no stdin");
    }

    child.stdin.write(args.input);
    child.stdin.end();

    if (!child.stdout) {
      terminateChild(child);
      throw new Error("Child process has no stdout");
    }

    const stderrChunks = [];
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(chunk);
      });
    }

    const exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        yield line;
      }

      if (spawnError) {
        throw spawnError;
      }

      const { code, signal } = await exitPromise;
      if (code !== 0 || signal) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf8");
        const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
        throw new Error(`Codex Exec exited with ${detail}: ${stderrText}`);
      }
    } finally {
      if (args.signal) {
        args.signal.removeEventListener("abort", abortHandler);
      }
      rl.close();
      child.removeAllListeners();
      terminateChild(child);
    }
  }
}
