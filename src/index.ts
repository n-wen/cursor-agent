import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { runCursorAgent } from "./runner.js";
import { formatRunResult } from "./formatter.js";
import { ensureShutdownHook, setMaxConcurrent } from "./process-registry.js";
import { createCursorAgentTool } from "./tool.js";
import type { CursorAgentConfig, ParsedCommand } from "./types.js";

const PLUGIN_ID = "cursor-agent";

const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_NO_OUTPUT_TIMEOUT_SEC = 120;
const DEFAULT_ENABLE_MCP = true;
const DEFAULT_MODE = "agent" as const;

/** Auto-detect agent command path */
function detectAgentPath(): string | null {
  try {
    const cmd = process.platform === "win32" ? "where agent" : "which agent";
    const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    const first = result.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  } catch { /* ignore */ }

  if (process.platform === "win32") {
    const home = process.env.USERPROFILE || "";
    const defaultPath = resolve(home, "AppData/Local/cursor-agent/agent.cmd");
    if (existsSync(defaultPath)) return defaultPath;
  }

  return null;
}

/**
 * Parse /cursor command arguments.
 *
 * Format:
 *   /cursor <project> <prompt>
 *   /cursor <project> --continue <prompt>
 *   /cursor <project> --resume <chatId> <prompt>
 *   /cursor <project> --mode ask|plan|agent <prompt>
 */
export function parseCommandArgs(args: string): ParsedCommand | { error: string } {
  if (!args?.trim()) {
    return { error: "Usage: /cursor <project> <prompt>\n\nOptions:\n  --continue          Continue previous session\n  --resume <chatId>   Resume a specific session\n  --mode <mode>       Set mode (agent|ask|plan)" };
  }

  const tokens = tokenize(args.trim());
  if (tokens.length === 0) {
    return { error: "Missing project parameter" };
  }

  const project = tokens[0]!;
  let mode: "agent" | "ask" | "plan" = DEFAULT_MODE;
  let continueSession = false;
  let resumeSessionId: string | undefined;
  const promptParts: string[] = [];

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token === "--continue") {
      continueSession = true;
      i++;
    } else if (token === "--resume") {
      i++;
      if (i >= tokens.length) return { error: "--resume requires a chatId" };
      resumeSessionId = tokens[i]!;
      i++;
    } else if (token === "--mode") {
      i++;
      if (i >= tokens.length) return { error: "--mode requires a mode (agent|ask|plan)" };
      const m = tokens[i]! as "agent" | "ask" | "plan";
      if (!["agent", "ask", "plan"].includes(m)) {
        return { error: `Unsupported mode: ${m}, available: agent, ask, plan` };
      }
      mode = m;
      i++;
    } else {
      promptParts.push(tokens.slice(i).join(" "));
      break;
    }
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    return { error: "Missing prompt parameter" };
  }

  return { project, prompt, mode, continueSession, resumeSessionId };
}

/** Simple tokenizer that preserves spaces within quotes */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export default {
  id: PLUGIN_ID,
  configSchema: { type: "object" as const },

  register(api: any) {
    const cfg: CursorAgentConfig = api.pluginConfig ?? {};

    const agentPath = cfg.agentPath || detectAgentPath();
    if (!agentPath) {
      console.warn(`[${PLUGIN_ID}] Cursor Agent CLI not found, plugin disabled`);
      return;
    }

    if (cfg.maxConcurrent) setMaxConcurrent(cfg.maxConcurrent);
    ensureShutdownHook();

    const projects = cfg.projects ?? {};
    const projectNames = Object.keys(projects);
    const projectListStr = projectNames.length > 0
      ? `Available projects: ${projectNames.join(", ")}`
      : "No pre-configured projects, provide a full path";

    // ── Path 1: /cursor command (explicit invocation, bypasses PI Agent) ──
    api.registerCommand({
      name: "cursor",
      description: `Invoke Cursor Agent for code analysis and modification. ${projectListStr}`,
      acceptsArgs: true,
      requireAuth: true,

      async handler(ctx: any) {
        const parsed = parseCommandArgs(ctx.args ?? "");

        if ("error" in parsed) {
          return { text: parsed.error };
        }

        const projectPath = resolveProjectPath(parsed.project, projects);
        if (!projectPath) {
          return {
            text: `Project not found: ${parsed.project}\n${projectListStr}`,
          };
        }

        const result = await runCursorAgent({
          agentPath,
          projectPath,
          prompt: parsed.prompt,
          mode: parsed.mode,
          timeoutSec: cfg.defaultTimeoutSec ?? DEFAULT_TIMEOUT_SEC,
          noOutputTimeoutSec: cfg.noOutputTimeoutSec ?? DEFAULT_NO_OUTPUT_TIMEOUT_SEC,
          enableMcp: cfg.enableMcp ?? DEFAULT_ENABLE_MCP,
          model: cfg.model,
          continueSession: parsed.continueSession,
          resumeSessionId: parsed.resumeSessionId,
        });

        const messages = formatRunResult(result);
        const combined = messages.join("\n\n---\n\n");
        return { text: combined };
      },
    });

    // ── Path 2: Agent Tool (PI Agent fallback invocation) ──
    if (cfg.enableAgentTool !== false && projectNames.length > 0) {
      api.registerTool(
        createCursorAgentTool({ agentPath, projects, cfg }),
        { name: "cursor_agent", optional: true },
      );
      console.log(`[${PLUGIN_ID}] registered cursor_agent tool`);
    }

    console.log(`[${PLUGIN_ID}] registered /cursor command (agent: ${agentPath}, projects: ${projectNames.join(", ") || "none"})`);
  },
};

/** Resolve project path from mapping table or absolute path */
export function resolveProjectPath(
  projectKey: string,
  projects: Record<string, string>,
): string | null {
  // Exact match
  if (projects[projectKey]) return projects[projectKey]!;

  // Case-insensitive match
  const lowerKey = projectKey.toLowerCase();
  for (const [name, path] of Object.entries(projects)) {
    if (name.toLowerCase() === lowerKey) return path;
  }

  // Treat as absolute path
  if (existsSync(projectKey)) return projectKey;

  return null;
}
