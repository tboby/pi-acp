// src/log.ts
var PREFIX = "[openma-pi-acp]";
function isDebugEnabled() {
  const value = process.env["PI_ACP_DEBUG"];
  return value !== void 0 && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}
function write(level, message) {
  try {
    process.stderr.write(`${PREFIX} ${level}: ${message}
`);
  } catch {
  }
}
function logDebug(message) {
  if (isDebugEnabled()) write("debug", message);
}
function logWarn(message) {
  write("warn", message);
}
function logError(message) {
  write("error", message);
}
function errorMessage(error) {
  if (error instanceof Error) {
    const chain = [error.message];
    let cause = error.cause;
    let depth = 0;
    while (cause !== void 0 && cause !== null && depth < 5) {
      chain.push(cause instanceof Error ? cause.message : String(cause));
      cause = cause instanceof Error ? cause.cause : void 0;
      depth += 1;
    }
    return chain.join(": ");
  }
  return String(error);
}

// src/version.ts
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
function readOwnPackage() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    try {
      const raw = readFileSync(join(dir, "package.json"), "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.name === "string" && typeof parsed.version === "string") {
        return { name: parsed.name, version: parsed.version };
      }
    } catch {
    }
    dir = dirname(dir);
  }
  return { name: "@openma/pi-acp", version: "0.0.0" };
}
var pkg = readOwnPackage();
var PACKAGE_NAME = pkg.name;
var VERSION = pkg.version;
var AGENT_NAME = "openma-pi-acp";
var AGENT_TITLE = "pi (OpenMA ACP)";

// src/acp/meta.ts
var META_NS = "pi";
function piMeta(value) {
  return { [META_NS]: value };
}
function readPiMeta(meta) {
  if (meta === null || typeof meta !== "object") return void 0;
  const block = meta[META_NS];
  return block !== null && typeof block === "object" ? block : void 0;
}

// src/acp/auth.ts
var TERMINAL_AUTH_METHOD_ID = "pi-terminal-login";
var API_KEY_METHOD_PREFIX = "api-key:";
var OAUTH_METHOD_PREFIX = "oauth:";
var GATEWAY_METHOD_ID = "gateway";
function terminalLaunchSpec() {
  return { command: AGENT_NAME, args: ["--terminal-login"] };
}
var FEATURED_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "xai",
  "groq",
  "mistral",
  "deepseek",
  "moonshot",
  "zai",
  "minimax"
];
function rank(providerId) {
  const index = FEATURED_PROVIDERS.indexOf(providerId);
  return index === -1 ? 99 : index;
}
function buildAuthMethods(modelRuntime, options) {
  const methods = [];
  if (options.terminal || options.terminalAuthMeta) {
    const launch = terminalLaunchSpec();
    methods.push({
      type: "terminal",
      id: TERMINAL_AUTH_METHOD_ID,
      name: "Log in with pi",
      description: "Open pi's terminal login to configure API keys or sign in with a provider",
      args: ["--terminal-login"],
      env: {},
      ...options.terminalAuthMeta ? { _meta: { "terminal-auth": { ...launch, label: "Log in with pi" } } } : {}
    });
  }
  if (options.gateway) {
    methods.push({
      id: GATEWAY_METHOD_ID,
      name: "Custom model gateway",
      description: "Route models through a custom OpenAI-compatible gateway (baseUrl + headers via _meta.gateway)",
      _meta: { gateway: { protocol: "openai-completions" } }
    });
  }
  if (modelRuntime === void 0) return methods;
  const providers = [...modelRuntime.getProviders()].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id)
  );
  if (options.urlElicitation || options.formElicitation) {
    for (const provider of providers) {
      const oauth = provider.auth.oauth;
      if (oauth === void 0) continue;
      methods.push({
        id: `${OAUTH_METHOD_PREFIX}${provider.id}`,
        name: oauth.loginLabel ?? `Sign in to ${oauth.name}`,
        description: oauth.isSubscription === true ? `Use your ${oauth.name} subscription; the login happens in your browser` : `Sign in to ${oauth.name} in your browser`,
        _meta: piMeta({ oauth: { provider: provider.id, subscription: oauth.isSubscription === true } })
      });
    }
  }
  for (const provider of providers) {
    if (provider.auth.apiKey === void 0) continue;
    if (!FEATURED_PROVIDERS.includes(provider.id) && !modelRuntime.hasConfiguredAuth(provider.id)) continue;
    methods.push({
      id: `${API_KEY_METHOD_PREFIX}${provider.id}`,
      name: `${provider.name} API key`,
      description: `Provide a ${provider.name} API key; stored in pi's credential store`,
      _meta: { "api-key": { provider: provider.id } }
    });
  }
  return methods;
}
function parseAuthMethodId(methodId) {
  if (methodId.startsWith(API_KEY_METHOD_PREFIX)) {
    return { type: "api_key", provider: methodId.slice(API_KEY_METHOD_PREFIX.length) };
  }
  if (methodId.startsWith(OAUTH_METHOD_PREFIX)) {
    return { type: "oauth", provider: methodId.slice(OAUTH_METHOD_PREFIX.length) };
  }
  return void 0;
}
function apiKeyFromAuthenticate(meta) {
  if (meta === null || typeof meta !== "object") return {};
  const block = meta["api-key"];
  if (block === null || typeof block !== "object") return {};
  const record = block;
  return {
    ...typeof record["apiKey"] === "string" && record["apiKey"].length > 0 ? { apiKey: record["apiKey"] } : {},
    ...typeof record["provider"] === "string" && record["provider"].length > 0 ? { provider: record["provider"] } : {}
  };
}
var GATEWAY_META_HINT = '_meta.gateway = {"baseUrl": "https://\u2026", "headers"?: {"Authorization": "Bearer <key>"}, "providerName"?: "\u2026", "models"?: [{"id": "\u2026"}]}';
function slugifyProviderId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : void 0;
}
function gatewayModels(raw) {
  if (raw === void 0 || raw === null) return { models: void 0 };
  if (!Array.isArray(raw)) return { error: `${GATEWAY_META_HINT} \u2014 "models" must be an array` };
  const models = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) {
      models.push({ id: entry });
      continue;
    }
    if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") {
      return { error: `${GATEWAY_META_HINT} \u2014 each model needs at least an "id"` };
    }
    models.push(entry);
  }
  return { models };
}
function gatewayFromAuthenticate(meta) {
  if (meta === null || typeof meta !== "object") return void 0;
  const block = meta["gateway"];
  if (block === void 0 || block === null) return void 0;
  if (typeof block !== "object") return { error: `${GATEWAY_META_HINT} \u2014 the value must be an object` };
  const record = block;
  const baseUrl = typeof record["baseUrl"] === "string" ? record["baseUrl"].trim() : "";
  if (!/^https?:\/\/.+/.test(baseUrl)) {
    return { error: `${GATEWAY_META_HINT} \u2014 "baseUrl" must be an http(s) URL` };
  }
  const headers = {};
  let apiKey;
  const rawHeaders = record["headers"];
  if (rawHeaders !== void 0 && rawHeaders !== null) {
    if (typeof rawHeaders !== "object") {
      return { error: `${GATEWAY_META_HINT} \u2014 "headers" must be an object` };
    }
    for (const [name, value] of Object.entries(rawHeaders)) {
      if (typeof value !== "string") {
        return { error: `${GATEWAY_META_HINT} \u2014 header "${name}" must be a string` };
      }
      const lower = name.toLowerCase();
      if (lower === "authorization") {
        const match = /^bearer\s+(.+)$/i.exec(value.trim());
        apiKey = (match?.[1] ?? value.trim()) || void 0;
      } else if (lower === "x-api-key") {
        apiKey = value;
      } else {
        headers[name] = value;
      }
    }
  }
  const providerName = typeof record["providerName"] === "string" && record["providerName"].length > 0 ? record["providerName"] : void 0;
  const provider = providerName === void 0 ? "gateway" : slugifyProviderId(providerName);
  if (provider === void 0) {
    return { error: `${GATEWAY_META_HINT} \u2014 "providerName" "${providerName}" does not contain a usable id` };
  }
  const api = record["api"];
  if (api !== void 0 && (typeof api !== "string" || api.length === 0)) {
    return { error: `${GATEWAY_META_HINT} \u2014 "api" must be a string like "openai-completions"` };
  }
  const parsed = gatewayModels(record["models"]);
  if ("error" in parsed) return { error: parsed.error };
  return {
    submission: {
      provider,
      name: providerName,
      baseUrl,
      apiKey,
      headers,
      api,
      models: parsed.models
    }
  };
}
function logoutScopeFromMeta(meta) {
  if (meta === null || typeof meta !== "object") return {};
  const pi = meta["pi"];
  if (pi === null || typeof pi !== "object") return {};
  const scope = pi["logout"];
  if (scope === null || typeof scope !== "object") return {};
  const record = scope;
  return {
    ...typeof record["provider"] === "string" && record["provider"].length > 0 ? { provider: record["provider"] } : {},
    ...record["all"] === true ? { all: true } : {}
  };
}

// src/acp/model-aliases.ts
import { resolveCliModel } from "@earendil-works/pi-coding-agent";
var THINKING_LEVELS = /* @__PURE__ */ new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
var MODEL_ID_ALIASES = {
  "deepseek-v4-flash": "deepseek-flash",
  // The vision preview was folded into deepseek-flash, which accepts images.
  "deepseek-v4-flash-vision-exp": "deepseek-flash"
};
var PROVIDER_ALIASES = {
  "azure-openai-responses": "azure"
};
function splitThinking(value) {
  const index = value.lastIndexOf(":");
  if (index <= 0) return { model: value };
  const suffix = value.slice(index + 1);
  if (!THINKING_LEVELS.has(suffix)) return { model: value };
  return { model: value.slice(0, index), thinking: suffix };
}
function aliasModelIds(value) {
  const out = [];
  const push = (next) => {
    if (!out.includes(next)) out.push(next);
  };
  push(value);
  const slash = value.indexOf("/");
  const provider = slash > 0 ? value.slice(0, slash) : void 0;
  const id = slash > 0 ? value.slice(slash + 1) : value;
  const nextProvider = provider !== void 0 ? PROVIDER_ALIASES[provider] ?? provider : void 0;
  const ids = /* @__PURE__ */ new Set([id]);
  const renamed = MODEL_ID_ALIASES[id];
  if (renamed !== void 0) ids.add(renamed);
  const dotted = id.replace(/(\d)\.(\d)/g, "$1-$2");
  if (dotted !== id) ids.add(dotted);
  for (const modelId of ids) {
    if (nextProvider !== void 0) push(`${nextProvider}/${modelId}`);
    else push(modelId);
  }
  return out;
}
function modelReferenceCandidates(value) {
  const { model, thinking } = splitThinking(value);
  return aliasModelIds(model).map((id) => thinking !== void 0 ? `${id}:${thinking}` : id);
}
function modelLookupCandidates(value) {
  return aliasModelIds(splitThinking(value).model);
}
function resolveAliasedCliModel(options) {
  let last = resolveCliModel({ cliModel: options.cliModel, modelRuntime: options.modelRuntime });
  if (last.model !== void 0) return last;
  for (const candidate of modelReferenceCandidates(options.cliModel)) {
    if (candidate === options.cliModel) continue;
    const resolved = resolveCliModel({ cliModel: candidate, modelRuntime: options.modelRuntime });
    if (resolved.model !== void 0) return resolved;
    last = resolved;
  }
  return last;
}

// src/acp/config-options.ts
var CONFIG_MODEL = "model";
var CONFIG_THINKING = "thinking";
var CONFIG_AUTO_COMPACTION = "auto_compaction";
function modelValue(model) {
  return `${model.provider}/${model.id}`;
}
function findExact(models, value) {
  const exact = models.find((model) => modelValue(model) === value);
  if (exact !== void 0) return exact;
  const byId = models.filter((model) => model.id === value);
  return byId.length === 1 ? byId[0] : void 0;
}
function findModel(models, value) {
  for (const candidate of modelLookupCandidates(value)) {
    const exact = findExact(models, candidate);
    if (exact !== void 0) return exact;
  }
  const lowered = value.toLowerCase();
  const fuzzy = models.filter(
    (model) => modelValue(model).toLowerCase().includes(lowered) || model.name.toLowerCase().includes(lowered)
  );
  return fuzzy.length === 1 ? fuzzy[0] : void 0;
}
function parseBooleanOptionValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return void 0;
  const lowered = value.toLowerCase();
  if (["true", "on", "enabled", "1"].includes(lowered)) return true;
  if (["false", "off", "disabled", "0"].includes(lowered)) return false;
  return void 0;
}
function buildConfigOptions(session, surface = { booleanOptions: true }) {
  const options = [];
  const available = session.modelRuntime.getAvailableSnapshot();
  const current = session.model;
  const seen = /* @__PURE__ */ new Set();
  const modelOptions = [];
  const push = (model) => {
    const value = modelValue(model);
    if (seen.has(value)) return;
    seen.add(value);
    modelOptions.push({
      value,
      name: model.name,
      description: `${model.provider} \xB7 ${model.id}`
    });
  };
  if (current !== void 0) push(current);
  for (const model of available) push(model);
  if (modelOptions.length > 0) {
    const providers = new Set(modelOptions.map((option) => option.value.split("/", 1)[0]));
    const currentValue = current !== void 0 ? modelValue(current) : modelOptions[0].value;
    if (providers.size > 1) {
      const groups = [...providers].map((provider) => ({
        group: provider ?? "other",
        name: provider ?? "other",
        options: modelOptions.filter((option) => option.value.split("/", 1)[0] === provider)
      }));
      options.push({
        type: "select",
        id: CONFIG_MODEL,
        name: "Model",
        category: "model",
        currentValue,
        options: groups
      });
    } else {
      options.push({
        type: "select",
        id: CONFIG_MODEL,
        name: "Model",
        category: "model",
        currentValue,
        options: modelOptions
      });
    }
  }
  if (session.supportsThinking()) {
    const levels = session.getAvailableThinkingLevels();
    if (levels.length >= 2) {
      options.push({
        type: "select",
        id: CONFIG_THINKING,
        name: "Thinking",
        category: "thought_level",
        description: "Reasoning effort for this session",
        currentValue: session.thinkingLevel,
        options: levels.map((level) => ({ value: level, name: level }))
      });
    }
  }
  const autoCompaction = {
    id: CONFIG_AUTO_COMPACTION,
    name: "Auto-compaction",
    category: "model_config",
    description: "Summarize context automatically when it nears the model's window"
  };
  if (surface.booleanOptions) {
    options.push({ type: "boolean", ...autoCompaction, currentValue: session.autoCompactionEnabled });
  } else {
    options.push({
      type: "select",
      ...autoCompaction,
      currentValue: session.autoCompactionEnabled ? "on" : "off",
      options: [
        { value: "on", name: "On" },
        { value: "off", name: "Off" }
      ]
    });
  }
  return options;
}

// src/acp/commands.ts
function stateCommand(configId) {
  return { _meta: { commandAction: { kind: "setConfigOption", configId, presentation: "state" } } };
}
var BUILTIN_COMMANDS = [
  { name: "status", description: "Show adapter, model, and session status" },
  {
    name: "model",
    description: "List models or switch model",
    input: { hint: "[provider/model] \u2014 blank lists" },
    ...stateCommand("model")
  },
  {
    name: "thinking",
    description: "Show or set the thinking level",
    input: { hint: "off|minimal|low|medium|high|xhigh|max" },
    ...stateCommand("thinking")
  },
  {
    name: "compact",
    description: "Compact the conversation context",
    input: { hint: "[custom instructions]" }
  },
  {
    name: "autocompact",
    description: "Toggle automatic compaction",
    input: { hint: "on|off|toggle" },
    ...stateCommand("auto_compaction")
  },
  { name: "name", description: "Set the session display name", input: { hint: "<name>" } },
  { name: "rename", description: "Rename the current session", input: { hint: "<name>" } },
  { name: "session", description: "Show session statistics (messages, tokens, cost, file)" },
  { name: "export", description: "Export the session to HTML", input: { hint: "[output path]" } },
  { name: "tools", description: "List or set active tools", input: { hint: "[tool names\u2026]" } },
  { name: "skills", description: "List available skills" },
  {
    name: "steering",
    description: "Show or set steering delivery mode",
    input: { hint: "all|one-at-a-time" }
  },
  {
    name: "follow-up",
    description: "Show or set follow-up delivery mode",
    input: { hint: "all|one-at-a-time" }
  },
  { name: "queue", description: "Show or clear queued messages", input: { hint: "[clear]" } },
  {
    name: "bash",
    description: "Run a shell command in the session cwd (output added to context)",
    input: { hint: "<command>" }
  },
  { name: "reload", description: "Reload extensions, skills, prompts, and context files" },
  { name: "changelog", description: "Show the installed pi changelog" }
];
function isBuiltinCommand(name) {
  return BUILTIN_COMMANDS.some((command) => command.name === name);
}
var NATIVE_AUTH_COMMANDS = /* @__PURE__ */ new Set(["login", "logout"]);
function isNativeAuthCommand(name) {
  return NATIVE_AUTH_COMMANDS.has(name);
}
function parseSlashCommand(text) {
  const trimmed = text.trimStart();
  const match = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (match === null || match[1] === void 0) return void 0;
  return { name: match[1], args: (match[2] ?? "").trim() };
}
function availableCommandsFor(session, options) {
  const list = [...BUILTIN_COMMANDS];
  const seen = new Set(list.map((command) => command.name));
  const push = (command) => {
    if (seen.has(command.name)) return;
    seen.add(command.name);
    list.push(command);
  };
  for (const command of session.extensionRunner.getRegisteredCommands()) {
    push({
      name: command.invocationName,
      description: command.description ?? `${command.invocationName} (extension)`,
      _meta: { pi: { source: "extension", path: command.sourceInfo.path } }
    });
  }
  for (const template of session.promptTemplates) {
    push({
      name: template.name,
      description: template.description || `${template.name} (${template.sourceInfo.source})`,
      ...template.argumentHint !== void 0 ? { input: { hint: template.argumentHint } } : {},
      _meta: { pi: { source: "prompt", path: template.filePath } }
    });
  }
  if (options.enableSkillCommands) {
    for (const skill of session.resourceLoader.getSkills().skills) {
      push({
        name: `skill:${skill.name}`,
        description: skill.description,
        input: { hint: "instructions for the skill" },
        _meta: { pi: { source: "skill", path: skill.filePath } }
      });
    }
  }
  return list;
}

// src/acp/prompt.ts
import { fileURLToPath as fileURLToPath2 } from "url";
var UnsupportedPromptContentError = class extends Error {
  constructor(contentType) {
    super(`unsupported prompt content type: ${contentType}`);
    this.contentType = contentType;
    this.name = "UnsupportedPromptContentError";
  }
  contentType;
};
var IMAGE_MIME_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
function canonicalImageMimeType(mimeType) {
  const lower = mimeType.trim().toLowerCase();
  const mapped = lower === "image/jpg" ? "image/jpeg" : lower;
  return IMAGE_MIME_TYPES.has(mapped) ? mapped : void 0;
}
function resourcePath(uri) {
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath2(uri);
    } catch {
      return uri.slice("file://".length);
    }
  }
  return uri;
}
function contextBlock(uri, text) {
  return `<context ref=${JSON.stringify(resourcePath(uri))}>
${text}
</context>`;
}
function convertPrompt(blocks, options = {}) {
  const parts = [];
  const display = [];
  const images = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        parts.push(block.text);
        display.push(block.text);
        break;
      case "resource_link": {
        const path = resourcePath(block.uri);
        parts.push(`
[resource_link name=${JSON.stringify(block.name)} path=${JSON.stringify(path)}]
`);
        display.push(`@${block.name}`);
        break;
      }
      case "resource": {
        const resource = block.resource;
        if ("text" in resource && typeof resource.text === "string") {
          parts.push(`
${contextBlock(resource.uri, resource.text)}
`);
          display.push(`@${resourcePath(resource.uri)}`);
          break;
        }
        throw new UnsupportedPromptContentError("resource (binary)");
      }
      case "image": {
        if (options.images === false) throw new UnsupportedPromptContentError("image");
        const mimeType = canonicalImageMimeType(block.mimeType);
        if (mimeType === void 0) {
          throw new UnsupportedPromptContentError(`image (${block.mimeType})`);
        }
        if (block.data.length === 0) throw new UnsupportedPromptContentError("image (empty)");
        images.push({ type: "image", data: block.data, mimeType });
        display.push("[image]");
        break;
      }
      case "audio":
        throw new UnsupportedPromptContentError("audio");
      default:
        throw new UnsupportedPromptContentError(String(block.type));
    }
  }
  return {
    text: parts.join(""),
    images,
    displayText: display.join(" ").trim()
  };
}

