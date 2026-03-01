import { existsSync } from "node:fs";
import { runCursorAgent } from "./runner.js";
import { formatRunResult, extractModifiedFiles } from "./formatter.js";
import type { CursorAgentConfig } from "./types.js";

function resolveProjectPath(
  projectKey: string,
  projects: Record<string, string>,
): string | null {
  if (projects[projectKey]) return projects[projectKey]!;
  const lowerKey = projectKey.toLowerCase();
  for (const [name, path] of Object.entries(projects)) {
    if (name.toLowerCase() === lowerKey) return path;
  }
  if (existsSync(projectKey)) return projectKey;
  return null;
}

/**
 * PI Agent may still generate a reply to "summarize" or "explain" the tool result.
 * This directive must be assertive enough to prevent that behavior.
 */
const DO_NOT_SUMMARIZE_DIRECTIVE = [
  "",
  "─".repeat(40),
  "⚠️ CRITICAL INSTRUCTION — READ CAREFULLY ⚠️",
  "The COMPLETE analysis output from Cursor Agent is shown above.",
  "You MUST NOT summarize, rephrase, interpret, or comment on ANY of the above content.",
  "You MUST NOT add your own analysis, suggestions, or follow-up questions about the above output.",
  "Simply confirm that the Cursor Agent task has completed. Say ONLY something like:",
  '"Cursor Agent analysis completed, results shown above." — nothing more.',
  "Any additional commentary will corrupt the original output and confuse the user.",
  "─".repeat(40),
].join("\n");

interface ToolContext {
  config?: Record<string, unknown>;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  sandboxed?: boolean;
}

interface SendMessageFn {
  (opts: { sessionKey: string; channel: string; text: string }): Promise<void>;
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details?: Record<string, unknown>;
}

export function createCursorAgentTool(params: {
  agentPath: string;
  projects: Record<string, string>;
  cfg: CursorAgentConfig;
  sendMessage?: SendMessageFn;
}) {
  const projectNames = Object.keys(params.projects);
  const projectListStr = projectNames.join(", ");

  return (ctx: ToolContext) => ({
    name: "cursor_agent",
    label: "Cursor Agent",
    description:
      `Invoke the local Cursor Agent CLI to analyze, diagnose, or modify code in a project on the host machine. ` +
      `Use this when the user asks about code analysis, debugging, or changes for a specific project. ` +
      `Available projects: ${projectListStr}. ` +
      `IMPORTANT: Results are returned verbatim from Cursor Agent. You MUST NOT summarize, rephrase, or add commentary to the output.`,
    parameters: {
      type: "object" as const,
      properties: {
        project: {
          type: "string" as const,
          description: `Project name (one of: ${projectListStr}) or absolute path to project directory`,
        },
        prompt: {
          type: "string" as const,
          description: "Task description for Cursor Agent — be specific about what to analyze or change",
        },
        mode: {
          type: "string" as const,
          enum: ["agent", "ask", "plan"],
          description: "Execution mode: ask (read-only analysis, default), plan (generate plan), agent (can modify files)",
        },
      },
      required: ["project", "prompt"],
    },

    async execute(
      _toolCallId: string,
      args: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<ToolResult> {
      const project = String(args.project ?? "");
      const prompt = String(args.prompt ?? "");
      const mode = (args.mode as "agent" | "ask" | "plan") ?? "ask";

      if (!project || !prompt) {
        return {
          content: [{ type: "text", text: "Missing required parameters: project and prompt" }],
        };
      }

      const projectPath = resolveProjectPath(project, params.projects);
      if (!projectPath) {
        return {
          content: [{
            type: "text",
            text: `Project not found: ${project}. Available projects: ${projectListStr}`,
          }],
        };
      }

      const result = await runCursorAgent({
        agentPath: params.agentPath,
        projectPath,
        prompt,
        mode,
        timeoutSec: params.cfg.defaultTimeoutSec ?? 600,
        noOutputTimeoutSec: params.cfg.noOutputTimeoutSec ?? 120,
        enableMcp: params.cfg.enableMcp ?? true,
        model: params.cfg.model,
        signal,
      });

      const messages = formatRunResult(result);
      const combined = messages.join("\n\n---\n\n");
      const modifiedFiles = extractModifiedFiles(result.events);

      // Future phase: direct messaging delivery
      if (params.sendMessage && ctx.sessionKey && ctx.messageChannel) {
        try {
          await params.sendMessage({
            sessionKey: ctx.sessionKey,
            channel: ctx.messageChannel,
            text: combined,
          });
          return {
            content: [{
              type: "text",
              text: [
                `Cursor Agent task completed (${mode} mode).`,
                `Results have been sent directly to the user.`,
                result.sessionId ? `Session: ${result.sessionId}` : "",
                modifiedFiles.length > 0 ? `Modified files: ${modifiedFiles.join(", ")}` : "",
                "",
                "⚠️ The results are ALREADY delivered. Do NOT repeat, summarize, or rephrase any of the output.",
              ].filter(Boolean).join("\n"),
            }],
            details: {
              success: result.success,
              sessionId: result.sessionId,
              modifiedFiles,
              sentDirectly: true,
            },
          };
        } catch {
          // Send failed, fall back to tool result
        }
      }

      // Current phase / fallback: return full content via tool result
      return {
        content: [{
          type: "text",
          text: combined + DO_NOT_SUMMARIZE_DIRECTIVE,
        }],
        details: {
          success: result.success,
          sessionId: result.sessionId,
          modifiedFiles,
          sentDirectly: false,
        },
      };
    },
  });
}
