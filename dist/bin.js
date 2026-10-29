#!/usr/bin/env node
import {
  HELP_TEXT,
  PACKAGE_NAME,
  SettingsError,
  VERSION,
  errorMessage,
  logError,
  resolveSettings,
  serve
} from "./chunk-DIAKPJV3.js";

// src/bin.ts
import { realpathSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

// src/terminal-login.ts
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createInterface } from "readline";
function loginChoices(modelRuntime) {
  const choices = [];
  for (const provider of modelRuntime.getProviders()) {
    const { apiKey, oauth } = provider.auth;
    if (apiKey?.login !== void 0) {
      choices.push({ provider: provider.id, type: "api_key", label: `${apiKey.name} (API key)` });
    }
    if (oauth !== void 0) {
      choices.push({
        provider: provider.id,
        type: "oauth",
        label: oauth.loginLabel ?? `${oauth.name} (browser sign-in)`
      });
    }
  }
  return choices;
}
function writeLine(output, text) {
  output.write(`${text}
`);
}
var CANCELLED = "stdin closed";
function createAsker(rl, output) {
  let closed = false;
  let pending;
  rl.once("close", () => {
    closed = true;
    pending?.();
  });
  const ask = (question) => {
    if (closed) return Promise.reject(new Error(CANCELLED));
    return new Promise((resolve2, reject) => {
      pending = () => {
        pending = void 0;
        reject(new Error(CANCELLED));
      };
      rl.question(question, (answer) => {
        pending = void 0;
        resolve2(answer);
      });
    });
  };
  const askSecret = (question) => {
    const tty = output.isTTY === true;
    const muted = rl;
    if (!tty) return ask(question);
    const original = muted._writeToOutput.bind(rl);
    muted._writeToOutput = (chunk) => {
      original(chunk.replace(/[^\r\n]/g, "*"));
    };
    writeLine(output, question);
    return ask("").finally(() => {
      muted._writeToOutput = original;
    });
  };
  return { ask, askSecret };
}
function terminalInteraction(ask, askSecret, output) {
  return {
    notify(event) {
      switch (event.type) {
        case "info": {
          writeLine(output, event.message);
          for (const link of event.links ?? []) {
            writeLine(output, `  ${link.label ?? "Link"}: ${link.url}`);
          }
          break;
        }
        case "auth_url": {
          writeLine(output, event.instructions ?? "Open this URL to sign in:");
          writeLine(output, `  ${event.url}`);
          break;
        }
        case "device_code": {
          writeLine(output, `Go to ${event.verificationUri} and enter the code: ${event.userCode}`);
          break;
        }
        case "progress": {
          writeLine(output, event.message);
          break;
        }
      }
    },
    async prompt(prompt) {
      switch (prompt.type) {
        case "secret":
          return askSecret(prompt.message);
        case "select": {
          writeLine(output, prompt.message);
          prompt.options.forEach((option, index) => {
            const detail = option.description !== void 0 ? ` \u2014 ${option.description}` : "";
            writeLine(output, `  ${index + 1}) ${option.label}${detail}`);
          });
          for (; ; ) {
            const answer = (await ask(`Choice [1-${prompt.options.length}]: `)).trim();
            const option = prompt.options[Number.parseInt(answer, 10) - 1];
            if (option !== void 0) return option.id;
            writeLine(output, "Enter a number from the list.");
          }
        }
        case "text":
        case "manual_code":
          return ask(`${prompt.message}: `);
      }
    }
  };
}
async function runTerminalLogin(options) {
  const { input, output, modelRuntime } = options;
  const signedIn = (await modelRuntime.listCredentials()).map((c) => c.providerId);
  if (signedIn.length > 0) {
    writeLine(output, `Signed in: ${signedIn.join(", ")}`);
  }
  const choices = loginChoices(modelRuntime);
  if (choices.length === 0) {
    writeLine(output, "No providers support interactive login.");
    return 1;
  }
  writeLine(output, "Login methods:");
  choices.forEach((choice, index) => writeLine(output, `  ${index + 1}) ${choice.label}`));
  const rl = createInterface({
    input,
    output,
    terminal: output.isTTY === true
  });
  const { ask, askSecret } = createAsker(rl, output);
  try {
    let choice;
    try {
      const answer = (await ask(`
Login method [1-${choices.length}]: `)).trim();
      choice = choices[Number.parseInt(answer, 10) - 1];
    } catch {
      writeLine(output, "Login cancelled.");
      return 1;
    }
    if (choice === void 0) {
      writeLine(output, "Enter a number from the list.");
      return 1;
    }
    try {
      await modelRuntime.login(choice.provider, choice.type, terminalInteraction(ask, askSecret, output));
    } catch (error) {
      writeLine(output, `Login failed: ${errorMessage(error)}`);
      return 1;
    }
    writeLine(output, `Signed in to ${choice.provider} (${choice.type}). You can close this window.`);
    return 0;
  } finally {
    rl.close();
  }
}
async function terminalLogin(argv) {
  let settings;
  try {
    settings = resolveSettings(argv);
  } catch (error) {
    if (error instanceof SettingsError) {
      process.stderr.write(`${error.message}

${HELP_TEXT}`);
      return 2;
    }
    throw error;
  }
  const agentDir = settings.agentDir ?? getAgentDir();
  let modelRuntime;
  try {
    modelRuntime = await ModelRuntime.create({
      authPath: `${agentDir}/auth.json`,
      modelsPath: `${agentDir}/models.json`,
      signal: AbortSignal.timeout(3e4)
    });
  } catch (error) {
    process.stderr.write(
      `${PACKAGE_NAME}: could not initialize pi auth at ${agentDir} (${errorMessage(error)})
`
    );
    return 1;
  }
  return runTerminalLogin({ input: process.stdin, output: process.stdout, modelRuntime });
}

// src/bin.ts
async function main(argv) {
  if (argv.includes("--version")) {
    console.log(`${PACKAGE_NAME} ${VERSION}`);
    return;
  }
  if (argv.includes("--help")) {
    console.log(HELP_TEXT.trimEnd());
    return;
  }
  if (argv.includes("--terminal-login")) {
    process.exitCode = await terminalLogin(argv);
    return;
  }
  let settings;
  try {
    settings = resolveSettings(argv);
  } catch (error) {
    if (error instanceof SettingsError) {
      logError(error.message);
      process.stderr.write(`
${HELP_TEXT}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  const server = serve({ settings });
  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.agent.dispose().catch((error) => logError(`teardown failed: ${String(error)}`)).finally(() => process.exit(code));
  };
  process.stdin.on("end", () => shutdown(0));
  process.stdin.on("close", () => shutdown(0));
  process.stdout.on("error", () => shutdown(0));
  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));
  await server.closed;
  shutdown(0);
}
try {
  const entry = process.argv[1];
  if (entry !== void 0 && realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url))) {
    main(process.argv.slice(2)).catch((error) => {
      logError(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
  }
} catch {
}
export {
  main
};
//# sourceMappingURL=bin.js.map