// src/acp/tool-facts.ts
import { isAbsolute, resolve as resolvePath } from "path";
var MAX_TITLE_LENGTH = 80;
function firstLine(text, limit = MAX_TITLE_LENGTH) {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}\u2026` : line;
}
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function toolPath(args) {
  const record = asRecord(args);
  for (const key of ["path", "file_path", "filePath", "file"]) {
    const value = asString(record[key]);
    if (value !== void 0) return value;
  }
  return void 0;
}
function absoluteToolPath(args, cwd) {
  const path = toolPath(args);
  if (path === void 0) return void 0;
  return isAbsolute(path) ? path : resolvePath(cwd, path);
}
function isShellTool(name) {
  return name === "bash" || name === "powershell";
}
function isFileMutationTool(name) {
  return name === "edit" || name === "write";
}
function isMcpTool(name) {
  return name.startsWith("mcp__");
}
function parseMcpToolName(name) {
  if (!isMcpTool(name)) return void 0;
  const rest = name.slice("mcp__".length);
  const index = rest.indexOf("__");
  if (index <= 0) return void 0;
  return { server: rest.slice(0, index), tool: rest.slice(index + 2) };
}
function classifyToolCall(name, args, cwd, line) {
  const record = asRecord(args);
  const absPath = absoluteToolPath(record, cwd);
  const displayPath = toolPath(record);
  const locations = absPath !== void 0 ? [{ path: absPath, ...line !== void 0 ? { line } : {} }] : [];
  const facts = (kind, title) => ({ kind, title, locations });
  switch (name) {
    case "bash":
    case "powershell": {
      const command = asString(record["command"]);
      return facts("execute", command !== void 0 ? firstLine(command) : name);
    }
    case "read":
      return facts("read", displayPath !== void 0 ? `Read ${displayPath}` : "Read file");
    case "write":
      return facts("edit", displayPath !== void 0 ? `Write ${displayPath}` : "Write file");
    case "edit":
      return facts("edit", displayPath !== void 0 ? `Edit ${displayPath}` : "Edit file");
    case "grep": {
      const pattern = asString(record["pattern"]);
      return facts("search", pattern !== void 0 ? `Search for '${firstLine(pattern, 50)}'` : "Search");
    }
    case "find": {
      const pattern = asString(record["pattern"]);
      return facts("search", pattern !== void 0 ? `Find ${firstLine(pattern, 50)}` : "Find files");
    }
    case "ls":
      return facts("search", displayPath !== void 0 ? `List ${displayPath}` : "List directory");
    default:
      break;
  }
  const mcp = parseMcpToolName(name);
  const lowered = (mcp?.tool ?? name).toLowerCase();
  const label = mcp !== void 0 ? `${mcp.server}: ${mcp.tool}` : name;
  if (/(^|_)(grep|glob|find|search|ls|list)($|_)/.test(lowered)) {
    const query = asString(record["query"]) ?? asString(record["pattern"]);
    return facts("search", query !== void 0 ? `${label} '${firstLine(query, 50)}'` : label);
  }
  if (/(fetch|web|http|browse|url)/.test(lowered)) {
    const url = asString(record["url"]) ?? asString(record["query"]);
    return facts("fetch", url !== void 0 ? `${label} ${firstLine(url, 60)}` : label);
  }
  if (/(delete|remove|rm)($|_)/.test(lowered)) return facts("delete", label);
  if (/(move|rename|mv)($|_)/.test(lowered)) return facts("move", label);
  if (/(think|plan|todo|reason)/.test(lowered)) return facts("think", label);
  if (/(job|task|run|exec|shell|command)/.test(lowered)) return facts("execute", label);
  return facts("other", label);
}
function toolResultText(result) {
  const record = asRecord(result);
  const content = record["content"];
  if (!Array.isArray(content)) return "";
  const texts = [];
  for (const block of content) {
    const b = asRecord(block);
    if (b["type"] === "text" && typeof b["text"] === "string") texts.push(b["text"]);
  }
  return texts.join("");
}
function toolResultImages(result) {
  const record = asRecord(result);
  const content = record["content"];
  if (!Array.isArray(content)) return [];
  const images = [];
  for (const block of content) {
    const b = asRecord(block);
    if (b["type"] === "image" && typeof b["data"] === "string" && typeof b["mimeType"] === "string") {
      images.push({ data: b["data"], mimeType: b["mimeType"] });
    }
  }
  return images;
}
function findUniqueLineNumber(text, needle) {
  if (needle.length === 0) return void 0;
  const first = text.indexOf(needle);
  if (first < 0) return void 0;
  if (text.indexOf(needle, first + needle.length) >= 0) return void 0;
  let line = 1;
  for (let i = 0; i < first; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}
function editOldTexts(args) {
  const record = asRecord(args);
  const out = [];
  if (typeof record["oldText"] === "string") out.push(record["oldText"]);
  let edits = record["edits"];
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      edits = void 0;
    }
  }
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      const oldText = asRecord(edit)["oldText"];
      if (typeof oldText === "string" && !out.includes(oldText)) out.push(oldText);
    }
  }
  return out;
}
function diffStats(oldText, newText) {
  const split = (text) => text.length === 0 ? [] : text.replace(/\n$/, "").split("\n");
  const newLines = split(newText);
  if (oldText === null) return { added: newLines.length, removed: 0 };
  const oldLines = split(oldText);
  const counts = /* @__PURE__ */ new Map();
  for (const line of oldLines) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of newLines) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) counts.set(line, remaining - 1);
    else added += 1;
  }
  let removed = 0;
  for (const remaining of counts.values()) removed += remaining;
  return { added, removed };
}
function fenceShellOutput(text) {
  const trimmed = text.replace(/\n+$/, "");
  return trimmed.length === 0 ? "" : `\`\`\`sh
${trimmed}
\`\`\`
`;
}

// src/acp/message-id.ts
function formatAssistantMessageId(parentId, ordinal) {
  return `${parentId ?? "root"}:${ordinal}`;
}
function isAssistantEntry(entry) {
  return entry.type === "message" && entry.message.role === "assistant";
}
function assistantAcpMessageId(entry, entries) {
  let ordinal = 0;
  for (const candidate of entries) {
    if (!isAssistantEntry(candidate) || candidate.parentId !== entry.parentId) continue;
    ordinal += 1;
    if (candidate.id === entry.id) return formatAssistantMessageId(entry.parentId, ordinal);
  }
  return formatAssistantMessageId(entry.parentId, ordinal + 1);
}
function nextAssistantMessageId(parentId, entries) {
  let ordinal = 0;
  for (const entry of entries) {
    if (isAssistantEntry(entry) && entry.parentId === parentId) ordinal += 1;
  }
  return formatAssistantMessageId(parentId, ordinal + 1);
}

// src/acp/extension-events.ts
import { createEventBus } from "@earendil-works/pi-coding-agent";
var PHASE_WORDS = {
  started: ["started", "start", "spawned", "spawn", "created", "create", "begin", "began", "opened", "open"],
  update: ["update", "updated", "progress", "status", "delta", "tick", "heartbeat", "busy", "notice"],
  completed: [
    "complete",
    "completed",
    "done",
    "finished",
    "finish",
    "success",
    "succeeded",
    "terminal",
    "exit",
    "exited",
    "ended",
    "end",
    "closed",
    "close",
    "settled"
  ],
  failed: ["failed", "fail", "failure", "error", "errored", "crashed", "blocked"],
  cancelled: ["cancel", "cancelled", "canceled", "aborted", "abort", "stop", "stopped", "killed"],
  request: ["request", "ask"],
  response: ["response", "reply", "result", "ack", "acknowledge"]
};
var CORRELATION_KEYS = [
  "id",
  "runId",
  "taskId",
  "jobId",
  "childId",
  "requestId",
  "asyncId",
  "workflowId",
  "sessionId",
  "pid"
];
var MAX_PAYLOAD_CHARS = 8e3;
var MAX_DEPTH = 6;
function inferPhase(name) {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    for (const [phase, words] of Object.entries(PHASE_WORDS)) {
      if (words.includes(token)) return phase;
    }
  }
  return void 0;
}
function inferCorrelationId(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return void 0;
  const record = payload;
  for (const key of CORRELATION_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return void 0;
}
function sanitizePayload(value) {
  let truncated = false;
  const seen = /* @__PURE__ */ new WeakSet();
  const walk = (input, depth) => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "undefined" || typeof input === "function" || typeof input === "symbol") {
      truncated = true;
      return void 0;
    }
    if (typeof input !== "object") return void 0;
    if (seen.has(input)) {
      truncated = true;
      return "[circular]";
    }
    if (depth >= MAX_DEPTH) {
      truncated = true;
      return Array.isArray(input) ? `[array ${input.length}]` : "[object]";
    }
    seen.add(input);
    if (input instanceof Date) return input.toISOString();
    if (input instanceof Error) return { name: input.name, message: input.message };
    if (Array.isArray(input)) return input.map((item) => walk(item, depth + 1) ?? null);
    if (typeof input.then === "function") {
      truncated = true;
      return "[promise]";
    }
    const out = {};
    for (const [key, item] of Object.entries(input)) {
      const walked = walk(item, depth + 1);
      if (walked !== void 0) out[key] = walked;
    }
    return out;
  };
  let payload = walk(value, 0);
  let text;
  try {
    text = JSON.stringify(payload) ?? "null";
  } catch {
    return { payload: "[unserializable]", truncated: true };
  }
  if (text.length > MAX_PAYLOAD_CHARS) {
    truncated = true;
    payload = { _truncated: true, preview: text.slice(0, MAX_PAYLOAD_CHARS) };
  }
  return { payload, truncated };
}
function describeExtensionEvent(channel, data) {
  const separator = channel.search(/[:.]/);
  const namespace = separator > 0 ? channel.slice(0, separator) : "pi";
  const name = separator > 0 ? channel.slice(separator + 1) : channel;
  const { payload, truncated } = sanitizePayload(data);
  const phase = inferPhase(name);
  const correlationId = inferCorrelationId(data);
  return {
    channel,
    namespace,
    name,
    ...phase !== void 0 ? { phase } : {},
    ...correlationId !== void 0 ? { correlationId } : {},
    payload,
    truncated
  };
}
function createTappedEventBus(observe) {
  const inner = createEventBus();
  return {
    emit(channel, data) {
      try {
        observe(channel, data);
      } catch {
      }
      inner.emit(channel, data);
    },
    on: (channel, handler) => inner.on(channel, handler),
    clear: () => inner.clear(),
    inject: (channel, data) => inner.emit(channel, data)
  };
}

// src/acp/custom-entries.ts
function contentText(content) {
  return typeof content === "string" ? content : toolResultText({ content });
}
function customMessageUpdate(message, entryId) {
  const content = sanitizePayload(message.content);
  const details = message.details === void 0 ? void 0 : sanitizePayload(message.details);
  return {
    sessionUpdate: "session_info_update",
    _meta: piMeta({
      event: "custom_message",
      customType: message.customType,
      display: message.display,
      text: contentText(message.content),
      content: content.payload,
      ...details !== void 0 ? { details: details.payload } : {},
      truncated: content.truncated || details?.truncated === true,
      ...entryId !== void 0 ? { entryId } : {}
    })
  };
}
function customEntryUpdate(customType, data, entryId) {
  const payload = data === void 0 ? void 0 : sanitizePayload(data);
  return {
    sessionUpdate: "session_info_update",
    _meta: piMeta({
      event: "custom_entry",
      customType,
      ...payload !== void 0 ? { data: payload.payload } : {},
      truncated: payload?.truncated === true,
      ...entryId !== void 0 ? { entryId } : {}
    })
  };
}
function customEntryUpdates(entry) {
  switch (entry.type) {
    case "custom_message":
      return [
        customMessageUpdate(
          {
            customType: entry.customType,
            content: entry.content,
            display: entry.display,
            details: entry.details
          },
          entry.id
        )
      ];
    case "custom":
      return [customEntryUpdate(entry.customType, entry.data, entry.id)];
    case "message": {
      const message = entry.message;
      if (message.role !== "custom" || typeof message.customType !== "string") return [];
      return [
        customMessageUpdate(
          {
            customType: message.customType,
            content: message.content,
            display: message.display === true,
            details: message.details
          },
          entry.id
        )
      ];
    }
    default:
      return [];
  }
}

// src/acp/history.ts
function userContentToBlocks(content) {
  if (typeof content === "string") return content.length > 0 ? [{ type: "text", text: content }] : [];
  const blocks = [];
  for (const block of content) {
    if (block.type === "text") {
      if (block.text.length > 0) blocks.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
    }
  }
  return blocks;
}
function buildReplay(entries, cwd, idEntries = entries) {
  const updates = [];
  let title;
  const usage = { input: 0, output: 0, cachedRead: 0, cachedWrite: 0, thought: 0, saw: false };
  const openToolCalls = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    switch (entry.type) {
      case "session_info":
        if (typeof entry.name === "string" && entry.name.trim().length > 0) title = entry.name.trim();
        break;
      case "message": {
        const message = entry.message;
        if (message.role === "user") {
          for (const block of userContentToBlocks(entry.message.content)) {
            updates.push({ sessionUpdate: "user_message_chunk", content: block });
          }
        } else if (message.role === "assistant") {
          const assistant = entry.message;
          const messageId = assistantAcpMessageId(entry, idEntries);
          for (const block of assistant.content) {
            if (block.type === "thinking" && block.thinking.length > 0) {
              updates.push({
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: block.thinking },
                messageId
              });
            } else if (block.type === "text" && block.text.length > 0) {
              updates.push({
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: block.text },
                messageId
              });
            } else if (block.type === "toolCall") {
              const facts = classifyToolCall(block.name, block.arguments, cwd);
              openToolCalls.set(block.id, { name: block.name, args: block.arguments });
              updates.push({
                sessionUpdate: "tool_call",
                toolCallId: block.id,
                title: facts.title,
                name: block.name,
                kind: facts.kind,
                status: "pending",
                rawInput: block.arguments,
                ...facts.locations.length > 0 ? { locations: facts.locations } : {}
              });
            }
          }
          if (assistant.usage !== void 0) {
            const u = assistant.usage;
            usage.input += u.input ?? 0;
            usage.output += u.output ?? 0;
            usage.cachedRead += u.cacheRead ?? 0;
            usage.cachedWrite += u.cacheWrite ?? 0;
            usage.thought += u.reasoning ?? 0;
            usage.saw = true;
          }
          if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
            updates.push({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "" },
              messageId,
              _meta: piMeta({
                event: "assistant_message",
                stopReason: assistant.stopReason,
                ...assistant.errorMessage !== void 0 ? { error: assistant.errorMessage } : {}
              })
            });
          }
        } else if (message.role === "toolResult") {
          const result = entry.message;
          const open = openToolCalls.get(result.toolCallId);
          openToolCalls.delete(result.toolCallId);
          const name = result.toolName ?? open?.name ?? "tool";
          const text = toolResultText(result);
          const details = asRecord(result.details);
          const status = result.isError ? "failed" : "completed";
          const content = [];
          if (isShellTool(name)) {
            if (text.length > 0)
              content.push({ type: "content", content: { type: "text", text: fenceShellOutput(text) } });
          } else {
            const diffText = typeof details["diff"] === "string" ? details["diff"] : void 0;
            const shown = isFileMutationTool(name) && diffText !== void 0 && diffText.trim().length > 0 ? diffText : text;
            if (shown.length > 0) content.push({ type: "content", content: { type: "text", text: shown } });
          }
          for (const image of toolResultImages(result)) {
            content.push({
              type: "content",
              content: { type: "image", data: image.data, mimeType: image.mimeType }
            });
          }
          if (open === void 0) {
            const facts = classifyToolCall(name, {}, cwd);
            updates.push({
              sessionUpdate: "tool_call",
              toolCallId: result.toolCallId,
              title: facts.title,
              name,
              kind: facts.kind,
              status
            });
          }
          updates.push({
            sessionUpdate: "tool_call_update",
            toolCallId: result.toolCallId,
            status,
            ...content.length > 0 ? { content } : {},
            rawOutput: { content: result.content, details: result.details, isError: result.isError }
          });
        } else if (message.role === "bashExecution") {
          const bash = entry.message;
          const toolCallId = `bash-${entry.id}`;
          updates.push({
            sessionUpdate: "tool_call",
            toolCallId,
            title: bash.command.split("\n", 1)[0] ?? "bash",
            name: "bash",
            kind: "execute",
            status: "completed",
            rawInput: { command: bash.command }
          });
          updates.push({
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: bash.cancelled || bash.exitCode !== void 0 && bash.exitCode !== 0 ? "failed" : "completed",
            ...bash.output.length > 0 ? {
              content: [
                { type: "content", content: { type: "text", text: fenceShellOutput(bash.output) } }
              ]
            } : {},
            rawOutput: { output: bash.output, exitCode: bash.exitCode, cancelled: bash.cancelled }
          });
        } else if (message.role === "custom") {
          updates.push(...customEntryUpdates(entry));
        }
        break;
      }
      case "compaction":
        updates.push({
          sessionUpdate: "compaction_update",
          compactionId: `compaction-${entry.id}`,
          status: "completed",
          summary: [{ type: "text", text: entry.summary }],
          _meta: piMeta({ tokensBefore: entry.tokensBefore })
        });
        break;
      case "branch_summary":
        updates.push({
          sessionUpdate: "session_info_update",
          _meta: piMeta({ event: "branch_summary", fromId: entry.fromId, summary: entry.summary })
        });
        break;
      case "custom_message":
      case "custom":
        updates.push(...customEntryUpdates(entry));
        break;
      default:
        break;
    }
  }
  const finalUsage = usage.saw ? {
    totalTokens: usage.input + usage.output + usage.cachedRead + usage.cachedWrite,
    inputTokens: usage.input,
    outputTokens: usage.output,
    ...usage.thought > 0 ? { thoughtTokens: usage.thought } : {},
    ...usage.cachedRead > 0 ? { cachedReadTokens: usage.cachedRead } : {},
    ...usage.cachedWrite > 0 ? { cachedWriteTokens: usage.cachedWrite } : {}
  } : void 0;
  return { updates, title, usage: finalUsage };
}

// src/acp/translate.ts
function emptyWindow() {
  return {
    usage: { input: 0, output: 0, cachedRead: 0, cachedWrite: 0, thought: 0 },
    sawUsage: false,
    lastAssistant: void 0,
    error: void 0,
    compactionSeq: 0,
    fileChanges: /* @__PURE__ */ new Map()
  };
}
var num = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
function assistantStopReasonToAcp(message) {
  switch (message?.stopReason) {
    case "aborted":
      return "cancelled";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}
var SessionProjection = class {
  cwd;
  terminalMode;
  files;
  toolOwner;
  toolCalls = /* @__PURE__ */ new Map();
  window = emptyWindow();
  contextWindow;
  messageSeq = 0;
  currentMessageId;
  /** Set by the session before the assistant `message_start` it belongs to. */
  notedAssistantId;
  constructor(options) {
    this.cwd = options.cwd;
    const mode = options.terminalOutput;
    this.terminalMode = mode === true ? "terminal_output" : mode === false || mode === void 0 ? "none" : mode;
    this.files = options.files;
    this.toolOwner = options.toolOwner ?? (() => void 0);
  }
  /** Replace the tool → extension lookup (after `reload`, extensions may change). */
  setToolOwner(lookup) {
    this.toolOwner = lookup;
  }
  terminalMeta(id, delta) {
    return { [this.terminalMode]: { terminal_id: id, data: delta } };
  }
  /**
   * Bind a client-owned ACP terminal to an open shell tool call (terminal
   * delegation). Returns the update that points the tool call at the terminal.
   */
  attachClientTerminal(toolCallId, terminalId) {
    const state = this.toolCalls.get(toolCallId);
    if (state === void 0) return void 0;
    state.clientTerminalId = terminalId;
    return {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: state.status,
      content: [{ type: "terminal", terminalId }]
    };
  }
  setContextWindow(size) {
    this.contextWindow = size !== void 0 && size > 0 ? size : void 0;
  }
  /** Reset per-prompt accumulators; call when a new `session/prompt` starts. */
  beginPrompt() {
    this.window = emptyWindow();
  }
  get lastAssistant() {
    return this.window.lastAssistant;
  }
  get promptError() {
    return this.window.error;
  }
  /** Files changed during the current prompt (edit/write with a readable result). */
  fileChanges() {
    return [...this.window.fileChanges.values()];
  }
  promptUsage() {
    if (!this.window.sawUsage) return void 0;
    const { input, output, cachedRead, cachedWrite, thought } = this.window.usage;
    return {
      totalTokens: input + output + cachedRead + cachedWrite,
      inputTokens: input,
      outputTokens: output,
      ...thought > 0 ? { thoughtTokens: thought } : {},
      ...cachedRead > 0 ? { cachedReadTokens: cachedRead } : {},
      ...cachedWrite > 0 ? { cachedWriteTokens: cachedWrite } : {}
    };
  }
  /** Forget open tool calls (e.g. after cancel) without emitting fabricated failures. */
  clearOpenToolCalls() {
    this.toolCalls.clear();
  }
  /**
   * Stable id for the next assistant message. The following `message_start`
   * consumes it, and text deltas emitted after that carry it immediately.
   */
  noteAssistantMessageId(id) {
    this.notedAssistantId = id;
  }
  onEvent(event) {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          this.messageSeq += 1;
          this.currentMessageId = this.notedAssistantId;
          this.notedAssistantId = void 0;
        }
        return [];
      case "message_update":
        return this.onMessageUpdate(event.assistantMessageEvent);
      case "message_end":
        return this.onMessageEnd(event.message);
      case "tool_execution_start":
        return this.onToolStart(event.toolCallId, event.toolName, event.args, event.parentToolCallId);
      case "tool_execution_update":
        return this.onToolUpdate(event.toolCallId, event.partialResult);
      case "tool_execution_end":
        return this.onToolEnd(event.toolCallId, event.result, event.isError);
      case "compaction_start":
        this.window.compactionSeq += 1;
        return [
          {
            sessionUpdate: "compaction_update",
            compactionId: this.compactionId(),
            status: "in_progress",
            _meta: piMeta({ reason: event.reason })
          }
        ];
      case "compaction_end": {
        const status = event.aborted ? "cancelled" : event.result === void 0 ? "failed" : "completed";
        const summary = event.result?.summary;
        return [
          {
            sessionUpdate: "compaction_update",
            compactionId: this.compactionId(),
            status,
            ...summary !== void 0 && summary.length > 0 ? { summary: [{ type: "text", text: summary }] } : {},
            ...event.errorMessage !== void 0 ? { error: event.errorMessage } : {},
            _meta: piMeta({
              reason: event.reason,
              ...event.result !== void 0 ? { tokensBefore: event.result.tokensBefore } : {}
            })
          }
        ];
      }
      case "auto_retry_start": {
        const seconds = Math.max(1, Math.round(event.delayMs / 1e3));
        return [
          {
            sessionUpdate: "session_info_update",
            _meta: piMeta({
              event: "auto_retry",
              phase: "start",
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              delayMs: event.delayMs,
              error: event.errorMessage
            })
          },
          {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `
_Retrying (attempt ${event.attempt}/${event.maxAttempts}, waiting ${seconds}s): ${event.errorMessage}_
`
            },
            _meta: piMeta({ notice: "auto_retry" })
          }
        ];
      }
      case "auto_retry_end":
        return [
          {
            sessionUpdate: "session_info_update",
            _meta: piMeta({
              event: "auto_retry",
              phase: "end",
              success: event.success,
              attempt: event.attempt,
              ...event.finalError !== void 0 ? { error: event.finalError } : {}
            })
          }
        ];
      case "queue_update":
        return [
          {
            sessionUpdate: "session_info_update",
            _meta: piMeta({
              event: "queue",
              steering: [...event.steering],
              followUp: [...event.followUp]
            })
          }
        ];
      case "entry_appended":
        return customEntryUpdates(event.entry);
      case "session_info_changed":
        return [
          {
            sessionUpdate: "session_info_update",
            title: event.name ?? null,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        ];
      default:
        return [];
    }
  }
  // ------------------------------------------------------------------ //
  // Assistant streaming                                                 //
  // ------------------------------------------------------------------ //
  compactionId() {
    return `compaction-${this.messageSeq}-${this.window.compactionSeq}`;
  }
  chunk(kind, text) {
    return {
      sessionUpdate: kind,
      content: { type: "text", text },
      ...this.currentMessageId !== void 0 ? { messageId: this.currentMessageId } : {}
    };
  }
  onMessageUpdate(event) {
    switch (event.type) {
      case "text_delta":
        return event.delta.length > 0 ? [this.chunk("agent_message_chunk", event.delta)] : [];
      case "thinking_delta":
        return event.delta.length > 0 ? [this.chunk("agent_thought_chunk", event.delta)] : [];
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end": {
        const block = event.partial.content[event.contentIndex];
        if (block === void 0 || block.type !== "toolCall") return [];
        return this.onToolCallStreamed(block, event.type === "toolcall_end");
      }
      default:
        return [];
    }
  }
  onToolCallStreamed(toolCall, complete) {
    const id = toolCall.id;
    if (!id) return [];
    const args = toolCall.arguments ?? {};
    const facts = classifyToolCall(toolCall.name, args, this.cwd);
    const existing = this.toolCalls.get(id);
    if (existing === void 0) {
      const state = {
        name: toolCall.name,
        status: "pending",
        args,
        facts,
        shellOutputSent: "",
        displayTerminal: false
      };
      this.toolCalls.set(id, state);
      return [this.toolCallCreated(id, state)];
    }
    existing.args = args;
    existing.facts = facts;
    if (!complete && existing.status === "in_progress") return [];
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        title: facts.title,
        kind: facts.kind,
        status: existing.status,
        rawInput: args,
        ...facts.locations.length > 0 ? { locations: facts.locations } : {}
      }
    ];
  }
  onMessageEnd(message) {
    const record = asRecord(message);
    if (record.role === "custom" && typeof record["customType"] === "string") {
      return [
        customMessageUpdate({
          customType: record["customType"],
          content: record["content"],
          display: record["display"] === true,
          details: record["details"]
        })
      ];
    }
    if (record.role !== "assistant") return [];
    const assistant = message;
    this.window.lastAssistant = assistant;
    if (assistant.stopReason === "error") {
      const text = typeof assistant.errorMessage === "string" ? assistant.errorMessage.trim() : "";
      this.window.error = text.length > 0 ? text : "The model request failed.";
    } else if (assistant.stopReason !== "aborted") {
      this.window.error = void 0;
    }
    const updates = [];
    const usage = assistant.usage;
    if (usage !== void 0) {
      const input = num(usage.input);
      const output = num(usage.output);
      const cachedRead = num(usage.cacheRead);
      const cachedWrite = num(usage.cacheWrite);
      const thought = num(usage.reasoning);
      if (input + output + cachedRead + cachedWrite > 0) {
        this.window.usage.input += input;
        this.window.usage.output += output;
        this.window.usage.cachedRead += cachedRead;
        this.window.usage.cachedWrite += cachedWrite;
        this.window.usage.thought += thought;
        this.window.sawUsage = true;
        const used = input + cachedRead + cachedWrite + output;
        if (this.contextWindow !== void 0 && used > 0) {
          const total = num(usage.cost?.total);
          updates.push({
            sessionUpdate: "usage_update",
            used,
            size: this.contextWindow,
            ...total > 0 ? { cost: { amount: total, currency: "USD" } } : {}
          });
        }
      }
    }
    updates.push({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "" },
      ...this.currentMessageId !== void 0 ? { messageId: this.currentMessageId } : {},
      _meta: piMeta({
        event: "assistant_message",
        stopReason: assistant.stopReason,
        model: `${assistant.provider}/${assistant.model}`
      })
    });
    return updates;
  }
  // ------------------------------------------------------------------ //
  // Tool execution                                                      //
  // ------------------------------------------------------------------ //
  toolCallCreated(id, state) {
    const terminal = this.terminalContent(id, state);
    const owner = this.toolOwner(state.name);
    const pi = owner !== void 0 || state.parentToolCallId !== void 0 ? piMeta({
      ...owner !== void 0 ? { extension: owner } : {},
      ...state.parentToolCallId !== void 0 ? { parentToolCallId: state.parentToolCallId } : {}
    }) : void 0;
    const meta = {
      ...terminal?._meta ?? {},
      ...pi ?? {}
    };
    return {
      sessionUpdate: "tool_call",
      toolCallId: id,
      title: state.facts.title,
      name: state.name,
      kind: state.facts.kind,
      status: state.status,
      rawInput: state.args,
      ...state.facts.locations.length > 0 ? { locations: state.facts.locations } : {},
      ...terminal !== void 0 ? { content: terminal.content } : {},
      ...Object.keys(meta).length > 0 ? { _meta: meta } : {}
    };
  }
  /** Terminal presentation for shell tools: client terminal (delegated) or display terminal (`_meta`). */
  terminalContent(id, state) {
    if (!isShellTool(state.name)) return void 0;
    if (state.clientTerminalId !== void 0) {
      return { content: [{ type: "terminal", terminalId: state.clientTerminalId }] };
    }
    if (this.terminalMode !== "none" && !state.displayTerminal) {
      state.displayTerminal = true;
      return {
        content: [{ type: "terminal", terminalId: id }],
        _meta: { terminal_info: { terminal_id: id, cwd: this.cwd } }
      };
    }
    return void 0;
  }
  onToolStart(id, name, args, parentToolCallId) {
    let line;
    let snapshot;
    if (isFileMutationTool(name) && this.files !== void 0) {
      const abs = absoluteToolPath(args, this.cwd);
      if (abs !== void 0) {
        const oldText = this.files.read(abs);
        snapshot = { path: abs, oldText };
        if (name === "edit" && oldText !== null) {
          for (const needle of editOldTexts(args)) {
            line = findUniqueLineNumber(oldText, needle);
            if (line !== void 0) break;
          }
        }
      }
    }
    const facts = classifyToolCall(name, args, this.cwd, line);
    const existing = this.toolCalls.get(id);
    if (existing === void 0) {
      const state = {
        name,
        status: "in_progress",
        args,
        facts,
        snapshot,
        shellOutputSent: "",
        displayTerminal: false,
        ...parentToolCallId !== void 0 ? { parentToolCallId } : {}
      };
      this.toolCalls.set(id, state);
      return [this.toolCallCreated(id, state)];
    }
    if (parentToolCallId !== void 0) existing.parentToolCallId = parentToolCallId;
    existing.status = "in_progress";
    existing.args = args;
    existing.facts = facts;
    existing.snapshot = snapshot;
    const terminal = existing.displayTerminal || existing.clientTerminalId !== void 0 ? void 0 : this.terminalContent(id, existing);
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        title: facts.title,
        kind: facts.kind,
        status: "in_progress",
        rawInput: args,
        ...facts.locations.length > 0 ? { locations: facts.locations } : {},
        ...terminal ?? {}
      }
    ];
  }
  onToolUpdate(id, partial) {
    const state = this.toolCalls.get(id);
    if (state === void 0) return [];
    if (isShellTool(state.name)) {
      if (state.clientTerminalId !== void 0) return [];
      const text2 = toolResultText(partial);
      const delta = text2.startsWith(state.shellOutputSent) ? text2.slice(state.shellOutputSent.length) : text2;
      state.shellOutputSent = text2;
      if (state.displayTerminal) {
        if (delta.length === 0) return [];
        return [
          {
            sessionUpdate: "tool_call_update",
            toolCallId: id,
            status: "in_progress",
            _meta: this.terminalMeta(id, delta)
          }
        ];
      }
      if (text2.length === 0) return [];
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: "in_progress",
          content: [{ type: "content", content: { type: "text", text: fenceShellOutput(text2) } }]
        }
      ];
    }
    if (isFileMutationTool(state.name)) return [];
    const text = toolResultText(partial);
    if (text.length === 0) return [];
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "in_progress",
        content: [{ type: "content", content: { type: "text", text } }]
      }
    ];
  }
  onToolEnd(id, result, isError) {
    const state = this.toolCalls.get(id);
    this.toolCalls.delete(id);
    const name = state?.name ?? "tool";
    const status = isError ? "failed" : "completed";
    const text = toolResultText(result);
    const details = asRecord(asRecord(result)["details"]);
    const updates = [];
    if (state === void 0) {
      updates.push({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status,
        ...text.length > 0 ? { content: [{ type: "content", content: { type: "text", text } }] } : {},
        rawOutput: result
      });
      return updates;
    }
    if (isShellTool(name)) {
      const exitCode = isError ? 1 : 0;
      if (state.clientTerminalId !== void 0) {
        updates.push({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status,
          rawOutput: result
        });
        return updates;
      }
      if (state.displayTerminal) {
        const delta = text.startsWith(state.shellOutputSent) ? text.slice(state.shellOutputSent.length) : text;
        updates.push({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status,
          rawOutput: result,
          _meta: {
            ...delta.length > 0 ? this.terminalMeta(id, delta) : {},
            terminal_exit: { terminal_id: id, exit_code: exitCode, signal: null }
          }
        });
        return updates;
      }
      updates.push({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status,
        ...text.length > 0 ? { content: [{ type: "content", content: { type: "text", text: fenceShellOutput(text) } }] } : {},
        rawOutput: result
      });
      return updates;
    }
    const content = [];
    let locations;
    if (isFileMutationTool(name) && !isError && state.snapshot !== void 0 && this.files !== void 0) {
      const newText = this.files.read(state.snapshot.path);
      if (newText !== null && (state.snapshot.oldText === null || newText !== state.snapshot.oldText)) {
        const stats = diffStats(state.snapshot.oldText, newText);
        const kind = state.snapshot.oldText === null ? "add" : "update";
        content.push({
          type: "diff",
          path: state.snapshot.path,
          ...state.snapshot.oldText !== null ? { oldText: state.snapshot.oldText } : {},
          newText,
          _meta: piMeta({ fileChange: kind, diffStats: stats })
        });
        const previous = this.window.fileChanges.get(state.snapshot.path);
        this.window.fileChanges.set(state.snapshot.path, {
          path: state.snapshot.path,
          kind: previous?.kind === "add" ? "add" : kind,
          added: (previous?.added ?? 0) + stats.added,
          removed: (previous?.removed ?? 0) + stats.removed
        });
      }
      const firstChangedLine = details["firstChangedLine"];
      if (typeof firstChangedLine === "number") {
        locations = [{ path: state.snapshot.path, line: firstChangedLine }];
      }
    }
    if (content.length === 0) {
      const diffText = typeof details["diff"] === "string" ? details["diff"] : void 0;
      const shown = isFileMutationTool(name) && diffText !== void 0 && diffText.trim().length > 0 ? diffText : text;
      if (shown.length > 0) content.push({ type: "content", content: { type: "text", text: shown } });
    }
    for (const image of toolResultImages(result)) {
      content.push({
        type: "content",
        content: { type: "image", data: image.data, mimeType: image.mimeType }
      });
    }
    updates.push({
      sessionUpdate: "tool_call_update",
      toolCallId: id,
      status,
      ...content.length > 0 ? { content } : {},
      ...locations !== void 0 ? { locations } : {},
      rawOutput: result
    });
    return updates;
  }
};

// src/acp/session.ts
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { readFileSync as readFileSync2 } from "fs";

// src/acp/delegation.ts
import {
  detectSupportedImageMimeTypeFromFile,
  getShellConfig,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition
} from "@earendil-works/pi-coding-agent";
import { readFile, access, mkdir } from "fs/promises";
function delegationFromClient(caps) {
  return {
    readTextFile: caps?.fs?.readTextFile === true,
    writeTextFile: caps?.fs?.writeTextFile === true,
    terminal: caps?.terminal === true
  };
}
var TERMINAL_POLL_MS = 250;
function isTextLike(path) {
  return !/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|tgz|tar|7z|woff2?|ttf|otf|mp[34]|mov|wasm|so|dylib|exe|bin)$/i.test(
    path
  );
}
function createDelegatedTools(options) {
  const { conn, sessionId, cwd, caps } = options;
  const tools = [];
  const readViaClient = async (absolutePath) => {
    if (!isTextLike(absolutePath) || await detectSupportedImageMimeTypeFromFile(absolutePath))
      return readFile(absolutePath);
    try {
      const response = await conn.readTextFile({ sessionId, path: absolutePath });
      return Buffer.from(response.content, "utf8");
    } catch (error) {
      logDebug(`fs/read_text_file failed for ${absolutePath}; falling back to disk: ${String(error)}`);
      return readFile(absolutePath);
    }
  };
  const writeViaClient = async (absolutePath, content) => {
    await conn.writeTextFile({ sessionId, path: absolutePath, content });
  };
  if (caps.readTextFile) {
    tools.push(
      createReadToolDefinition(cwd, {
        autoResizeImages: options.autoResizeImages,
        operations: {
          readFile: readViaClient,
          access: (path) => access(path),
          detectImageMimeType: detectSupportedImageMimeTypeFromFile
        }
      })
    );
  }
  if (caps.writeTextFile) {
    tools.push(
      createEditToolDefinition(cwd, {
        operations: {
          readFile: caps.readTextFile ? readViaClient : readFile,
          writeFile: writeViaClient,
          access: (path) => access(path)
        }
      })
    );
    tools.push(
      createWriteToolDefinition(cwd, {
        operations: {
          writeFile: writeViaClient,
          mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => void 0)
        }
      })
    );
  }
  if (caps.terminal) {
    const bash = createBashToolDefinition(cwd, {
      shellPath: options.shellPath,
      commandPrefix: options.commandPrefix
    });
    tools.push({
      ...bash,
      renderCall: void 0,
      renderResult: void 0,
      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        signal?.throwIfAborted();
        const input = params;
        const shell = getShellConfig(options.shellPath);
        if (shell.commandTransport === "stdin")
          return bash.execute(toolCallId, params, signal, onUpdate, ctx);
        const command = options.commandPrefix ? `${options.commandPrefix}
${input.command}` : input.command;
        const handle = await conn.createTerminal({
          sessionId,
          command: shell.shell,
          args: [...shell.args, command],
          cwd,
          outputByteLimit: 1e6
        });
        options.onTerminal?.(toolCallId, handle.id);
        let lastOutput = "";
        let killed = false;
        const onAbort = () => {
          killed = true;
          void handle.kill().catch(() => void 0);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
        const timeoutMs = typeof input.timeout === "number" && input.timeout > 0 ? input.timeout * 1e3 : void 0;
        const timer = timeoutMs !== void 0 ? setTimeout(() => {
          killed = true;
          void handle.kill().catch(() => void 0);
        }, timeoutMs) : void 0;
        const poll = setInterval(() => {
          void handle.currentOutput().then((snapshot) => {
            if (snapshot.output !== lastOutput) {
              lastOutput = snapshot.output;
              onUpdate?.({ content: [{ type: "text", text: lastOutput }], details: void 0 });
            }
          }).catch(() => void 0);
        }, TERMINAL_POLL_MS);
        try {
          const exit = await handle.waitForExit();
          const final = await handle.currentOutput();
          lastOutput = final.output;
          const exitCode = exit.exitCode ?? null;
          const text = `${lastOutput.replace(/\n+$/, "")}${killed ? "\n\n(terminated)" : ""}${exitCode !== null && exitCode !== 0 ? `

Command exited with code ${exitCode}` : ""}`;
          if (exitCode !== null && exitCode !== 0 || killed) {
            throw new Error(text.length > 0 ? text : `Command exited with code ${String(exitCode)}`);
          }
          return {
            content: [{ type: "text", text: text.length > 0 ? text : "(no output)" }],
            details: void 0
          };
        } finally {
          clearInterval(poll);
          if (timer !== void 0) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          void handle.release().catch(() => void 0);
        }
      }
    });
  }
  return tools;
}

// src/acp/errors.ts
import { RequestError } from "@agentclientprotocol/sdk";
function invalidParams(detail, data) {
  return RequestError.invalidParams(data, detail);
}
function internalError(detail, data) {
  return RequestError.internalError(data, detail);
}
function authRequired(detail, data) {
  return RequestError.authRequired(data, detail);
}
var AUTH_PATTERNS = [
  "no api key",
  "api key",
  "apikey",
  "not configured",
  "no model selected",
  "no models available",
  "authentication failed",
  "unauthorized",
  "invalid x-api-key",
  "401",
  "403"
];
function looksLikeAuthError(error) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return AUTH_PATTERNS.some((pattern) => message.includes(pattern));
}
function classifyFailure(message) {
  const lowered = message.toLowerCase();
  if (lowered.includes("abort") || lowered.includes("cancel")) return "cancelled";
  if (looksLikeAuthError(message)) return "auth_required";
  if (/(429|rate limit|rate_limit|too many requests|quota|overloaded|529)/.test(lowered))
    return "rate_limited";
  if (/(context (window|length)|too long|maximum context|prompt is too large|exceeds the (context|token))/.test(
    lowered
  ))
    return "context_overflow";
  if (/(econnreset|econnrefused|enotfound|etimedout|fetch failed|network|socket|dns|timeout)/.test(lowered))
    return "network";
  if (/(500|502|503|504|internal server error|bad gateway|service unavailable|upstream)/.test(lowered))
    return "provider_error";
  return "unknown";
}

// src/acp/extension-inventory.ts
function extensionInventory(session) {
  const out = [];
  for (const extension of session.resourceLoader.getExtensions().extensions) {
    if (extension.hidden === true) continue;
    const customTypes = /* @__PURE__ */ new Set([
      ...extension.messageRenderers.keys(),
      ...extension.entryRenderers?.keys() ?? []
    ]);
    out.push({
      path: extension.path,
      source: extension.sourceInfo.source,
      scope: extension.sourceInfo.scope,
      origin: extension.sourceInfo.origin,
      tools: [...extension.tools.keys()],
      commands: [...extension.commands.keys()],
      customTypes: [...customTypes]
    });
  }
  return out;
}
function toolOwnerLookup(session) {
  return (toolName) => {
    for (const extension of session.resourceLoader.getExtensions().extensions) {
      if (extension.tools.has(toolName)) return extension.path;
    }
    return void 0;
  };
}

// src/acp/mcp.ts
import { join as join2 } from "path";
import {
  createMcpExtension,
  createToolSearchExtension
} from "@earendil-works/pi-coding-agent";
function sanitizeServerName(raw) {
  const name = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return (name.length > 0 ? name : "server").slice(0, 64);
}
function namespaceKey(name) {
  return name.replace(/-/g, "_");
}
function uniqueServerName(raw, taken) {
  const base = sanitizeServerName(raw);
  let name = base;
  for (let index = 2; taken.has(namespaceKey(name)); index += 1) {
    const suffix = `_${index}`;
    name = base.slice(0, 64 - suffix.length) + suffix;
  }
  taken.add(namespaceKey(name));
  return name;
}
function literalConfigValue(value) {
  const escaped = value.replaceAll("$", "$$$$");
  return escaped.startsWith("!") ? `$!${escaped.slice(1)}` : escaped;
}
function invalidConfig(name, config) {
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  if ("url" in config) {
    let url;
    try {
      url = new URL(config.url);
    } catch {
      return "url must be an http or https URL";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "url must be an http or https URL";
  } else if (config.command.length === 0) {
    return "command must not be empty";
  }
  return void 0;
}
function configFor(server) {
  if ("type" in server && server.type === "sse") {
    return "legacy SSE transport is not supported; use the streamable HTTP URL";
  }
  if ("type" in server && server.type === "acp") {
    return "ACP-transport MCP servers are not supported";
  }
  if ("command" in server) {
    const env = {};
    for (const entry of server.env) env[entry.name] = literalConfigValue(entry.value);
    return { command: server.command, args: [...server.args], env, exposure: "deferred" };
  }
  if ("type" in server && server.type === "http") {
    const headers = {};
    for (const header of server.headers) headers[header.name] = literalConfigValue(header.value);
    return { type: "http", url: server.url, headers, exposure: "deferred" };
  }
  return "unsupported MCP transport (stdio and streamable HTTP are supported)";
}
function piMcpExtensions(agentDir) {
  return [
    { name: "tool-search", hidden: true, factory: createToolSearchExtension() },
    {
      name: "mcp",
      hidden: true,
      factory: createMcpExtension({
        loadConfig: () => ({ servers: [], errors: [], autoEnableCodemode: true }),
        logPath: join2(agentDir, "mcp.log")
      })
    }
  ];
}
function planAcpMcpServers(servers) {
  const diagnostics = [];
  const planned = [];
  const taken = /* @__PURE__ */ new Set();
  for (const server of servers ?? []) {
    const name = uniqueServerName(server.name, taken);
    const config = configFor(server);
    if (typeof config === "string") {
      diagnostics.push(`MCP server "${name}" unavailable: ${config}`);
      continue;
    }
    const invalid = invalidConfig(name, config);
    if (invalid !== void 0) {
      diagnostics.push(`MCP server "${name}" unavailable: ${invalid}`);
      continue;
    }
    planned.push({ name, config });
  }
  const extension = {
    name: "acp-mcp",
    hidden: true,
    factory(pi) {
      for (const server of planned) {
        try {
          pi.registerMcpServer(server.name, server.config);
        } catch (error) {
          const diagnostic = `MCP server "${server.name}" unavailable: ${errorMessage(error)}`;
          diagnostics.push(diagnostic);
          logWarn(diagnostic);
        }
      }
    }
  };
  return { servers: planned, diagnostics, extension };
}

// src/acp/ui-context.ts
var CHOICE_PREFIX = "choice-";
function withDialogOptions(opts, fallback, run) {
  if (opts?.signal?.aborted) return Promise.resolve(fallback);
  return new Promise((resolve2) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== void 0) clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
      resolve2(value);
    };
    const onAbort = () => finish(fallback);
    const timer = opts?.timeout !== void 0 ? setTimeout(() => finish(fallback), opts.timeout) : void 0;
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    run().then(finish, (error) => {
      logDebug(`extension UI request failed: ${String(error)}`);
      finish(fallback);
    });
  });
}
function acceptedContent(response) {
  if (response.action !== "accept") return void 0;
  const content = response.content;
  return content !== null && typeof content === "object" ? content : {};
}
function createAcpUiContext(deps) {
  const { conn, sessionId, emit } = deps;
  const elicit = (message, properties, required, meta) => {
    const request = {
      mode: "form",
      sessionId,
      message,
      requestedSchema: { type: "object", properties, required },
      _meta: piMeta(meta)
    };
    return conn.createElicitation(request);
  };
  const requestChoice = async (title, method, options, rawInput) => {
    const response = await conn.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: `pi-ui-${method}-${Date.now().toString(36)}`,
        title,
        kind: "other",
        status: "pending",
        rawInput: { method, ...rawInput }
      },
      options
    });
    return response.outcome.outcome === "selected" ? response.outcome.optionId : void 0;
  };
  const infoMeta = (value) => {
    emit({ sessionUpdate: "session_info_update", _meta: piMeta(value) });
  };
  return {
    select: (title, options, opts) => withDialogOptions(opts, void 0, async () => {
      if (options.length === 0) return void 0;
      if (deps.formElicitation()) {
        const response = await elicit(
          title,
          {
            choice: {
              type: "string",
              title,
              oneOf: options.map((option, index) => ({ const: `${CHOICE_PREFIX}${index}`, title: option }))
            }
          },
          ["choice"],
          { ui: "select", title, options }
        );
        const content = acceptedContent(response);
        const value = content?.["choice"];
        if (typeof value !== "string" || !value.startsWith(CHOICE_PREFIX)) return void 0;
        return options[Number(value.slice(CHOICE_PREFIX.length))];
      }
      const optionId = await requestChoice(
        title,
        "select",
        options.map((name, index) => ({ optionId: `${CHOICE_PREFIX}${index}`, name, kind: "allow_once" })),
        { options }
      );
      if (optionId === void 0 || !optionId.startsWith(CHOICE_PREFIX)) return void 0;
      return options[Number(optionId.slice(CHOICE_PREFIX.length))];
    }),
    confirm: (title, message, opts) => withDialogOptions(opts, false, async () => {
      if (deps.formElicitation()) {
        const response = await elicit(
          `${title}

${message}`,
          { confirmed: { type: "boolean", title, description: message } },
          ["confirmed"],
          { ui: "confirm", title, message }
        );
        const content = acceptedContent(response);
        return content?.["confirmed"] === true;
      }
      const optionId = await requestChoice(
        title,
        "confirm",
        [
          { optionId: "yes", name: "Yes", kind: "allow_once" },
          { optionId: "no", name: "No", kind: "reject_once" }
        ],
        { message }
      );
      return optionId === "yes";
    }),
    input: (title, placeholder, opts) => withDialogOptions(opts, void 0, async () => {
      if (!deps.formElicitation()) {
        logWarn(`extension input "${title}" cancelled: client does not support form elicitation`);
        return void 0;
      }
      const response = await elicit(
        title,
        {
          value: {
            type: "string",
            title,
            ...placeholder !== void 0 ? { description: placeholder } : {}
          }
        },
        ["value"],
        { ui: "input", title, ...placeholder !== void 0 ? { placeholder } : {} }
      );
      const content = acceptedContent(response);
      const value = content?.["value"];
      return typeof value === "string" ? value : void 0;
    }),
    editor: async (title, prefill) => {
      if (!deps.formElicitation()) {
        logWarn(`extension editor "${title}" cancelled: client does not support form elicitation`);
        return void 0;
      }
      try {
        const response = await elicit(
          title,
          { value: { type: "string", title, ...prefill !== void 0 ? { default: prefill } : {} } },
          ["value"],
          { ui: "editor", title, ...prefill !== void 0 ? { prefill } : {} }
        );
        const content = acceptedContent(response);
        const value = content?.["value"];
        return typeof value === "string" ? value : void 0;
      } catch (error) {
        logDebug(`extension editor failed: ${String(error)}`);
        return void 0;
      }
    },
    notify(message, type) {
      emit({
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `
> ${type === "error" ? "\u26A0 " : type === "warning" ? "! " : ""}${message}
`
        },
        _meta: piMeta({ notify: { level: type ?? "info", message } })
      });
    },
    onTerminalInput: () => () => {
    },
    setStatus: (key, text) => infoMeta({ event: "status", key, text: text ?? null }),
    setWorkingMessage: () => {
    },
    setWorkingVisible: () => {
    },
    setWorkingIndicator: () => {
    },
    setHiddenThinkingLabel: () => {
    },
    setWidget: (key, content, options) => {
      if (content === void 0 || Array.isArray(content)) {
        infoMeta({
          event: "widget",
          key,
          lines: content ?? null,
          placement: options?.placement ?? "aboveEditor"
        });
      }
    },
    setFooter: () => {
    },
    setHeader: () => {
    },
    setTitle: (title) => emit({ sessionUpdate: "session_info_update", title, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }),
    custom: async () => void 0,
    pasteToEditor: (text) => infoMeta({ event: "editor_text", text }),
    setEditorText: (text) => infoMeta({ event: "editor_text", text }),
    getEditorText: () => "",
    addAutocompleteProvider: () => {
    },
    setEditorComponent: () => {
    },
    getEditorComponent: () => void 0,
    get theme() {
      return deps.theme;
    },
    getAllThemes: () => [],
    getTheme: () => void 0,
    setTheme: () => ({ success: false, error: "Theme switching is not available over ACP" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {
    }
  };
}

// src/acp/workspace-scope.ts
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir, homedir } from "os";
import { isAbsolute as isAbsolute2, dirname as dirname2, join as join3, parse, relative, sep } from "path";
var ADDITIONAL_DIRECTORIES_ENTRY = "pi-acp:additional-directories";
var MAX_ADDITIONAL_DIRECTORIES = 16;
var SCOPE_EXTENSION = "pi-acp-workspace-scope";
var SHELL_DEVICES = /* @__PURE__ */ new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/stdin",
  "/dev/tty",
  "/dev/zero"
]);
var AdditionalDirectoriesError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AdditionalDirectoriesError";
  }
};
var supportedCache;
function additionalDirectoriesSupported() {
  if (process.env.PI_ACP_WORKSPACE_SCOPE === "0") return false;
  if (supportedCache !== void 0) return supportedCache;
  const probe = mkdtempSync(join3(tmpdir(), "pi-acp-scope-"));
  try {
    const inside = join3(probe, "inside");
    const outside = join3(probe, "outside");
    mkdirSync(inside);
    mkdirSync(outside);
    const secret = join3(outside, "secret.txt");
    writeFileSync(secret, "secret\n");
    const scope = new WorkspaceScope(inside);
    scope.enforced = true;
    const created = scope.denial(join3(inside, "new.txt"));
    const leaked = scope.denial(secret);
    supportedCache = created === void 0 && leaked !== void 0;
  } catch {
    supportedCache = false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
  return supportedCache;
}
function additionalDirectoriesCapability() {
  return additionalDirectoriesSupported() ? {} : void 0;
}
function resolveAdditionalDirectoriesRequest(requested, cwd, options) {
  const omitted = requested === void 0 || requested === null;
  if (!options.supported) {
    if (!omitted) {
      const listed = requested.length > 0 ? ` (${requested.join(", ")})` : "";
      return {
        kind: "ignored",
        directories: [],
        warning: `additionalDirectories ignored${listed}: workspace scope is unavailable`
      };
    }
    return { kind: "ignored", directories: [] };
  }
  if (omitted) {
    return options.restore ? { kind: "restore", directories: [] } : { kind: "off", directories: [] };
  }
  return { kind: "explicit", directories: validateAdditionalDirectories(requested, cwd) };
}
function validateAdditionalDirectories(requested, cwd) {
  if (!Array.isArray(requested)) {
    throw new AdditionalDirectoriesError("additionalDirectories must be an array of absolute paths");
  }
  const primary = canonicalizeExistingDirectory(cwd);
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const entry of requested) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new AdditionalDirectoriesError("additionalDirectories entries must be non-empty strings");
    }
    if (!isAbsolute2(entry)) {
      throw new AdditionalDirectoriesError(`additional directory must be an absolute path: ${entry}`);
    }
    if (isFilesystemRoot(entry)) {
      throw new AdditionalDirectoriesError(`additional directory must not be a filesystem root: ${entry}`);
    }
    let canonical;
    try {
      canonical = canonicalizeExistingDirectory(entry);
    } catch {
      throw new AdditionalDirectoriesError(`additional directory is not an existing directory: ${entry}`);
    }
    if (isFilesystemRoot(canonical)) {
      throw new AdditionalDirectoriesError(`additional directory must not be a filesystem root: ${entry}`);
    }
    if (canonical === homeDirectory()) {
      throw new AdditionalDirectoriesError(`additional directory must not be the home directory: ${entry}`);
    }
    if (canonical === primary || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length > MAX_ADDITIONAL_DIRECTORIES) {
      throw new AdditionalDirectoriesError(
        `additionalDirectories accepts at most ${MAX_ADDITIONAL_DIRECTORIES} roots`
      );
    }
  }
  return out;
}
function isFilesystemRoot(filePath) {
  try {
    const resolved = realpathSync(filePath);
    return resolved === parse(resolved).root;
  } catch {
    const { root } = parse(filePath);
    const normalized = filePath.endsWith(sep) ? filePath.slice(0, -1) || root : filePath;
    return normalized === root || filePath === root;
  }
}
var EMPTY_RECORD = { directories: [], enforced: false };
function persistedAdditionalDirectoriesRecord(entries) {
  let leaf;
  const byId = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.type === "session" || typeof entry.id !== "string") continue;
    byId.set(entry.id, entry);
    leaf = entry;
  }
  const seen = /* @__PURE__ */ new Set();
  let current = leaf;
  while (current !== void 0) {
    if (typeof current.id === "string") {
      if (seen.has(current.id)) break;
      seen.add(current.id);
    }
    if (current.type === "custom" && current.customType === ADDITIONAL_DIRECTORIES_ENTRY) {
      return recordFromData(current.data);
    }
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : void 0;
  }
  return EMPTY_RECORD;
}
function persistedAdditionalDirectories(entries) {
  const record = persistedAdditionalDirectoriesRecord(entries);
  return record.enforced ? record.directories : [];
}
function savedAdditionalDirectories(entries) {
  return persistedAdditionalDirectoriesRecord(entries).directories;
}
var WorkspaceScope = class {
  cwd;
  /** Set only after the client opts in with `additionalDirectories` or the restore meta. */
  enforced = false;
  extra = [];
  constructor(cwd) {
    this.cwd = canonicalizeExistingDirectory(cwd);
  }
  get additionalDirectories() {
    return [...this.extra];
  }
  get roots() {
    return [this.cwd, ...this.extra];
  }
  setAdditional(directories) {
    this.extra = [...directories];
  }
  /** `undefined` when the boundary is off, or when `input` is inside a root. */
  denial(input) {
    if (!this.enforced) return void 0;
    let canonical;
    try {
      canonical = canonicalAccessPath(input, this.cwd);
    } catch (error) {
      return error instanceof Error ? error.message : `path cannot be resolved safely: ${input}`;
    }
    if (this.roots.some((root) => isInsideRoot(root, canonical))) return void 0;
    return `path is outside the session workspace: ${canonical}`;
  }
  /** `undefined` when the boundary is off, or every named path is inside a root or a shell device. */
  shellDenial(command) {
    if (!this.enforced) return void 0;
    const scan = shellAccessPaths(command);
    if (scan.unverifiable.length > 0) {
      return `command references a path the session cannot verify: ${scan.unverifiable[0]}`;
    }
    for (const candidate of scan.paths) {
      if (isShellDevice(candidate)) continue;
      const reason = this.denial(candidate);
      if (reason === void 0) continue;
      return `command references a path outside the session workspace: ${candidate}`;
    }
    return void 0;
  }
};
function workspaceScopeExtension(scope) {
  const factory = (pi) => {
    pi.on("tool_call", (event) => {
      const reason = toolScopeDenial(event.toolName, event.input, scope);
      if (reason !== void 0) return { block: true, reason };
      return void 0;
    });
    pi.on("before_agent_start", (event) => {
      if (!scope.enforced) return void 0;
      const extra = scope.additionalDirectories;
      if (extra.length === 0) return void 0;
      const note = [
        "Additional workspace roots are in filesystem scope for read, write, edit, grep, find, ls, and bash.",
        "They are not project roots: skills and AGENTS.md stay on the primary working directory.",
        "Relative paths still resolve against the primary working directory.",
        ...extra.map((dir) => `- ${dir}`)
      ].join("\n");
      return { systemPrompt: `${event.systemPrompt}

${note}` };
    });
  };
  return { name: SCOPE_EXTENSION, hidden: true, factory };
}
function scopeExtensionLoaded(paths) {
  return paths.some((path) => path.includes(SCOPE_EXTENSION));
}
function toolScopeDenial(toolName, input, scope) {
  const record = input !== null && typeof input === "object" ? input : {};
  switch (toolName) {
    case "read":
    case "write":
    case "edit":
    case "grep":
    case "find":
    case "ls": {
      const path = record["path"];
      if (typeof path !== "string" || path.length === 0) {
        if (toolName === "grep" || toolName === "find" || toolName === "ls") return void 0;
        return "path is outside the session workspace: (missing path)";
      }
      return scope.denial(path);
    }
    case "bash":
    case "powershell": {
      const command = record["command"];
      if (typeof command !== "string")
        return "command references a path the session cannot verify: (missing command)";
      return scope.shellDenial(command);
    }
    default:
      return void 0;
  }
}
function shellAccessPaths(command) {
  const paths = [];
  const unverifiable = [];
  const seen = /* @__PURE__ */ new Set();
  let word = "";
  let quote;
  let quoted = "";
  let redirect = false;
  const take = (candidate, asRedirect, nested = false) => {
    if (candidate.length === 0 || seen.has(candidate)) return;
    if (candidate.includes("$") || candidate.includes("`") || /^~[^/\\]/.test(candidate)) {
      seen.add(candidate);
      unverifiable.push(candidate);
      return;
    }
    if (asRedirect || isPathLike(candidate)) {
      seen.add(candidate);
      paths.push(candidate);
    }
    if (!nested) {
      for (const piece of absolutePieces(candidate)) {
        if (piece !== candidate) take(piece, false, true);
      }
    }
  };
  const emit = () => {
    if (word.length === 0) return;
    const token = word;
    const asRedirect = redirect;
    word = "";
    redirect = false;
    if (token.startsWith("-") && !asRedirect) {
      const eq = token.indexOf("=");
      if (eq !== -1) take(token.slice(eq + 1), false);
      return;
    }
    take(token, asRedirect);
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote !== void 0) {
      if (ch === quote) {
        if (isPathLike(quoted)) take(quoted, false);
        quoted = "";
        quote = void 0;
      } else if (quote === '"' && ch === "\\" && i + 1 < command.length) {
        const next = command[i + 1];
        word += next;
        quoted += next;
        i += 1;
      } else {
        word += ch;
        quoted += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = "";
      continue;
    }
    if (ch === "\\") {
      if (i + 1 < command.length) {
        word += command[i + 1];
        i += 1;
      }
      continue;
    }
    if (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
      emit();
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")") {
      emit();
      continue;
    }
    if ((ch === ">" || ch === "<") && (/^\d+$/.test(word) || word === "&" || word.length === 0)) {
      word = "";
      redirect = true;
      while (i + 1 < command.length && (command[i + 1] === ">" || command[i + 1] === "<")) i += 1;
      continue;
    }
    word += ch;
  }
  emit();
  return { paths, unverifiable };
}
function recordFromData(data) {
  if (data === null || typeof data !== "object") return EMPTY_RECORD;
  const record = data;
  const directories = Array.isArray(record.directories) ? record.directories.filter((dir) => typeof dir === "string" && dir.length > 0) : [];
  const enforced = record.enforced === false ? false : record.enforced === true ? true : directories.length > 0;
  return { directories, enforced };
}
function homeDirectory() {
  const home = homedir();
  if (home.length === 0) return void 0;
  try {
    return realpathSync(home);
  } catch {
    return home;
  }
}
function canonicalizeExistingDirectory(filePath) {
  const real = realpathSync(filePath);
  if (!statSync(real).isDirectory()) throw new Error("not a directory");
  return real;
}
function isInsideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || !rel.startsWith("..") && !isAbsolute2(rel);
}
function isPathLike(token) {
  if (token.length === 0 || /\s/.test(token)) return false;
  if (token.startsWith("-")) return false;
  return token.startsWith("/") || token.startsWith("~") || token.startsWith(".") || token.includes("/") || token.includes("\\") || token.includes("..");
}
function absolutePieces(text) {
  const pieces = [];
  for (const match of text.matchAll(/(?:\/|~\/)[^\s"'`)<>|&;]+/g)) {
    const piece = match[0];
    if (piece !== void 0 && piece.length > 1) pieces.push(piece);
  }
  return pieces;
}
function isShellDevice(filePath) {
  if (SHELL_DEVICES.has(filePath)) return true;
  return filePath.startsWith("/dev/fd/");
}
function expandHome(input) {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    const home = homedir().replace(/[/\\]+$/, "");
    return `${home}/${input.slice(2)}`;
  }
  return input;
}
function joinRelative(cwd, relativePath) {
  const prefix = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`;
  return prefix + relativePath;
}
function isEnoent(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function canonicalAccessPath(input, cwd) {
  const expanded = expandHome(input);
  if (expanded.startsWith("~")) throw new Error(`path cannot be resolved safely: ${input}`);
  const absolute = isAbsolute2(expanded) ? expanded : joinRelative(cwd, expanded);
  if (!isAbsolute2(absolute)) throw new Error(`path cannot be resolved safely: ${input}`);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(/[/\\]/).filter((part) => part.length > 0);
  let current = root;
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      const parent = dirname2(current);
      current = parent.length >= root.length ? parent : root;
      continue;
    }
    const next = current.endsWith(sep) ? `${current}${part}` : `${current}${sep}${part}`;
    let linked = false;
    try {
      linked = lstatSync(next).isSymbolicLink();
    } catch (error) {
      if (isEnoent(error)) {
        current = next;
        continue;
      }
      throw new Error(`path cannot be resolved safely: ${input}`);
    }
    if (linked) {
      try {
        current = realpathSync(next);
      } catch {
        throw new Error(`path cannot be resolved safely: ${input}`);
      }
      continue;
    }
    try {
      current = realpathSync(next);
    } catch (error) {
      if (isEnoent(error)) {
        current = next;
        continue;
      }
      throw new Error(`path cannot be resolved safely: ${input}`);
    }
  }
  return current;
}

// src/acp/session.ts
function readFileOrNull(path) {
  try {
    return readFileSync2(path, "utf8");
  } catch {
    return null;
  }
}
function stubTheme() {
  const identity = (_, text) => typeof text === "string" ? text : String(_);
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "name") return "acp";
        if (prop === "getColorMode") return () => "256color";
        if (prop === "getThinkingBorderColor" || prop === "getBashModeBorderColor")
          return () => (s) => s;
        if (prop === "getFgAnsi" || prop === "getBgAnsi") return () => "";
        return identity;
      }
    }
  );
}
var PiAcpSession = class _PiAcpSession {
  cwd;
  conn;
  projection;
  runtime;
  settings;
  features;
  resourceDiagnostics = [];
  eventBus;
  scope;
  directoryPlan;
  scopeReady = false;
  unsubscribe;
  inflight;
  cancelled = false;
  trustedProjects = /* @__PURE__ */ new Set();
  closed = false;
  deliveryError;
  closePromise;
  lastEmit = Promise.resolve();
  _sessionId = "";
  startupDiagnostics = [];
  constructor(options) {
    this.cwd = options.cwd;
    this.conn = options.conn;
    this.settings = options.settings;
    this.features = options.features;
    this.scope = new WorkspaceScope(options.cwd);
    this.directoryPlan = options.directoryPlan;
    this.projection = new SessionProjection({
      cwd: options.cwd,
      // A delegated client terminal owns the presentation; the display-terminal
      // extension only applies when pi runs the command itself.
      terminalOutput: options.features.delegation.terminal ? "none" : options.features.terminalOutput,
      files: { read: readFileOrNull }
    });
  }
  get sessionId() {
    return this._sessionId;
  }
  get session() {
    return this.runtime.session;
  }
  get isRunning() {
    return this.inflight !== void 0;
  }
  get diagnostics() {
    return [...this.startupDiagnostics, ...this.resourceDiagnostics];
  }
  /** Canonical additional roots currently in filesystem scope (not including `cwd`). */
  get additionalDirectories() {
    return this.scope.enforced ? this.scope.additionalDirectories : [];
  }
  /** True only when this session opted into the path boundary. */
  get additionalDirectoriesEnforced() {
    return this.scope.enforced;
  }
  /** Why a shell command is outside the session roots, if the boundary is on. */
  shellDenial(command) {
    return this.scope.shellDenial(command);
  }
  /**
   * Grow the persisted root list (`_pi/add_directory`) and turn the boundary on.
   * Same policy as a lifecycle request: absolute, not a filesystem root, not `$HOME`, at most 16.
   */
  addAdditionalDirectory(filePath) {
    if (!additionalDirectoriesSupported()) throw invalidParams("additionalDirectories are not available");
    if (!this.scopeReady) throw invalidParams("workspace scope is not loaded");
    let next;
    try {
      next = validateAdditionalDirectories(
        [...this.scope.enforced ? this.scope.additionalDirectories : [], filePath],
        this.cwd
      );
    } catch (error) {
      if (error instanceof AdditionalDirectoriesError) throw invalidParams(error.message);
      throw error;
    }
    const changed = !this.scope.enforced || !sameDirectories(next, this.scope.additionalDirectories);
    this.scope.enforced = true;
    this.scope.setAdditional(next);
    if (changed) this.persistDirectoryRecord(next, true);
    return this.additionalDirectories;
  }
  static async open(options) {
    const session = new _PiAcpSession(options);
    try {
      await session.boot(options);
      return session;
    } catch (error) {
      session.closed = true;
      session.unsubscribe?.();
      await session.runtime?.dispose().catch(() => void 0);
      throw error;
    }
  }
  // ------------------------------------------------------------------ //
  // Runtime creation                                                    //
  // ------------------------------------------------------------------ //
  async boot(options) {
    const { settings, modelRuntime } = options;
    const agentDir = settings.agentDir ?? getAgentDir();
    const sessionDir = settings.sessionDir;
    let sessionManager;
    if (options.sessionFile !== void 0 && options.fork === true) {
      sessionManager = SessionManager.forkFrom(options.sessionFile, this.cwd, sessionDir);
    } else if (options.sessionFile !== void 0) {
      sessionManager = SessionManager.open(options.sessionFile, sessionDir, this.cwd);
    } else {
      sessionManager = SessionManager.create(this.cwd, sessionDir);
    }
    this._sessionId = sessionManager.getSessionId();
    const mcp = planAcpMcpServers(options.mcpServers);
    this.eventBus = createTappedEventBus((channel, data) => this.onExtensionEvent(channel, data));
    const scopeEnabled = additionalDirectoriesSupported();
    const createRuntime = async ({
      cwd,
      agentDir: dir,
      sessionManager: sm,
      sessionStartEvent
    }) => {
      const trusted = this.resolveProjectTrust(cwd, dir);
      const settingsManager = SettingsManager.create(cwd, dir, { projectTrusted: trusted });
      const services = await createAgentSessionServices({
        cwd,
        agentDir: dir,
        settingsManager,
        modelRuntime,
        modelRuntimeSignal: AbortSignal.timeout(15e3),
        resourceLoaderOptions: {
          eventBus: this.eventBus,
          extensionFactories: [
            ...scopeEnabled ? [workspaceScopeExtension(this.scope)] : [],
            ...mcp.servers.length > 0 ? [...piMcpExtensions(dir), mcp.extension] : []
          ]
        }
      });
      const customTools = [];
      if (settings.delegation) {
        customTools.push(
          ...createDelegatedTools({
            conn: this.conn,
            sessionId: this._sessionId,
            cwd,
            caps: this.features.delegation,
            autoResizeImages: settingsManager.getImageAutoResize(),
            shellPath: settingsManager.getShellPath(),
            commandPrefix: settingsManager.getShellCommandPrefix(),
            onTerminal: (toolCallId, terminalId) => {
              const update = this.projection.attachClientTerminal(toolCallId, terminalId);
              if (update !== void 0) this.emit(update);
            }
          })
        );
      }
      let model;
      let thinkingLevel;
      if (settings.model !== void 0) {
        const resolved = resolveAliasedCliModel({ cliModel: settings.model, modelRuntime });
        if (resolved.error !== void 0) throw new Error(resolved.error);
        if (resolved.warning !== void 0) logWarn(resolved.warning);
        model = resolved.model;
        thinkingLevel = resolved.thinkingLevel;
      }
      const created = await createAgentSessionFromServices({
        services,
        sessionManager: sm,
        sessionStartEvent,
        customTools,
        ...model !== void 0 ? { model } : {},
        ...thinkingLevel !== void 0 ? { thinkingLevel } : {}
      });
      const diagnostics = [
        ...services.diagnostics,
        ...services.resourceLoader.getExtensions().errors.map(({ path, error }) => ({
          type: "error",
          message: `Failed to load extension "${path}": ${error}`
        })),
        ...trusted || !hasTrustRequiringProjectResources(cwd) ? [] : [
          {
            type: "warning",
            message: `Project resources in ${cwd}/.pi were not loaded (untrusted). Run /trust to load them.`
          }
        ]
      ];
      return { ...created, services, diagnostics };
    };
    this.runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: this.cwd,
      agentDir,
      sessionManager,
      ...options.reason !== "new" ? {
        sessionStartEvent: {
          type: "session_start",
          reason: options.reason === "load" ? "resume" : options.reason
        }
      } : {}
    });
    this.resourceDiagnostics.push(...mcp.diagnostics);
    this.runtime.setRebindSession(async () => this.bindSession());
    this.startupDiagnostics = this.runtime.diagnostics.map((d) => `${d.type}: ${d.message}`);
    if (this.runtime.modelFallbackMessage !== void 0)
      this.startupDiagnostics.push(this.runtime.modelFallbackMessage);
    await this.bindSession();
    this.installDirectories(scopeEnabled);
  }
  /**
   * Apply the lifecycle plan. The boundary stays off unless the client sent
   * `additionalDirectories` or `_meta.pi.restoreAdditionalDirectories`.
   */
  installDirectories(scopeEnabled) {
    const plan = this.directoryPlan;
    if (plan.warning !== void 0) {
      logWarn(plan.warning);
      this.resourceDiagnostics.push(`warning: ${plan.warning}`);
    }
    if (scopeEnabled) {
      const loaded = this.session.resourceLoader.getExtensions().extensions.map((extension) => extension.path);
      this.scopeReady = scopeExtensionLoaded(loaded);
    }
    if (!scopeEnabled || plan.kind === "ignored" || plan.kind === "off") {
      this.scope.enforced = false;
      this.scope.setAdditional([]);
      if (scopeEnabled && plan.kind === "off") this.deactivateSavedDirectories();
      return;
    }
    if (!this.scopeReady) {
      throw internalError("workspace scope failed to load; refusing to enforce a path boundary");
    }
    let directories = plan.directories;
    if (plan.kind === "restore") {
      const saved = savedAdditionalDirectories(this.session.sessionManager.getBranch());
      try {
        directories = validateAdditionalDirectories(saved, this.cwd);
      } catch (error) {
        if (error instanceof AdditionalDirectoriesError) throw invalidParams(error.message);
        throw error;
      }
    }
    this.scope.enforced = true;
    this.scope.setAdditional(directories);
    this.persistDirectoryRecord(directories, true);
  }
  /** Keep the saved list for a later restore, but stop reporting or enforcing it. */
  deactivateSavedDirectories() {
    const branch = this.session.sessionManager.getBranch();
    const record = persistedAdditionalDirectoriesRecord(branch);
    if (!record.enforced) return;
    this.persistDirectoryRecord(record.directories, false);
  }
  persistDirectoryRecord(directories, enforced) {
    const record = persistedAdditionalDirectoriesRecord(this.session.sessionManager.getBranch());
    if (record.enforced === enforced && sameDirectories(record.directories, directories)) return;
    this.session.sessionManager.appendCustomEntry(ADDITIONAL_DIRECTORIES_ENTRY, {
      directories: [...directories],
      enforced
    });
  }
  resolveProjectTrust(cwd, agentDir) {
    if (this.settings.trustProjects || this.trustedProjects.has(cwd)) return true;
    if (!hasTrustRequiringProjectResources(cwd)) return true;
    try {
      const store = new ProjectTrustStore(agentDir);
      const decision = store.get(cwd);
      if (decision !== null) return decision;
      const preference = SettingsManager.create(cwd, agentDir, {
        projectTrusted: false
      }).getDefaultProjectTrust();
      return preference === "always";
    } catch (error) {
      logDebug(`project trust lookup failed: ${errorMessage(error)}`);
      return false;
    }
  }
  /** Persist a trust decision for the session cwd and reload resources. */
  async trustProject(remember) {
    if (remember) {
      new ProjectTrustStore(this.runtime.services.agentDir).set(this.cwd, true);
    }
    this.trustedProjects.add(this.cwd);
    this.session.settingsManager.setProjectTrusted(true);
    await this.session.reload();
  }
  async bindSession() {
    this.unsubscribe?.();
    const session = this.runtime.session;
    const theme = session.resourceLoader.getThemes().themes[0] ?? stubTheme();
    await session.bindExtensions({
      uiContext: createAcpUiContext({
        conn: this.conn,
        sessionId: this._sessionId,
        emit: (update) => this.emit(update),
        formElicitation: () => this.features.formElicitation,
        theme
      }),
      mode: "rpc",
      commandContextActions: {
        waitForIdle: () => this.session.waitForIdle(),
        newSession: async (options) => {
          const result = await this.runtime.newSession(options);
          if (!result.cancelled) await this.bindSession();
          return { cancelled: result.cancelled };
        },
        fork: async (entryId, options) => {
          const result = await this.runtime.fork(entryId, options);
          if (!result.cancelled) await this.bindSession();
          return { cancelled: result.cancelled };
        },
        navigateTree: async (targetId, options) => {
          const result = await this.session.navigateTree(targetId, options);
          return { cancelled: result.cancelled };
        },
        switchSession: async (sessionPath, options) => {
          const result = await this.runtime.switchSession(sessionPath, options);
          if (!result.cancelled) await this.bindSession();
          return result;
        },
        reload: async () => {
          await this.session.reload();
          this.publishCommands();
        }
      },
      shutdownHandler: () => {
        logDebug("extension requested shutdown; ignored in ACP mode");
      },
      onError: (error) => {
        this.emit({
          sessionUpdate: "session_info_update",
          _meta: piMeta({
            event: "extension_error",
            extensionPath: error.extensionPath,
            hook: error.event,
            error: error.error
          })
        });
      }
    });
    this.projection.setContextWindow(session.model?.contextWindow);
    this.projection.setToolOwner(toolOwnerLookup(session));
    this.unsubscribe = session.subscribe((event) => this.onSessionEvent(event));
  }
  /** Loaded extensions with the tools/commands/custom types they own. */
  extensions() {
    return extensionInventory(this.session);
  }
  onSessionEvent(event) {
    if (event.type === "message_start" && event.message.role === "assistant") {
      const manager = this.session.sessionManager;
      this.projection.noteAssistantMessageId(
        nextAssistantMessageId(manager.getLeafId(), manager.getEntries())
      );
    }
    for (const update of this.projection.onEvent(event)) this.emit(update);
    if (event.type === "agent_settled") this.settle();
  }
  onExtensionEvent(channel, data) {
    const facts = describeExtensionEvent(channel, data);
    this.emit({
      sessionUpdate: "session_info_update",
      _meta: piMeta({ event: "extension_event", inferred: true, ...facts })
    });
  }
  /** Deliver an ACP-originated event to extensions (`_pi/emit_event`). */
  injectExtensionEvent(channel, data) {
    this.eventBus?.inject(channel, data);
  }
  // ------------------------------------------------------------------ //
  // Emission                                                            //
  // ------------------------------------------------------------------ //
  emit(update) {
    if (this.closed || this.deliveryError) return;
    this.lastEmit = this.lastEmit.then(() => {
      if (this.deliveryError) return;
      return this.conn.sessionUpdate({ sessionId: this._sessionId, update });
    }).catch((error) => {
      this.deliveryError ??= error instanceof Error ? error : new Error(String(error));
      logWarn(`session/update failed: ${errorMessage(error)}`);
    });
  }
  async flush() {
    await this.lastEmit;
    if (this.deliveryError) throw this.deliveryError;
  }
  text(text) {
    this.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  }
  // ------------------------------------------------------------------ //
  // Surfaces                                                            //
  // ------------------------------------------------------------------ //
  configOptions() {
    return buildConfigOptions(this.session, {
      booleanOptions: this.features.booleanConfigOptions
    });
  }
  availableCommands() {
    return availableCommandsFor(this.session, {
      enableSkillCommands: this.session.settingsManager.getEnableSkillCommands()
    });
  }
  publishCommands() {
    this.emit({ sessionUpdate: "available_commands_update", availableCommands: this.availableCommands() });
  }
  publishConfigOptions() {
    this.emit({ sessionUpdate: "config_option_update", configOptions: this.configOptions() });
  }
  replayHistory() {
    const manager = this.session.sessionManager;
    const replay = buildReplay(manager.buildContextEntries(), this.cwd, manager.getEntries());
    for (const update of replay.updates) this.emit(update);
    if (replay.usage !== void 0) {
      this.emit({
        sessionUpdate: "session_info_update",
        _meta: piMeta({ event: "prompt_usage", usage: replay.usage })
      });
    }
    const title = replay.title ?? this.session.sessionName;
    if (title !== void 0) {
      this.emit({ sessionUpdate: "session_info_update", title, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    }
  }
  async setModel(value) {
    const models = [...this.session.modelRuntime.getAvailableSnapshot()];
    const model = findModel(models, value);
    if (model === void 0) throw invalidParams(`unknown model: ${value}`);
    if (this.session.model !== void 0 && modelValue(this.session.model) === modelValue(model)) return;
    try {
      await this.session.setModel(model, { persist: true });
    } catch (error) {
      throw invalidParams(`cannot switch to ${value}: ${errorMessage(error)}`);
    }
    this.projection.setContextWindow(model.contextWindow);
  }
  setThinking(level) {
    const levels = this.session.getAvailableThinkingLevels();
    if (!levels.includes(level)) throw invalidParams(`unknown thinking level: ${level}`);
    this.session.setThinkingLevel(level, { persist: true });
  }
  // ------------------------------------------------------------------ //
  // Prompt lifecycle                                                    //
  // ------------------------------------------------------------------ //
  /**
   * Pi steer: deliver after the current assistant turn finishes its tool calls,
   * before the next model call. Used by `_session/steering` and by a concurrent
   * `session/prompt`. A follow-up that should wait until the turn ends is a
   * later `session/prompt` from the client (pi's Alt+Enter), not this path.
   */
  async steer(text, images) {
    await this.session.steer(text, images);
  }
  async prompt(text, images) {
    if (this.closed || this.closePromise) throw internalError("session is closing or closed");
    if (this.deliveryError) throw this.deliveryError;
    if (this.inflight?.settlement) {
      await this.inflight.settlement;
      return this.prompt(text, images);
    }
    if (this.inflight !== void 0) {
      await this.steer(text, images);
      return "end_turn";
    }
    this.cancelled = false;
    this.projection.beginPrompt();
    this.projection.setContextWindow(this.session.model?.contextWindow);
    return new Promise((resolve2, reject) => {
      const inflight = { resolve: resolve2, reject };
      this.inflight = inflight;
      let accepted = false;
      const run = this.session.prompt(text, {
        images: images !== void 0 && images.length > 0 ? images : void 0,
        source: "rpc",
        // Called only after pi accepts the prompt (`started`, `handled`, or `queued`).
        preflightResult: () => {
          accepted = true;
        }
      });
      run.then(
        () => {
          if (this.inflight === inflight && this.session.isIdle) this.settle();
        },
        (error) => {
          if (this.inflight !== inflight) return;
          this.inflight = void 0;
          const message = errorMessage(error);
          if (!accepted && looksLikeAuthError(error)) {
            inflight.reject(authRequired(message));
          } else if (!accepted) {
            inflight.reject(invalidParams(message));
          } else {
            inflight.reject(internalError(message));
          }
        }
      );
    });
  }
  settle() {
    const inflight = this.inflight;
    if (inflight === void 0 || inflight.settlement) return;
    const changes = this.projection.fileChanges();
    if (changes.length > 0) {
      this.emit({
        sessionUpdate: "session_info_update",
        _meta: piMeta({ event: "file_changes", files: changes })
      });
    }
    const error = this.cancelled ? void 0 : this.projection.promptError;
    const failureKind = error !== void 0 ? classifyFailure(error) : void 0;
    if (error !== void 0 && failureKind !== void 0) {
      this.emit({
        sessionUpdate: "session_info_update",
        _meta: piMeta({ event: "failure", kind: failureKind, message: error })
      });
    }
    const cancelled = this.cancelled;
    const stopReason = assistantStopReasonToAcp(this.projection.lastAssistant);
    inflight.settlement = this.flush().then(
      () => {
        if (cancelled) inflight.resolve("cancelled");
        else if (error !== void 0)
          inflight.reject(
            failureKind === "auth_required" ? authRequired(error, piMeta({ assistantError: true, failure: failureKind })) : internalError(error, piMeta({ assistantError: true, failure: failureKind }))
          );
        else inflight.resolve(stopReason);
      },
      (failure) => {
        inflight.reject(internalError(`session delivery failed: ${errorMessage(failure)}`));
      }
    ).finally(() => {
      if (this.inflight === inflight) this.inflight = void 0;
    });
  }
  async cancel() {
    this.cancelled = true;
    this.session.clearQueue();
    this.session.abortBash();
    if (this.session.isCompacting) this.session.abortCompaction();
    if (this.session.isRetrying) this.session.abortRetry();
    try {
      await this.session.abort();
    } catch (error) {
      logDebug(`abort failed: ${errorMessage(error)}`);
    }
    this.projection.clearOpenToolCalls();
    if (this.inflight !== void 0 && this.session.isIdle) this.settle();
  }
  close() {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }
  async closeOnce() {
    if (this.closed) return;
    this.cancelled = true;
    try {
      await this.session.abort();
    } catch {
    }
    if (this.inflight !== void 0) this.settle();
    await this.flush().catch((error) => logDebug(`close delivery failed: ${errorMessage(error)}`));
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = void 0;
    try {
      await this.runtime.dispose();
    } catch (error) {
      logDebug(`runtime dispose failed: ${errorMessage(error)}`);
    }
  }
};
function sameDirectories(left, right) {
  return left.length === right.length && left.every((dir, index) => dir === right[index]);
}

// src/acp/agent.ts
import {
  PROTOCOL_VERSION,
  RequestError as RequestError2
} from "@agentclientprotocol/sdk";
import { getAgentDir as getAgentDir2, ModelRuntime, SettingsManager as SettingsManager2 } from "@earendil-works/pi-coding-agent";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync5, unlinkSync, writeFileSync as writeFileSync2 } from "fs";
import { isAbsolute as isAbsolute3, join as join5 } from "path";

// src/acp/auth-interaction.ts
var AuthFlowCancelled = class extends Error {
  constructor(message = "authentication cancelled") {
    super(message);
    this.name = "AuthFlowCancelled";
  }
};
function acceptedContent2(response) {
  if (response.action !== "accept") return void 0;
  const content = response.content;
  return content !== null && typeof content === "object" ? content : {};
}
function deviceCodeMessage(event) {
  const expiry = event.expiresInSeconds !== void 0 ? ` (expires in ${Math.round(event.expiresInSeconds / 60)} min)` : "";
  return `Open ${event.verificationUri} and enter the code ${event.userCode}${expiry}.`;
}
function createAcpAuthInteraction(deps) {
  const { conn, requestId, provider, signal } = deps;
  const openedUrlElicitations = [];
  let urlSeq = 0;
  let pendingUrl;
  const rejectWhenAborted = (promise, promptSignal) => new Promise((resolve2, reject) => {
    const onAbort = () => reject(new AuthFlowCancelled());
    if (signal.aborted || promptSignal?.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promptSignal?.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve2, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
      promptSignal?.removeEventListener("abort", onAbort);
    });
  });
  const form = (message, properties, required, meta, promptSignal) => {
    const request = {
      mode: "form",
      requestId,
      message,
      requestedSchema: { type: "object", properties, required },
      _meta: piMeta({ auth: { provider, ...meta } })
    };
    return rejectWhenAborted(conn.createElicitation(request), promptSignal);
  };
  const openUrl = (url, message, meta) => {
    urlSeq += 1;
    const elicitationId = `pi-auth-${provider}-${urlSeq}`;
    openedUrlElicitations.push(elicitationId);
    const request = {
      mode: "url",
      requestId,
      elicitationId,
      url,
      message,
      _meta: piMeta({ auth: { provider, ...meta } })
    };
    void conn.createElicitation(request).then((response) => {
      if (response.action === "decline" || response.action === "cancel") {
        logDebug(`auth url elicitation ${elicitationId}: ${response.action}`);
      }
    }).catch((error) => {
      logWarn(`auth url elicitation failed: ${errorMessage(error)}`);
    });
  };
  const notify = (event) => {
    switch (event.type) {
      case "auth_url": {
        const message = event.instructions ?? "Complete the login in your browser.";
        if (deps.urlElicitation) {
          openUrl(event.url, message, { event: "auth_url" });
        } else {
          pendingUrl = { url: event.url, instructions: event.instructions };
          if (deps.formElicitation) {
            setTimeout(() => {
              if (pendingUrl?.url !== event.url) return;
              pendingUrl = void 0;
              void form(`${message}

${event.url}`, {}, [], { event: "auth_url", url: event.url }).catch(
                () => void 0
              );
            }, 50);
          } else {
            logWarn(`login[${provider}]: open ${event.url} to continue`);
          }
        }
        return;
      }
      case "device_code": {
        const message = deviceCodeMessage(event);
        if (deps.urlElicitation) {
          openUrl(event.verificationUri, message, {
            event: "device_code",
            userCode: event.userCode,
            ...event.intervalSeconds !== void 0 ? { intervalSeconds: event.intervalSeconds } : {}
          });
        } else if (deps.formElicitation) {
          void form(message, {}, [], {
            event: "device_code",
            url: event.verificationUri,
            userCode: event.userCode
          }).catch(() => void 0);
        } else {
          logWarn(`login[${provider}]: ${message}`);
        }
        return;
      }
      case "info":
      case "progress":
        logDebug(`login[${provider}] ${event.type}: ${event.message}`);
        return;
      default:
        return;
    }
  };
  const prompt = async (request) => {
    switch (request.type) {
      case "select": {
        if (!deps.formElicitation) {
          const first = request.options[0];
          if (first === void 0) throw new Error("login offered no options");
          logDebug(`login[${provider}]: no form elicitation; choosing "${first.label}"`);
          return first.id;
        }
        const response = await form(
          request.message,
          {
            choice: {
              type: "string",
              title: request.message,
              oneOf: request.options.map((option) => ({
                const: option.id,
                title: option.description !== void 0 ? `${option.label} \u2014 ${option.description}` : option.label
              }))
            }
          },
          ["choice"],
          { event: "select", options: request.options.map((option) => option.id) },
          request.signal
        );
        const value = acceptedContent2(response)?.["choice"];
        if (typeof value !== "string") throw new AuthFlowCancelled();
        return value;
      }
      case "manual_code": {
        if (!deps.formElicitation) {
          return rejectWhenAborted(new Promise(() => {
          }), request.signal);
        }
        const url = pendingUrl;
        pendingUrl = void 0;
        const message = url !== void 0 ? `${url.instructions ?? request.message}

${url.url}` : request.message;
        const response = await form(
          message,
          {
            code: {
              type: "string",
              title: request.message,
              ...request.placeholder !== void 0 ? { description: request.placeholder } : {}
            }
          },
          deps.urlElicitation ? [] : ["code"],
          { event: "manual_code", ...url !== void 0 ? { url: url.url } : {} },
          request.signal
        );
        const value = acceptedContent2(response)?.["code"];
        if (typeof value !== "string" || value.length === 0) throw new AuthFlowCancelled();
        return value;
      }
      case "text":
      case "secret": {
        if (!deps.formElicitation)
          throw new Error(`login needs user input (${request.message}); the client cannot show forms`);
        const response = await form(
          request.message,
          {
            value: {
              type: "string",
              title: request.message,
              ...request.placeholder !== void 0 ? { description: request.placeholder } : {}
            }
          },
          ["value"],
          { event: request.type, secret: request.type === "secret" },
          request.signal
        );
        const value = acceptedContent2(response)?.["value"];
        if (typeof value !== "string") throw new AuthFlowCancelled();
        return value;
      }
      default:
        throw new Error("unsupported login prompt");
    }
  };
  return {
    signal,
    notify,
    prompt,
    async finish() {
      const ids = openedUrlElicitations.splice(0);
      for (const elicitationId of ids) {
        try {
          await conn.completeElicitation({ elicitationId });
        } catch (error) {
          logDebug(`elicitation/complete failed: ${errorMessage(error)}`);
        }
      }
    }
  };
}

// src/acp/auth-loopback.ts
import { randomBytes } from "crypto";
import { createServer } from "http";
function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function page(body) {
  return [
    '<!doctype html><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>pi-acp login</title>",
    "<style>",
    "body{font-family:system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem;color:#1c1917}",
    "input{width:100%;box-sizing:border-box;padding:.5rem;font-size:1rem}",
    "button{margin-top:1rem;padding:.5rem 1rem;font-size:1rem}",
    ".note{color:#57534e;font-size:.875rem}",
    "</style>",
    body
  ].join("\n");
}
async function serveKeyPage(provider, token) {
  let resolveKey;
  let rejectKey;
  const submission = new Promise((resolve2, reject) => {
    resolveKey = resolve2;
    rejectKey = reject;
  });
  const form = page(
    `<h1>Enter your ${escapeHtml(provider)} API key</h1><form method="post"><input type="password" name="apiKey" autocomplete="off" autofocus required placeholder="Paste your API key"><button type="submit">Store key</button></form><p class="note">This page is served by pi-acp over loopback only; the key is stored in pi's local credential store and never sent elsewhere.</p>`
  );
  const done = page("<h1>Key received</h1><p>You can close this tab and return to your client.</p>");
  const missing = page("<h1>No key entered</h1><p>Go back and paste your API key.</p>");
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== `/${token}`) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(form);
      return;
    }
    if (req.method === "POST") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const key = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("apiKey")?.trim() ?? "";
        if (key.length === 0) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(missing);
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(done);
        resolveKey(key);
      });
      return;
    }
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("method not allowed");
  });
  await new Promise((resolve2, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve2);
  });
  const port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}/${token}`, submission, reject: rejectKey };
}
async function captureApiKeyViaUrl(options) {
  const { conn, requestId, provider, signal } = options;
  const token = randomBytes(16).toString("hex");
  const { server, url, submission, reject } = await serveKeyPage(provider, token);
  const onAbort = () => reject(new AuthFlowCancelled("aborted"));
  signal?.addEventListener("abort", onAbort);
  const elicitationId = `pi-auth-${token.slice(0, 12)}`;
  try {
    const responsePromise = conn.createElicitation({
      mode: "url",
      requestId,
      elicitationId,
      url,
      message: `Enter your ${provider} API key in the page that just opened (served by pi-acp on this machine).`,
      _meta: piMeta({ auth: { provider, event: "api_key" } })
    });
    void responsePromise.then(
      (response) => {
        if (response.action !== "accept") reject(new AuthFlowCancelled(response.action));
      },
      (error) => reject(error instanceof Error ? error : new Error(errorMessage(error)))
    );
    const key = await submission;
    try {
      await conn.completeElicitation({ elicitationId });
    } catch (error) {
      logDebug(`completeElicitation(${elicitationId}) failed: ${errorMessage(error)}`);
    }
    return key;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    server.close();
  }
}

// src/acp/auth-status.ts
var AUTH_STATUS_UPDATE_METHOD = "_auth/status_update";
var AUTH_STATUS_META_KEY = "authStatus";
function kindFromSource(source, oauth) {
  if (oauth) return "oauth";
  switch (source) {
    case "stored":
    case "runtime":
      return "api_key";
    case "environment":
      return "environment";
    case "models_json_key":
    case "models_json_command":
      return "config";
    default:
      return "other";
  }
}
function computeAuthStatus(modelRuntime) {
  const providers = [];
  for (const provider of modelRuntime.getProviders()) {
    if (!modelRuntime.hasConfiguredAuth(provider.id)) continue;
    let status;
    try {
      status = modelRuntime.getProviderAuthStatus(provider.id);
    } catch (error) {
      logDebug(`auth status for ${provider.id} failed: ${errorMessage(error)}`);
    }
    const oauth = modelRuntime.isUsingOAuth(provider.id);
    providers.push({
      providerId: provider.id,
      name: provider.name,
      kind: kindFromSource(status?.source, oauth),
      ...status?.label !== void 0 ? { label: status.label } : oauth ? { label: "OAuth" } : {},
      ...modelRuntime.isUsingSubscription(provider.id) ? { subscription: true } : {}
    });
  }
  providers.sort((a, b) => a.providerId.localeCompare(b.providerId));
  if (providers.length === 0) return { kind: "none", label: "Not logged in", providers };
  const label = providers.length === 1 ? `${providers[0].name}${providers[0].label !== void 0 ? ` \xB7 ${providers[0].label}` : ""}` : `${providers.length} providers`;
  return { kind: "authenticated", label, providers };
}
function sameAuthStatus(a, b) {
  return a !== void 0 && JSON.stringify(a) === JSON.stringify(b);
}

// src/acp/builtin-commands.ts
import { existsSync, readFileSync as readFileSync3 } from "fs";
import { join as join4 } from "path";
import { getPackageDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
function onOff(value) {
  const lowered = value.toLowerCase();
  if (["on", "true", "enable", "enabled", "1"].includes(lowered)) return true;
  if (["off", "false", "disable", "disabled", "0"].includes(lowered)) return false;
  return void 0;
}
async function runBuiltinCommand(session, name, args) {
  const pi = session.session;
  switch (name) {
    case "status": {
      const model = pi.model;
      const usage = pi.getContextUsage();
      const stats = pi.getSessionStats();
      const rows = [
        ["Adapter", `openma-pi-acp ${VERSION} (pi ${PI_VERSION})`],
        ["Model", model !== void 0 ? `${modelValue(model)} (${model.name})` : "(none)"],
        ["Thinking", pi.thinkingLevel],
        ["Auto-compaction", pi.autoCompactionEnabled ? "on" : "off"],
        ["Workspace", session.cwd],
        [
          "Workspace scope",
          session.additionalDirectoriesEnforced ? session.additionalDirectories.length > 0 ? session.additionalDirectories.join(", ") : "cwd only" : "unbounded"
        ],
        ["Session", `${pi.sessionId}${pi.sessionFile !== void 0 ? ` \u2014 ${pi.sessionFile}` : ""}`],
        [
          "Messages",
          `${stats.userMessages} user / ${stats.assistantMessages} assistant / ${stats.toolCalls} tool calls`
        ],
        ["Tokens", `${stats.tokens.total.toLocaleString()} total (cost $${stats.cost.toFixed(4)})`],
        ...usage !== void 0 && usage.tokens !== null ? [
          [
            "Context",
            `${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} (${usage.percent ?? 0}%)`
          ]
        ] : [],
        ["Tools", pi.getActiveToolNames().join(", ")]
      ];
      const diagnostics = session.diagnostics;
      return {
        text: [
          "| | |",
          "|---|---|",
          ...rows.map(([key, value]) => `| ${key} | ${value} |`),
          ...diagnostics.length > 0 ? ["", "Diagnostics:", ...diagnostics.map((d) => `- ${d}`)] : []
        ].join("\n")
      };
    }
    case "model": {
      const models = pi.modelRuntime.getAvailableSnapshot();
      const current = pi.model !== void 0 ? modelValue(pi.model) : void 0;
      if (args.length === 0) {
        const lines = models.map(
          (m) => `${modelValue(m) === current ? "\u2192" : " "} ${modelValue(m)} \u2014 ${m.name}`
        );
        return {
          text: [
            `model: ${current ?? "(none)"}`,
            "",
            ...lines.length > 0 ? lines : ["no models available \u2014 authenticate first"],
            "",
            "switch with /model <provider/id>"
          ].join("\n")
        };
      }
      try {
        await session.setModel(args);
      } catch (error) {
        return { text: `\u26A0 ${errorMessage(error)}` };
      }
      return {
        text: `model \u2192 ${pi.model !== void 0 ? modelValue(pi.model) : args}`,
        refresh: { config: true }
      };
    }
    case "thinking": {
      const levels = pi.getAvailableThinkingLevels();
      if (args.length === 0)
        return { text: `thinking: ${pi.thinkingLevel} (available: ${levels.join(", ")})` };
      try {
        session.setThinking(args.toLowerCase());
      } catch (error) {
        return { text: `\u26A0 ${errorMessage(error)}` };
      }
      return { text: `thinking \u2192 ${pi.thinkingLevel}`, refresh: { config: true } };
    }
    case "compact": {
      try {
        const result = await pi.compact(args.length > 0 ? args : void 0);
        return {
          text: `Compaction completed (${result.tokensBefore.toLocaleString()} tokens before).

${result.summary}`
        };
      } catch (error) {
        return { text: `\u26A0 compaction failed: ${errorMessage(error)}` };
      }
    }
    case "autocompact": {
      const requested = args.length === 0 || args.toLowerCase() === "toggle" ? !pi.autoCompactionEnabled : onOff(args);
      if (requested === void 0) return { text: "usage: /autocompact on|off|toggle" };
      pi.setAutoCompactionEnabled(requested);
      return { text: `auto-compaction ${requested ? "enabled" : "disabled"}`, refresh: { config: true } };
    }
    case "name":
    case "rename": {
      if (args.length === 0)
        return { text: `session name: ${pi.sessionName ?? "(unset)"}
usage: /${name} <name>` };
      pi.setSessionName(args);
      return { text: `session name \u2192 ${args}`, refresh: { title: args } };
    }
    case "skills": {
      const skills = pi.resourceLoader.getSkills().skills;
      if (skills.length === 0) return { text: "No skills are available." };
      const enabled = pi.settingsManager.getEnableSkillCommands();
      return {
        text: [
          ...skills.map((skill) => `- **${skill.name}** \u2014 ${skill.description}`),
          "",
          enabled ? "invoke with /skill:<name> <instructions>" : "skill commands are disabled in pi settings"
        ].join("\n")
      };
    }
    case "session": {
      const stats = pi.getSessionStats();
      const t = stats.tokens;
      return {
        text: [
          `Session: ${stats.sessionId}`,
          ...stats.sessionFile !== void 0 ? [`File: ${stats.sessionFile}`] : [],
          `Messages: ${stats.totalMessages} (${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolCalls} tool calls)`,
          `Tokens: in ${t.input.toLocaleString()}, out ${t.output.toLocaleString()}, cache read ${t.cacheRead.toLocaleString()}, cache write ${t.cacheWrite.toLocaleString()}, total ${t.total.toLocaleString()}`,
          `Cost: $${stats.cost.toFixed(4)}`
        ].join("\n")
      };
    }
    case "export": {
      if (pi.messages.length === 0) return { text: "Nothing to export yet \u2014 send a prompt first." };
      try {
        const path = await pi.exportToHtml(args.length > 0 ? args : void 0);
        return { text: `Session exported: ${path}` };
      } catch (error) {
        return { text: `\u26A0 export failed: ${errorMessage(error)}` };
      }
    }
    case "tools": {
      const all = pi.getAllTools().map((tool) => tool.name);
      const active = new Set(pi.getActiveToolNames());
      if (args.length === 0) {
        return {
          text: [
            "tools:",
            ...all.map((name2) => `${active.has(name2) ? "[x]" : "[ ]"} ${name2}`),
            "",
            "set with /tools <name\u2026>"
          ].join("\n")
        };
      }
      const requested = args.split(/[\s,]+/).filter((name2) => name2.length > 0);
      const unknown = requested.filter((name2) => !all.includes(name2));
      if (unknown.length > 0) return { text: `\u26A0 unknown tools: ${unknown.join(", ")}` };
      pi.setActiveToolsByName(requested);
      return { text: `active tools \u2192 ${pi.getActiveToolNames().join(", ")}` };
    }
    case "steering":
    case "follow-up": {
      const isSteering = name === "steering";
      const current = isSteering ? pi.steeringMode : pi.followUpMode;
      if (args.length === 0) return { text: `${name} mode: ${current}` };
      const mode = args.toLowerCase();
      if (mode !== "all" && mode !== "one-at-a-time") return { text: `usage: /${name} all | one-at-a-time` };
      if (isSteering) pi.setSteeringMode(mode);
      else pi.setFollowUpMode(mode);
      return { text: `${name} mode \u2192 ${mode}` };
    }
    case "queue": {
      if (args.toLowerCase() === "clear") {
        const cleared = pi.clearQueue();
        return { text: `cleared ${cleared.steering.length + cleared.followUp.length} queued message(s)` };
      }
      const steering = pi.getSteeringMessages();
      const followUp = pi.getFollowUpMessages();
      return {
        text: [
          `queued: ${steering.length} steering, ${followUp.length} follow-up`,
          ...steering.map((m) => `- [steer] ${m.split("\n", 1)[0]}`),
          ...followUp.map((m) => `- [follow-up] ${m.split("\n", 1)[0]}`)
        ].join("\n")
      };
    }
    case "bash": {
      if (args.length === 0) return { text: "usage: /bash <command>" };
      const denial = session.shellDenial(args);
      if (denial !== void 0) return { text: denial };
      const toolCallId = `user-bash-${Date.now().toString(36)}`;
      session.emit({
        sessionUpdate: "tool_call",
        toolCallId,
        title: args.split("\n", 1)[0] ?? "bash",
        name: "bash",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: args }
      });
      let output = "";
      try {
        const result = await pi.executeBash(args, (chunk) => {
          output += chunk;
          session.emit({
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "in_progress",
            content: [
              {
                type: "content",
                content: { type: "text", text: `\`\`\`sh
${output.replace(/\n+$/, "")}
\`\`\`
` }
              }
            ]
          });
        });
        const failed = result.cancelled || result.exitCode !== void 0 && result.exitCode !== 0;
        session.emit({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: failed ? "failed" : "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: `\`\`\`sh
${result.output.replace(/\n+$/, "")}
\`\`\`
` }
            }
          ],
          rawOutput: { output: result.output, exitCode: result.exitCode, cancelled: result.cancelled }
        });
        return { text: `exit ${result.exitCode ?? "?"}${result.cancelled ? " (cancelled)" : ""}` };
      } catch (error) {
        session.emit({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          rawOutput: { error: errorMessage(error) }
        });
        return { text: `\u26A0 ${errorMessage(error)}` };
      }
    }
    case "reload": {
      try {
        await pi.reload();
      } catch (error) {
        return { text: `\u26A0 reload failed: ${errorMessage(error)}` };
      }
      return {
        text: "reloaded extensions, skills, prompts, and context files",
        refresh: { commands: true, config: true }
      };
    }
    case "changelog": {
      const path = join4(getPackageDir(), "CHANGELOG.md");
      if (!existsSync(path)) return { text: `pi changelog not found (${path})` };
      let text = readFileSync3(path, "utf8");
      if (text.length > 2e4) text = `${text.slice(0, 2e4)}

\u2026(truncated)`;
      return { text };
    }
    default:
      return void 0;
  }
}

// src/acp/fork-capability.ts
var ACP_INCLUSIVE_FORK_VERSION = 1;
var ACP_INCLUSIVE_FORK_CAPABILITY = Object.freeze({
  version: ACP_INCLUSIVE_FORK_VERSION,
  inclusive: true
});
function acpInclusiveForkCapabilityMeta() {
  return { jetbrains: { air: { fork: ACP_INCLUSIVE_FORK_CAPABILITY } } };
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeCapabilityMeta(base, extra) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? mergeCapabilityMeta(current, value) : value;
  }
  return merged;
}

// src/acp/fork-point.ts
import { createHash } from "crypto";
import { SessionManager as SessionManager2 } from "@earendil-works/pi-coding-agent";
var FORK_UNSUPPORTED_VERSION = "Unsupported jetbrains.air.fork version";
var FORK_MESSAGE_ID = "jetbrains.air.fork messageId must be a non-empty string";
var FORK_FINGERPRINT = "jetbrains.air.fork messageFingerprint must match sha256:<64 lowercase hex>";
var FORK_OCCURRENCE = "jetbrains.air.fork messageOccurrence must be a positive safe integer";
var FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
var SEGMENT_SUFFIX = /:segment:\d+$/;
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function child(value, key) {
  if (!isRecord2(value) || !(key in value)) return void 0;
  return value[key];
}
function sha256Fingerprint(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
function assistantMessageText(message) {
  if (!Array.isArray(message.content)) return "";
  let text = "";
  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string") text += block.text;
  }
  return text;
}
function messageIdCandidates(messageId) {
  const candidates = [messageId];
  const stripped = messageId.replace(SEGMENT_SUFFIX, "");
  if (stripped !== messageId && stripped.trim().length > 0) candidates.push(stripped);
  return candidates;
}
function parseJetbrainsAirFork(meta) {
  const jetbrains = child(meta, "jetbrains");
  if (jetbrains === void 0) return { status: "absent" };
  const air = child(jetbrains, "air");
  if (air === void 0) return { status: "absent" };
  if (!isRecord2(air) || !("fork" in air)) return { status: "absent" };
  const fork = air["fork"];
  if (!isRecord2(fork) || fork["version"] !== 1)
    return { status: "invalid", message: FORK_UNSUPPORTED_VERSION };
  const rawId = fork["messageId"];
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    return { status: "invalid", message: FORK_MESSAGE_ID };
  }
  let messageFingerprint;
  if ("messageFingerprint" in fork && fork["messageFingerprint"] !== void 0) {
    const fingerprint = fork["messageFingerprint"];
    if (typeof fingerprint !== "string" || !FINGERPRINT_PATTERN.test(fingerprint)) {
      return { status: "invalid", message: FORK_FINGERPRINT };
    }
    messageFingerprint = fingerprint;
  }
  let messageOccurrence = 1;
  if ("messageOccurrence" in fork && fork["messageOccurrence"] !== void 0) {
    const occurrence = fork["messageOccurrence"];
    if (typeof occurrence !== "number" || !Number.isSafeInteger(occurrence) || occurrence < 1) {
      return { status: "invalid", message: FORK_OCCURRENCE };
    }
    messageOccurrence = occurrence;
  }
  return {
    status: "present",
    request: {
      messageId: rawId.trim(),
      messageOccurrence,
      ...messageFingerprint !== void 0 ? { messageFingerprint } : {}
    }
  };
}
function forkPointNotFoundMessage(messageId, sessionId) {
  return `Fork point message ${messageId} was not found in session ${sessionId}`;
}
function isForkableAssistant(entry) {
  if (entry.type !== "message") return false;
  const message = entry.message;
  return message.role === "assistant" && typeof message.stopReason === "string" && message.stopReason.length > 0;
}
function fingerprintOf(entry) {
  return sha256Fingerprint(assistantMessageText(entry.message));
}
function pickByFingerprint(entries, fingerprint, occurrence) {
  const matches = entries.filter((entry) => fingerprintOf(entry) === fingerprint);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return void 0;
  return matches[occurrence - 1];
}
function timeOrdered(entries) {
  return entries.map((entry, index) => ({ entry, index })).filter((item) => isForkableAssistant(item.entry)).sort((left, right) => {
    const byTime = left.entry.timestamp.localeCompare(right.entry.timestamp);
    return byTime !== 0 ? byTime : left.index - right.index;
  }).map((item) => item.entry);
}
function matchMessageId(entries, request, idScope) {
  for (const candidate of messageIdCandidates(request.messageId)) {
    const byEntryId = entries.find((entry) => entry.id === candidate);
    const found = byEntryId ?? entries.find((entry) => assistantAcpMessageId(entry, idScope) === candidate);
    if (found === void 0) continue;
    if (request.messageFingerprint !== void 0 && fingerprintOf(found) !== request.messageFingerprint)
      continue;
    return found;
  }
  return void 0;
}
function locateForkAssistant(visible, allEntries, request) {
  const visibleAssistants = visible.filter(isForkableAssistant);
  const visibleId = matchMessageId(visibleAssistants, request, allEntries);
  if (visibleId !== void 0) return visibleId;
  const tree = timeOrdered(allEntries);
  const treeId = matchMessageId(tree, request, allEntries);
  if (treeId !== void 0) return treeId;
  if (request.messageFingerprint === void 0) return void 0;
  const visibleHit = pickByFingerprint(
    visibleAssistants,
    request.messageFingerprint,
    request.messageOccurrence
  );
  if (visibleHit !== void 0) return visibleHit;
  if (visibleAssistants.some((entry) => fingerprintOf(entry) === request.messageFingerprint))
    return void 0;
  return pickByFingerprint(tree, request.messageFingerprint, request.messageOccurrence);
}
function stripTrailingToolCalls(entry) {
  const message = entry.message;
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  if (!message.content.some((block) => block.type === "toolCall")) return;
  const kept = message.content.filter((block) => block.type !== "toolCall");
  message.content = kept.length > 0 ? kept : [{ type: "text", text: "" }];
}
function forkInclusiveSession(sourceFile, cwd, sessionDir, request) {
  const opened = SessionManager2.open(sourceFile, sessionDir, cwd);
  const target = locateForkAssistant(opened.buildContextEntries(), opened.getEntries(), request);
  if (target === void 0) return void 0;
  return cutOpenedSession(opened, target.id);
}
function cutOpenedSession(opened, entryId) {
  const entry = opened.getEntry(entryId);
  if (entry === void 0 || !isForkableAssistant(entry)) {
    throw new Error(`fork entry ${entryId} is not a completed assistant message`);
  }
  stripTrailingToolCalls(entry);
  const branched = opened.createBranchedSession(entryId);
  if (branched === void 0) throw new Error("inclusive fork did not produce a session file");
  return branched;
}

// src/acp/sessions-index.ts
import { SessionManager as SessionManager3 } from "@earendil-works/pi-coding-agent";
import { readFileSync as readFileSync4 } from "fs";
function toEntry(info) {
  const title = info.name?.trim() || info.firstMessage?.trim().split("\n", 1)[0]?.slice(0, 80) || void 0;
  return {
    sessionId: info.id,
    cwd: info.cwd,
    path: info.path,
    title: title !== void 0 && title.length > 0 ? title : void 0,
    updatedAt: info.modified.toISOString(),
    additionalDirectories: readPersistedDirectories(info.path)
  };
}
function readPersistedDirectories(sessionFile) {
  let text;
  try {
    text = readFileSync4(sessionFile, "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.type !== "string") continue;
      entries.push({
        type: parsed.type,
        ...typeof parsed.id === "string" ? { id: parsed.id } : {},
        ...typeof parsed.parentId === "string" || parsed.parentId === null ? { parentId: parsed.parentId } : {},
        ...typeof parsed.customType === "string" ? { customType: parsed.customType } : {},
        ...parsed.data !== void 0 ? { data: parsed.data } : {}
      });
    } catch {
    }
  }
  return persistedAdditionalDirectories(entries);
}
async function listSessions(options) {
  const infos = options.cwd !== void 0 ? await SessionManager3.list(options.cwd, options.sessionDir) : await SessionManager3.listAll(options.sessionDir);
  return infos.map(toEntry).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
async function findSession(sessionId, sessionDir) {
  const all = await SessionManager3.listAll(sessionDir);
  const found = all.find((info) => info.id === sessionId);
  if (found === void 0) logDebug(`session ${sessionId} not found in pi's session store`);
  return found === void 0 ? void 0 : toEntry(found);
}
function toAcpSessionInfo(entry) {
  return {
    sessionId: entry.sessionId,
    cwd: entry.cwd,
    additionalDirectories: entry.additionalDirectories,
    ...entry.title !== void 0 ? { title: entry.title } : {},
    updatedAt: entry.updatedAt
  };
}

// src/acp/startup-info.ts
import { VERSION as PI_VERSION2 } from "@earendil-works/pi-coding-agent";
function buildStartupInfo(session, diagnostics) {
  const loader = session.resourceLoader;
  const lines = [`**pi v${PI_VERSION2}** via openma-pi-acp v${VERSION}`, ""];
  const section = (title, items) => {
    if (items.length === 0) return;
    lines.push(`**${title}**`);
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };
  section(
    "Context",
    loader.getAgentsFiles().agentsFiles.map((file) => file.path)
  );
  section(
    "Skills",
    loader.getSkills().skills.map((skill) => `${skill.name} (${skill.sourceInfo.source})`)
  );
  section(
    "Prompts",
    session.promptTemplates.map((template) => `/${template.name} (${template.sourceInfo.source})`)
  );
  section(
    "Extensions",
    loader.getExtensions().extensions.filter((extension) => extension.hidden !== true).map(
      (extension) => extension.sourceInfo.source === "sdk" ? extension.path : `${extension.path} (${extension.sourceInfo.source})`
    )
  );
  const model = session.model;
  section(
    "Model",
    model !== void 0 ? [`${model.provider}/${model.id} \xB7 thinking ${session.thinkingLevel}`] : ["(none selected)"]
  );
  section("Diagnostics", [...diagnostics]);
  return lines.join("\n").trimEnd() + "\n";
}

// src/acp/agent.ts
var LIST_PAGE_SIZE = 100;
var AUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1e3;
var LEGACY_SET_MODEL_METHOD = "session/set_model";
var ADD_DIRECTORY_METHOD = "_pi/add_directory";
var PiAcpAgent = class {
  conn;
  settings;
  sessions = /* @__PURE__ */ new Map();
  opening = /* @__PURE__ */ new Map();
  openGenerations = /* @__PURE__ */ new Map();
  nextOpenId = 0;
  pendingOpens = /* @__PURE__ */ new Set();
  modelRuntimePromise;
  requestIds;
  features = {
    terminalOutput: "none",
    formElicitation: false,
    urlElicitation: false,
    booleanConfigOptions: false,
    delegation: { readTextFile: false, writeTextFile: false, terminal: false }
  };
  terminalAuthMeta = false;
  terminalAuth = false;
  gatewayAuth = false;
  /** Providers whose API key lives only in this process (persistence failed). */
  runtimeKeys = /* @__PURE__ */ new Set();
  lastAuthStatus;
  closed = false;
  constructor(conn, options) {
    this.conn = conn;
    this.settings = options.settings;
    this.requestIds = options.requestIds;
    if (options.modelRuntime !== void 0) this.modelRuntimePromise = Promise.resolve(options.modelRuntime);
  }
  authMethodOptions() {
    return {
      terminal: this.terminalAuth,
      gateway: this.gatewayAuth,
      terminalAuthMeta: this.terminalAuthMeta,
      urlElicitation: this.features.urlElicitation,
      formElicitation: this.features.formElicitation
    };
  }
  /** -32000 auth_required whose data always carries the current authMethods. */
  authError(modelRuntime, message) {
    return authRequired(message, {
      authMethods: buildAuthMethods(modelRuntime, this.authMethodOptions())
    });
  }
  /** Push `_auth/status_update` when pi's credential picture changed since the last push. */
  async publishAuthStatus() {
    if (this.closed) return;
    let modelRuntime;
    try {
      modelRuntime = await this.modelRuntime();
    } catch {
      return;
    }
    const status = computeAuthStatus(modelRuntime);
    if (sameAuthStatus(this.lastAuthStatus, status)) return;
    this.lastAuthStatus = status;
    try {
      await this.conn.extNotification(AUTH_STATUS_UPDATE_METHOD, { authStatus: status });
    } catch (error) {
      logDebug(`${AUTH_STATUS_UPDATE_METHOD} failed: ${errorMessage(error)}`);
    }
  }
  get agentDir() {
    return this.settings.agentDir ?? getAgentDir2();
  }
  get sessionDir() {
    if (this.settings.sessionDir !== void 0) return this.settings.sessionDir;
    try {
      return SettingsManager2.create(process.cwd(), this.agentDir).getSessionDir();
    } catch {
      return void 0;
    }
  }
  modelRuntime() {
    if (!this.modelRuntimePromise) {
      const pending = ModelRuntime.create({
        authPath: `${this.agentDir}/auth.json`,
        modelsPath: `${this.agentDir}/models.json`,
        signal: AbortSignal.timeout(15e3)
      });
      this.modelRuntimePromise = pending;
      void pending.catch(() => {
        if (this.modelRuntimePromise === pending) this.modelRuntimePromise = void 0;
      });
    }
    return this.modelRuntimePromise;
  }
  // ------------------------------------------------------------------ //
  // Lifecycle                                                           //
  // ------------------------------------------------------------------ //
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    const live = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled([...live.map((session) => session.close()), ...this.pendingOpens]);
  }
  assertOpen() {
    if (this.closed) throw internalError("the ACP agent has been disposed");
  }
  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session === void 0) throw invalidParams(`unknown session: ${sessionId}`);
    return session;
  }
  /** Live session, else silently restored from pi's store (clients keep threads across restarts). */
  async requireOrRestore(sessionId) {
    const live = this.sessions.get(sessionId);
    if (live !== void 0) return live;
    const inflight = this.opening.get(sessionId);
    if (inflight !== void 0) return inflight;
    const stored = await findSession(sessionId, this.sessionDir);
    if (stored === void 0) throw invalidParams(`unknown session: ${sessionId}`);
    logWarn(`restoring session ${sessionId} from ${stored.path}`);
    return this.openSession({
      cwd: stored.cwd,
      sessionFile: stored.path,
      reason: "resume",
      mcpServers: void 0,
      directoryPlan: directoryPlanOf(void 0, stored.cwd, void 0),
      sessionId
    });
  }
  async openSession(params) {
    const key = params.sessionId ?? `pending:${++this.nextOpenId}`;
    const generation = (this.openGenerations.get(key) ?? 0) + 1;
    this.openGenerations.set(key, generation);
    const isCurrent = () => !this.closed && this.openGenerations.get(key) === generation;
    const promise = (async () => {
      const modelRuntime = await this.modelRuntime();
      if (!isCurrent()) throw internalError("session open was superseded or closed");
      const existing = params.sessionId !== void 0 ? this.sessions.get(params.sessionId) : void 0;
      if (existing !== void 0) {
        this.sessions.delete(params.sessionId);
        await existing.close();
      }
      const session = await PiAcpSession.open({
        conn: this.conn,
        cwd: params.cwd,
        settings: this.settings,
        modelRuntime,
        features: this.features,
        mcpServers: params.mcpServers,
        directoryPlan: params.directoryPlan,
        ...params.sessionFile !== void 0 ? { sessionFile: params.sessionFile } : {},
        ...params.fork !== void 0 ? { fork: params.fork } : {},
        reason: params.reason
      });
      if (!isCurrent()) {
        await session.close();
        throw internalError("session open was superseded or closed");
      }
      this.sessions.set(session.sessionId, session);
      return session;
    })();
    this.opening.set(key, promise);
    this.pendingOpens.add(promise);
    try {
      return await promise;
    } finally {
      this.pendingOpens.delete(promise);
      if (this.opening.get(key) === promise) this.opening.delete(key);
    }
  }
  async requireModel(session) {
    const pi = session.session;
    const modelRuntime = await this.modelRuntime();
    if (pi.model !== void 0 && modelRuntime.hasConfiguredAuth(pi.model.provider)) return;
    if (pi.model !== void 0 && await modelRuntime.checkAuth(pi.model.provider) !== void 0) return;
    const available = modelRuntime.getAvailableSnapshot();
    if (pi.model === void 0 && available.length > 0) {
      await pi.setModel(available[0]);
      return;
    }
    throw authRequired(
      pi.model === void 0 || available.length === 0 ? "no model is available: log in with pi (terminal auth) or provide an API key" : `no credentials for provider "${pi.model.provider}": log in with pi or provide an API key`,
      { authMethods: buildAuthMethods(modelRuntime, this.authMethodOptions()) }
    );
  }
  async publishSurfaces(session, options = {}) {
    await new Promise((resolve2) => setTimeout(resolve2, 0));
    session.publishCommands();
    if (options.startup === true && this.settings.quietStartup !== true) {
      const quiet = session.session.settingsManager.getQuietStartup();
      if (!quiet) session.text(buildStartupInfo(session.session, session.diagnostics));
    }
  }
  // ------------------------------------------------------------------ //
  // Protocol                                                            //
  // ------------------------------------------------------------------ //
  async initialize(params) {
    const caps = params.clientCapabilities;
    const meta = caps?._meta;
    const present = (value) => value !== void 0 && value !== null;
    this.features = {
      terminalOutput: meta?.["terminal_output"] === true ? "terminal_output" : meta?.["terminal_output_delta"] === true ? "terminal_output_delta" : "none",
      formElicitation: present(caps?.elicitation?.form),
      urlElicitation: present(caps?.elicitation?.url),
      booleanConfigOptions: present(caps?.session?.configOptions?.boolean),
      delegation: this.settings.delegation ? delegationFromClient(caps) : { readTextFile: false, writeTextFile: false, terminal: false }
    };
    this.terminalAuthMeta = meta?.["terminal-auth"] === true;
    this.terminalAuth = caps?.auth?.terminal === true;
    this.gatewayAuth = caps?.auth?._meta?.["gateway"] === true;
    let modelRuntime;
    try {
      modelRuntime = await this.modelRuntime();
    } catch (error) {
      logWarn(`model runtime unavailable at initialize: ${errorMessage(error)}`);
    }
    const requested = params.protocolVersion;
    const response = {
      protocolVersion: typeof requested === "number" && requested >= 1 && requested < PROTOCOL_VERSION ? requested : PROTOCOL_VERSION,
      agentInfo: { name: AGENT_NAME, title: AGENT_TITLE, version: VERSION },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        mcpCapabilities: { http: true, sse: false },
        sessionCapabilities: {
          list: {},
          delete: {},
          fork: {},
          resume: {},
          close: {},
          // Present only when the path boundary is real (see workspace-scope.ts).
          ...additionalDirectoriesCapability() !== void 0 ? { additionalDirectories: {} } : {}
        },
        auth: { logout: {} },
        _meta: mergeCapabilityMeta(
          {
            ...piMeta({ version: VERSION, delegation: this.features.delegation }),
            // Presence announces that this agent pushes `_auth/status_update`.
            [AUTH_STATUS_META_KEY]: {}
          },
          acpInclusiveForkCapabilityMeta()
        )
      },
      authMethods: buildAuthMethods(modelRuntime, this.authMethodOptions()),
      _meta: { steering: { supported: true } }
    };
    setTimeout(() => void this.publishAuthStatus(), 0);
    return response;
  }
  async authenticate(params) {
    try {
      return await this.runAuthenticate(params);
    } finally {
      void this.publishAuthStatus();
    }
  }
  /** What the client just authenticated — reported back so the UI can show the active account. */
  authResult(modelRuntime, provider, kind) {
    return {
      _meta: piMeta({ auth: { provider, kind }, authStatus: computeAuthStatus(modelRuntime) })
    };
  }
  async storeApiKey(modelRuntime, provider, apiKey) {
    try {
      await modelRuntime.login(provider, "api_key", {
        prompt: async () => apiKey,
        notify: (event) => logDebug(`login[${provider}] ${event.type}`)
      });
    } catch (error) {
      logWarn(
        `persisting API key for ${provider} failed (${errorMessage(error)}); using it for this process only`
      );
      await modelRuntime.setRuntimeApiKey(provider, apiKey);
      this.runtimeKeys.add(provider);
    }
  }
  async runAuthenticate(params) {
    const modelRuntime = await this.modelRuntime();
    if (params.methodId === TERMINAL_AUTH_METHOD_ID) {
      const launch = terminalLaunchSpec();
      throw invalidParams(
        `"${TERMINAL_AUTH_METHOD_ID}" is a terminal auth method \u2014 run \`${launch.command} ${launch.args.join(" ")}\` (or the client's terminal-auth launch spec); ACP clients must not send it to authenticate`
      );
    }
    if (params.methodId === GATEWAY_METHOD_ID) {
      return this.gatewayAuthenticate(modelRuntime, params);
    }
    const submitted = apiKeyFromAuthenticate(params._meta);
    const parsed = parseAuthMethodId(params.methodId);
    const provider = submitted.provider ?? parsed?.provider;
    if (provider === void 0) throw invalidParams(`unknown auth method: ${params.methodId}`);
    if (parsed?.type === "oauth" && submitted.apiKey === void 0) {
      await this.oauthLogin(modelRuntime, provider);
      return this.authResult(modelRuntime, provider, "oauth");
    }
    if (submitted.apiKey === void 0) {
      if (modelRuntime.hasConfiguredAuth(provider)) {
        const kind = modelRuntime.isUsingOAuth(provider) ? "oauth" : "api_key";
        return this.authResult(modelRuntime, provider, kind);
      }
      if (this.features.urlElicitation) {
        await this.urlLogin(modelRuntime, provider);
        return this.authResult(modelRuntime, provider, "api_key");
      }
      const launch = terminalLaunchSpec();
      throw this.authError(
        modelRuntime,
        `authenticate ${params.methodId} needs the key another way: send _meta["api-key"] = {"apiKey": "<key>"} (openma extension), use a client that supports URL elicitation, or run \`${launch.command} ${launch.args.join(" ")}\` to log in`
      );
    }
    await this.storeApiKey(modelRuntime, provider, submitted.apiKey);
    return this.authResult(modelRuntime, provider, "api_key");
  }
  /** `_meta.gateway` → a models.json provider entry, then refresh so pi serves it. */
  async gatewayAuthenticate(modelRuntime, params) {
    const parsed = gatewayFromAuthenticate(params._meta);
    if (parsed === void 0) {
      throw invalidParams(
        `authenticate methodId "${GATEWAY_METHOD_ID}" requires _meta.gateway = {"baseUrl": "https://\u2026", "headers"?: {"Authorization": "Bearer <key>"}, "providerName"?: "\u2026"}`
      );
    }
    if ("error" in parsed) throw invalidParams(parsed.error);
    const gw = parsed.submission;
    const patch = {
      baseUrl: gw.baseUrl,
      api: gw.api ?? "openai-completions",
      ...gw.name !== void 0 ? { name: gw.name } : {},
      ...gw.apiKey !== void 0 ? { apiKey: gw.apiKey } : {},
      ...Object.keys(gw.headers).length > 0 ? { headers: gw.headers } : {},
      ...gw.models !== void 0 ? { models: gw.models } : {}
    };
    this.writeModelsJsonProvider(gw.provider, patch);
    await modelRuntime.refresh({ allowNetwork: false });
    return this.authResult(modelRuntime, gw.provider, "gateway");
  }
  /** Merge `patch` into `providers[providerId]` in `<agentDir>/models.json`. */
  writeModelsJsonProvider(providerId, patch) {
    const path = join5(this.agentDir, "models.json");
    let doc = {};
    if (existsSync2(path)) {
      let raw;
      try {
        raw = JSON.parse(readFileSync5(path, "utf8"));
      } catch (error) {
        throw internalError(`cannot parse ${path}: ${errorMessage(error)}`);
      }
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw internalError(`${path} must contain a JSON object`);
      }
      doc = raw;
    }
    const providers = typeof doc["providers"] === "object" && doc["providers"] !== null ? { ...doc["providers"] } : {};
    const existing = providers[providerId];
    providers[providerId] = {
      ...typeof existing === "object" && existing !== null ? existing : {},
      ...patch
    };
    try {
      mkdirSync2(this.agentDir, { recursive: true });
      writeFileSync2(path, JSON.stringify({ ...doc, providers }, null, 2) + "\n");
    } catch (error) {
      throw internalError(`cannot write ${path}: ${errorMessage(error)}`);
    }
  }
  /**
   * Drop the provider's credential material from models.json (`apiKey` plus
   * Authorization/x-api-key headers). Returns true when something was removed.
   */
  scrubModelsJsonAuth(providerId) {
    const path = join5(this.agentDir, "models.json");
    if (!existsSync2(path)) return false;
    let doc;
    try {
      const raw = JSON.parse(readFileSync5(path, "utf8"));
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
      doc = raw;
    } catch {
      return false;
    }
    const providers = doc["providers"];
    if (providers === null || typeof providers !== "object") return false;
    const providerMap = providers;
    const existing = providerMap[providerId];
    if (existing === null || typeof existing !== "object") return false;
    const next = { ...existing };
    let removed = false;
    if ("apiKey" in next) {
      delete next["apiKey"];
      removed = true;
    }
    const headers = next["headers"];
    if (headers !== null && typeof headers === "object") {
      const kept = {};
      for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        if (lower === "authorization" || lower === "x-api-key") removed = true;
        else kept[name] = value;
      }
      if (Object.keys(kept).length === 0) delete next["headers"];
      else next["headers"] = kept;
    }
    if (!removed) return false;
    if (Object.keys(next).length === 0) delete providerMap[providerId];
    else providerMap[providerId] = next;
    try {
      writeFileSync2(path, JSON.stringify(doc, null, 2) + "\n");
    } catch (error) {
      logWarn(`could not update ${path}: ${errorMessage(error)}`);
      return false;
    }
    return true;
  }
  /** Provider ids whose credential can actually be removed (store, runtime, or models.json). */
  async removableProviders(modelRuntime) {
    const removable = /* @__PURE__ */ new Set();
    for (const credential of await modelRuntime.listCredentials()) {
      removable.add(credential.providerId);
    }
    for (const provider of this.runtimeKeys) removable.add(provider);
    const path = join5(this.agentDir, "models.json");
    if (existsSync2(path)) {
      try {
        const doc = JSON.parse(readFileSync5(path, "utf8"));
        for (const [id, config] of Object.entries(doc.providers ?? {})) {
          if (config !== null && typeof config === "object" && (config.apiKey !== void 0 || Object.keys(config.headers ?? {}).some(
            (name) => name.toLowerCase() === "authorization" || name.toLowerCase() === "x-api-key"
          ))) {
            removable.add(id);
          }
        }
      } catch {
      }
    }
    return [...removable];
  }
  /**
   * Which provider a bare `logout` targets: the running session's model
   * provider — that is the credential in use — else the configured model's
   * provider (settings `--model`/settings.json `defaultProvider`), else the
   * only provider with a removable credential.
   */
  async defaultLogoutProvider(modelRuntime) {
    const live = [...this.sessions.values()];
    const sessionProvider = live[live.length - 1]?.session.model?.provider;
    if (sessionProvider !== void 0) return sessionProvider;
    const configured = this.settings.model?.split("/")[0] ?? this.settingsDefaultProvider();
    if (configured !== void 0) return configured;
    const removable = await this.removableProviders(modelRuntime);
    return removable.length === 1 ? removable[0] : void 0;
  }
  settingsDefaultProvider() {
    try {
      return SettingsManager2.create(process.cwd(), this.agentDir).getDefaultProvider();
    } catch {
      return void 0;
    }
  }
  /** Remove one provider's credential everywhere it can live. */
  async logoutProvider(modelRuntime, provider) {
    let removed = false;
    const stored = await modelRuntime.listCredentials();
    if (stored.some((credential) => credential.providerId === provider)) {
      try {
        await modelRuntime.logout(provider);
        removed = true;
      } catch (error) {
        logWarn(`logout ${provider} failed: ${errorMessage(error)}`);
      }
    }
    if (this.runtimeKeys.delete(provider)) {
      try {
        await modelRuntime.removeRuntimeApiKey(provider);
      } catch (error) {
        logWarn(`removing runtime key for ${provider} failed: ${errorMessage(error)}`);
      }
      removed = true;
    }
    if (this.scrubModelsJsonAuth(provider)) removed = true;
    return removed;
  }
  /** API-key entry through a loopback page opened by a URL elicitation. */
  async urlLogin(modelRuntime, provider) {
    const requestId = this.requestIds?.latestFor("authenticate");
    if (requestId === void 0) {
      throw internalError("URL login needs the authenticate request id (request tracking is not wired)");
    }
    const providerName = modelRuntime.getProvider(provider)?.name ?? provider;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_FLOW_TIMEOUT_MS);
    try {
      const apiKey = await captureApiKeyViaUrl({
        conn: this.conn,
        requestId,
        provider: providerName,
        signal: controller.signal
      });
      await this.storeApiKey(modelRuntime, provider, apiKey);
    } catch (error) {
      if (error instanceof AuthFlowCancelled || controller.signal.aborted) {
        throw this.authError(modelRuntime, `login with ${providerName} was cancelled`);
      }
      throw this.authError(modelRuntime, `login with ${providerName} failed: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  /** Run pi's provider OAuth flow, delivering URLs/codes/prompts through ACP elicitation. */
  async oauthLogin(modelRuntime, provider) {
    if (modelRuntime.getProvider(provider)?.auth.oauth === void 0)
      throw invalidParams(`provider "${provider}" has no OAuth login`);
    const requestId = this.requestIds?.latestFor("authenticate");
    if (requestId === void 0)
      throw internalError("OAuth login needs the authenticate request id (request tracking is not wired)");
    if (!this.features.urlElicitation && !this.features.formElicitation)
      throw this.authError(modelRuntime, "OAuth login needs a client that supports URL or form elicitation");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_FLOW_TIMEOUT_MS);
    const interaction = createAcpAuthInteraction({
      conn: this.conn,
      requestId,
      provider,
      urlElicitation: this.features.urlElicitation,
      formElicitation: this.features.formElicitation,
      signal: controller.signal
    });
    try {
      await modelRuntime.login(provider, "oauth", interaction);
    } catch (error) {
      if (error instanceof AuthFlowCancelled || controller.signal.aborted) {
        throw this.authError(modelRuntime, `login with ${provider} was cancelled`);
      }
      throw this.authError(modelRuntime, `login with ${provider} failed: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
      controller.abort();
      await interaction.finish();
    }
    await modelRuntime.refresh({ allowNetwork: false });
  }
  async logout(params) {
    try {
      return await this.runLogout(params);
    } finally {
      void this.publishAuthStatus();
    }
  }
  async runLogout(params) {
    const modelRuntime = await this.modelRuntime();
    const scope = logoutScopeFromMeta(params._meta);
    let targets;
    if (scope.all === true) {
      targets = await this.removableProviders(modelRuntime);
    } else {
      const provider = scope.provider ?? await this.defaultLogoutProvider(modelRuntime);
      if (provider === void 0) {
        const removable = await this.removableProviders(modelRuntime);
        throw invalidParams(
          `logout needs a scope \u2014 pass _meta.pi.logout = {"provider": "<id>"} ` + (removable.length > 0 ? `(signed in: ${removable.join(", ")}) ` : "") + `or {"all": true} to sign out of every provider`
        );
      }
      targets = [provider];
    }
    const cleared = [];
    for (const provider of targets) {
      if (await this.logoutProvider(modelRuntime, provider)) cleared.push(provider);
    }
    await modelRuntime.refresh({ allowNetwork: false });
    return {
      _meta: piMeta({ logout: { cleared }, authStatus: computeAuthStatus(modelRuntime) })
    };
  }
  async newSession(params) {
    this.assertOpen();
    validateCwd(params.cwd);
    const session = await this.openSession({
      cwd: params.cwd,
      reason: "new",
      mcpServers: params.mcpServers,
      directoryPlan: directoryPlanOf(params.additionalDirectories, params.cwd, params._meta)
    });
    try {
      await this.requireModel(session);
    } catch (error) {
      this.sessions.delete(session.sessionId);
      const file = session.session.sessionFile;
      await session.close();
      if (file !== void 0 && existsSync2(file)) {
        try {
          unlinkSync(file);
        } catch {
        }
      }
      throw error;
    }
    void this.publishSurfaces(session, { startup: true });
    return {
      sessionId: session.sessionId,
      configOptions: session.configOptions(),
      _meta: piMeta({
        sessionFile: session.session.sessionFile ?? null,
        diagnostics: session.diagnostics,
        extensions: session.extensions(),
        ...directoryEcho(session)
      })
    };
  }
  async loadSession(params) {
    this.assertOpen();
    validateCwd(params.cwd);
    const stored = await findSession(params.sessionId, this.sessionDir);
    if (stored === void 0) throw invalidParams(`unknown session: ${params.sessionId}`);
    const session = await this.openSession({
      cwd: params.cwd,
      sessionFile: stored.path,
      reason: "load",
      mcpServers: params.mcpServers,
      directoryPlan: directoryPlanOf(params.additionalDirectories, params.cwd, params._meta),
      sessionId: params.sessionId
    });
    session.replayHistory();
    await session.flush();
    await this.requireModel(session).catch((error) => {
      logWarn(`loaded session ${params.sessionId} without a usable model: ${errorMessage(error)}`);
    });
    void this.publishSurfaces(session);
    return {
      configOptions: session.configOptions(),
      _meta: piMeta({
        sessionFile: stored.path,
        diagnostics: session.diagnostics,
        extensions: session.extensions(),
        ...directoryEcho(session)
      })
    };
  }
  async resumeSession(params) {
    this.assertOpen();
    validateCwd(params.cwd);
    const stored = await findSession(params.sessionId, this.sessionDir);
    if (stored === void 0) throw invalidParams(`unknown session: ${params.sessionId}`);
    const session = await this.openSession({
      cwd: params.cwd,
      sessionFile: stored.path,
      reason: "resume",
      mcpServers: params.mcpServers,
      directoryPlan: directoryPlanOf(params.additionalDirectories, params.cwd, params._meta),
      sessionId: params.sessionId
    });
    await this.requireModel(session).catch((error) => {
      logWarn(`resumed session ${params.sessionId} without a usable model: ${errorMessage(error)}`);
    });
    void this.publishSurfaces(session);
    return {
      configOptions: session.configOptions(),
      _meta: piMeta({
        sessionFile: stored.path,
        diagnostics: session.diagnostics,
        extensions: session.extensions(),
        ...directoryEcho(session)
      })
    };
  }
  async unstable_forkSession(params) {
    this.assertOpen();
    validateCwd(params.cwd);
    const parsed = parseJetbrainsAirFork(params._meta);
    if (parsed.status === "invalid") throw invalidParams(parsed.message);
    const live = this.sessions.get(params.sessionId);
    const sourceFile = live?.session.sessionFile ?? (await findSession(params.sessionId, this.sessionDir))?.path;
    if (sourceFile === void 0) throw invalidParams(`unknown session: ${params.sessionId}`);
    let sessionFile = sourceFile;
    let fork = true;
    if (parsed.status === "present") {
      let branched;
      try {
        branched = forkInclusiveSession(sourceFile, params.cwd, this.sessionDir, parsed.request);
      } catch (error) {
        throw internalError(`inclusive fork failed: ${errorMessage(error)}`);
      }
      if (branched === void 0) {
        throw invalidParams(forkPointNotFoundMessage(parsed.request.messageId, params.sessionId), {
          messageId: parsed.request.messageId
        });
      }
      sessionFile = branched;
      fork = false;
    }
    const session = await this.openSession({
      cwd: params.cwd,
      sessionFile,
      fork,
      reason: "fork",
      mcpServers: params.mcpServers ?? void 0,
      directoryPlan: directoryPlanOf(params.additionalDirectories, params.cwd, params._meta)
    });
    await this.requireModel(session).catch((error) => {
      logWarn(`forked session without a usable model: ${errorMessage(error)}`);
    });
    void this.publishSurfaces(session);
    return {
      sessionId: session.sessionId,
      configOptions: session.configOptions(),
      _meta: piMeta({
        sessionFile: session.session.sessionFile ?? null,
        forkedFrom: params.sessionId,
        extensions: session.extensions(),
        ...directoryEcho(session)
      })
    };
  }
  async listSessions(params) {
    this.assertOpen();
    const entries = await listSessions({
      ...params.cwd !== void 0 && params.cwd !== null ? { cwd: params.cwd } : {},
      ...this.sessionDir !== void 0 ? { sessionDir: this.sessionDir } : {}
    });
    const offset = params.cursor !== void 0 && params.cursor !== null ? Number.parseInt(params.cursor, 10) : 0;
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const page2 = entries.slice(start, start + LIST_PAGE_SIZE);
    return {
      sessions: page2.map(toAcpSessionInfo),
      nextCursor: start + LIST_PAGE_SIZE < entries.length ? String(start + LIST_PAGE_SIZE) : null
    };
  }
  async deleteSession(params) {
    this.openGenerations.set(params.sessionId, (this.openGenerations.get(params.sessionId) ?? 0) + 1);
    const live = this.sessions.get(params.sessionId);
    let file = live?.session.sessionFile;
    if (live !== void 0) {
      this.sessions.delete(params.sessionId);
      await live.close();
    }
    file ??= (await findSession(params.sessionId, this.sessionDir))?.path;
    if (file !== void 0 && existsSync2(file)) {
      try {
        unlinkSync(file);
      } catch (error) {
        throw internalError(`could not delete session file: ${errorMessage(error)}`);
      }
    }
  }
  async closeSession(params) {
    this.openGenerations.set(params.sessionId, (this.openGenerations.get(params.sessionId) ?? 0) + 1);
    const live = this.sessions.get(params.sessionId);
    if (live === void 0) return;
    this.sessions.delete(params.sessionId);
    await live.close();
  }
  async prompt(params) {
    this.assertOpen();
    const session = await this.requireOrRestore(params.sessionId);
    let converted;
    try {
      converted = convertPrompt(params.prompt, {
        images: session.session.model?.input.includes("image") ?? true
      });
    } catch (error) {
      if (error instanceof UnsupportedPromptContentError) throw invalidParams(error.message);
      throw error;
    }
    if (converted.text.trim().length === 0 && converted.images.length === 0)
      throw invalidParams("empty prompt");
    const slash = converted.images.length === 0 ? parseSlashCommand(converted.text) : void 0;
    if (slash !== void 0 && isNativeAuthCommand(slash.name)) {
      const directive = slash.name === "login" ? "sign in through the client's authentication (ACP auth methods)" : "sign out through the client's logout (ACP `logout`)";
      session.text(`"/${slash.name}" isn't available over ACP \u2014 ${directive}; credentials are unchanged.`);
      await session.flush();
      return { stopReason: "end_turn" };
    }
    if (slash !== void 0 && isBuiltinCommand(slash.name)) {
      if (session.isRunning && !["status", "queue", "session"].includes(slash.name)) {
        session.text(`\u26A0 /${slash.name} is unavailable while a turn is running.`);
        return { stopReason: "end_turn" };
      }
      const outcome = await runBuiltinCommand(session, slash.name, slash.args);
      if (outcome !== void 0) {
        session.text(outcome.text);
        if (outcome.refresh?.title !== void 0) {
          session.emit({
            sessionUpdate: "session_info_update",
            title: outcome.refresh.title,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        if (outcome.refresh?.config === true) session.publishConfigOptions();
        if (outcome.refresh?.commands === true) session.publishCommands();
        await session.flush();
        return { stopReason: "end_turn" };
      }
    }
    if (!session.isRunning) await this.requireModel(session);
    let stopReason;
    try {
      stopReason = await session.prompt(converted.text, converted.images);
    } catch (error) {
      throw await this.enrichAuthError(error);
    }
    const usage = session.projection.promptUsage();
    return { stopReason, ...usage !== void 0 ? { usage } : {} };
  }
  /** Every auth-related -32000 carries data.authMethods — attach it when pi's
   *  didn't; a provider failure that merely *looks* like auth (mid-turn
   *  rejection, accepted prompts) is upgraded to -32000 the same way so the
   *  client can open its auth UI (openma-ai/Martty#160). */
  async enrichAuthError(error) {
    const e = error;
    if (e.code === RequestError2.authRequired().code) {
      const modelRuntime2 = await this.modelRuntime();
      return authRequired(error.message, {
        ...e.data,
        authMethods: buildAuthMethods(modelRuntime2, this.authMethodOptions())
      });
    }
    if (!looksLikeAuthError(error)) return error;
    const modelRuntime = await this.modelRuntime();
    return authRequired(errorMessage(error), {
      authMethods: buildAuthMethods(modelRuntime, this.authMethodOptions())
    });
  }
  async cancel(params) {
    const session = this.sessions.get(params.sessionId);
    if (session === void 0) return;
    await session.cancel();
  }
  async setSessionConfigOption(params) {
    const session = await this.requireOrRestore(params.sessionId);
    const value = params.value;
    switch (params.configId) {
      case CONFIG_MODEL: {
        if (typeof value !== "string") throw invalidParams("model must be a string");
        if (session.isRunning) throw invalidParams("cannot switch models while a turn is running");
        await session.setModel(value);
        break;
      }
      case CONFIG_THINKING: {
        if (typeof value !== "string") throw invalidParams("thinking level must be a string");
        session.setThinking(value);
        break;
      }
      case CONFIG_AUTO_COMPACTION: {
        const enabled = parseBooleanOptionValue(value);
        if (enabled === void 0) throw invalidParams("auto_compaction must be a boolean or on/off");
        session.session.setAutoCompactionEnabled(enabled);
        break;
      }
      default:
        throw invalidParams(`unknown config option: ${params.configId}`);
    }
    return { configOptions: session.configOptions() };
  }
  async extMethod(method, params) {
    if (method === "_session/steering") return this.steering(params);
    if (method === "_pi/trust_project") return this.trustProject(params);
    if (method === ADD_DIRECTORY_METHOD) return this.addDirectory(params);
    if (method === "_pi/emit_event") return this.emitEvent(params);
    if (method === LEGACY_SET_MODEL_METHOD) return this.legacySetModel(params);
    throw RequestError2.methodNotFound(method);
  }
  /** `session/set_model` (pre-config-option clients): `{ sessionId, modelId }`. */
  async legacySetModel(params) {
    const sessionId = params["sessionId"];
    const modelId = params["modelId"];
    if (typeof sessionId !== "string" || typeof modelId !== "string")
      throw invalidParams(`${LEGACY_SET_MODEL_METHOD} requires sessionId and modelId`);
    const session = await this.requireOrRestore(sessionId);
    if (session.isRunning) throw invalidParams("cannot switch models while a turn is running");
    await session.setModel(modelId);
    session.publishConfigOptions();
    return {};
  }
  /** `_session/steering`: inject into the running turn; never starts a detached turn. */
  async steering(params) {
    const sessionId = params["sessionId"];
    if (typeof sessionId !== "string" || sessionId.length === 0)
      throw invalidParams("_session/steering requires a sessionId");
    const session = await this.requireOrRestore(sessionId);
    const prompt = Array.isArray(params["prompt"]) ? params["prompt"] : [];
    if (prompt.length === 0) throw invalidParams("empty prompt");
    let converted;
    try {
      converted = convertPrompt(prompt);
    } catch (error) {
      if (error instanceof UnsupportedPromptContentError) throw invalidParams(error.message);
      throw error;
    }
    if (!session.isRunning) return { outcome: "promptRequired", reason: "noRunningTurn" };
    try {
      await session.steer(converted.text, converted.images);
    } catch (error) {
      throw internalError(`steering failed: ${errorMessage(error)}`);
    }
    return { outcome: "injected" };
  }
  /** `_pi/emit_event`: publish on the session's extension event bus (the reverse of `extension_event`). */
  async emitEvent(params) {
    const sessionId = params["sessionId"];
    const channel = params["channel"];
    if (typeof sessionId !== "string" || sessionId.length === 0 || typeof channel !== "string" || channel.length === 0)
      throw invalidParams("_pi/emit_event requires sessionId and channel");
    const session = await this.requireOrRestore(sessionId);
    session.injectExtensionEvent(channel, params["data"]);
    return {};
  }
  /** `_pi/add_directory`: append one root to a live session and persist it. */
  async addDirectory(params) {
    if (!additionalDirectoriesSupported()) throw invalidParams("additionalDirectories are not available");
    const sessionId = params["sessionId"];
    const path = params["path"];
    if (typeof sessionId !== "string" || sessionId.length === 0 || typeof path !== "string" || path.length === 0) {
      throw invalidParams(`${ADD_DIRECTORY_METHOD} requires sessionId and path`);
    }
    const session = await this.requireOrRestore(sessionId);
    return { additionalDirectories: session.addAdditionalDirectory(path) };
  }
  /** `_pi/trust_project`: trust the session cwd (optionally remembered) and reload resources. */
  async trustProject(params) {
    const sessionId = params["sessionId"];
    if (typeof sessionId !== "string" || sessionId.length === 0)
      throw invalidParams("_pi/trust_project requires a sessionId");
    const session = await this.requireOrRestore(sessionId);
    await session.trustProject(params["remember"] === true);
    session.publishCommands();
    return { trusted: true };
  }
};
function validateCwd(cwd) {
  if (!isAbsolute3(cwd)) throw invalidParams(`cwd must be an absolute path: ${cwd}`);
  if (!existsSync2(cwd)) throw invalidParams(`cwd does not exist: ${cwd}`);
}
function directoryEcho(session) {
  return {
    additionalDirectories: session.additionalDirectories,
    additionalDirectoriesEnforced: session.additionalDirectoriesEnforced
  };
}
function directoryPlanOf(requested, cwd, meta) {
  const omitted = requested === void 0 || requested === null;
  const restore = omitted && readPiMeta(meta)?.["restoreAdditionalDirectories"] === true;
  try {
    return resolveAdditionalDirectoriesRequest(requested, cwd, {
      supported: additionalDirectoriesSupported(),
      restore
    });
  } catch (error) {
    if (error instanceof AdditionalDirectoriesError) throw invalidParams(error.message);
    throw error;
  }
}

// src/server.ts
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable } from "stream";

// src/acp/request-ids.ts
var RequestIdTracker = class {
  latest = /* @__PURE__ */ new Map();
  record(message) {
    if (message === null || typeof message !== "object") return;
    const record = message;
    if (typeof record.method !== "string") return;
    if (typeof record.id !== "string" && typeof record.id !== "number") return;
    this.latest.set(record.method, record.id);
  }
  /** Id of the most recent inbound request for `method`, if any. */
  latestFor(method) {
    return this.latest.get(method);
  }
};
function tapRequestIds(stream, tracker) {
  const tap = new TransformStream({
    transform(message, controller) {
      tracker.record(message);
      controller.enqueue(message);
    }
  });
  return { writable: stream.writable, readable: stream.readable.pipeThrough(tap) };
}

// src/server.ts
function stdioStream() {
  const write2 = process.stdout.write.bind(process.stdout);
  const output = new WritableStream({
    write(chunk) {
      return new Promise((resolve2, reject) => {
        write2(Buffer.from(chunk), (error) => {
          if (error) reject(error);
          else resolve2();
        });
      });
    }
  });
  return ndJsonStream(output, Readable.toWeb(process.stdin));
}
function serve(options) {
  const requestIds = new RequestIdTracker();
  const stream = tapRequestIds(options.stream ?? stdioStream(), requestIds);
  let agent;
  const connection = new AgentSideConnection((conn) => {
    agent = new PiAcpAgent(conn, { ...options, requestIds });
    return agent;
  }, stream);
  const closed = connection.closed.catch((error) => {
    logWarn(`connection closed with an error: ${errorMessage(error)}`);
  }).then(() => agent.dispose());
  return { agent, connection, closed };
}

// src/settings.ts
import { isAbsolute as isAbsolute4, resolve } from "path";
var SettingsError = class extends Error {
};
var HELP_TEXT = `openma-pi-acp \u2014 Agent Client Protocol server for the pi coding agent

Usage: openma-pi-acp [options]
       openma-pi-acp --terminal-login       Launch pi interactively (login / setup)
       openma-pi-acp --version | --help

Options:
  --agent-dir <path>        pi config dir (default ~/.pi/agent; env PI_CODING_AGENT_DIR)
  --model <provider/id>     Model for new sessions (env PI_ACP_MODEL)
  --session-dir <path>      Session storage dir (env PI_ACP_SESSION_DIR)
  --trust-projects          Load project .pi/ resources everywhere (env PI_ACP_TRUST_PROJECTS=1)
  --no-delegation           Never use client fs/terminal delegation (env PI_ACP_DELEGATION=0)
  --quiet-startup           Skip the startup banner (env PI_ACP_QUIET_STARTUP=1)

Diagnostics: PI_ACP_DEBUG=1 for verbose stderr logging.
`;
function envFlag(name) {
  const value = process.env[name];
  if (value === void 0 || value === "") return void 0;
  return !(value === "0" || value.toLowerCase() === "false" || value.toLowerCase() === "off");
}
function resolveSettings(argv) {
  let agentDir = process.env["PI_CODING_AGENT_DIR"];
  let model = process.env["PI_ACP_MODEL"];
  let sessionDir = process.env["PI_ACP_SESSION_DIR"];
  let trustProjects = envFlag("PI_ACP_TRUST_PROJECTS") ?? false;
  let delegation = envFlag("PI_ACP_DELEGATION") ?? true;
  let quietStartup = envFlag("PI_ACP_QUIET_STARTUP");
  const take = (index, flag) => {
    const value = argv[index + 1];
    if (value === void 0 || value.startsWith("--")) throw new SettingsError(`${flag} requires a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === void 0) continue;
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : void 0;
    const value = () => {
      if (inline !== void 0) return inline;
      const v = take(i, flag);
      i += 1;
      return v;
    };
    switch (flag) {
      case "--agent-dir":
        agentDir = value();
        break;
      case "--model":
        model = value();
        break;
      case "--session-dir":
        sessionDir = value();
        break;
      case "--trust-projects":
        trustProjects = true;
        break;
      case "--no-delegation":
        delegation = false;
        break;
      case "--quiet-startup":
        quietStartup = true;
        break;
      case "--terminal-login":
      case "--version":
      case "--help":
        break;
      default:
        throw new SettingsError(`unknown option: ${arg}`);
    }
  }
  return {
    agentDir: agentDir !== void 0 ? isAbsolute4(agentDir) ? agentDir : resolve(agentDir) : void 0,
    model,
    quietStartup,
    trustProjects,
    delegation,
    sessionDir: sessionDir !== void 0 ? isAbsolute4(sessionDir) ? sessionDir : resolve(sessionDir) : void 0
  };
}

export {
  logError,
  errorMessage,
  PACKAGE_NAME,
  VERSION,
  TERMINAL_AUTH_METHOD_ID,
  buildAuthMethods,
  modelValue,
  findModel,
  buildConfigOptions,
  BUILTIN_COMMANDS,
  parseSlashCommand,
  availableCommandsFor,
  UnsupportedPromptContentError,
  convertPrompt,
  classifyToolCall,
  buildReplay,
  assistantStopReasonToAcp,
  SessionProjection,
  PiAcpSession,
  PiAcpAgent,
  stdioStream,
  serve,
  SettingsError,
  HELP_TEXT,
  resolveSettings
};
//# sourceMappingURL=chunk-DIAKPJV3.js.map