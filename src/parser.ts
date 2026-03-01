import type { CursorStreamEvent, ToolCallEvent } from "./types.js";

/**
 * Parse an event from a stream-json line. Each line is an independent JSON object.
 */
export function parseStreamLine(line: string): CursorStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as CursorStreamEvent;
  } catch {
    return null;
  }
}

/** Extract tool name from a tool_call event */
export function extractToolName(event: ToolCallEvent): string {
  const tc = event.tool_call;
  if (!tc) return "unknown";
  const keys = Object.keys(tc);
  for (const key of keys) {
    if (key.endsWith("ToolCall")) {
      return key.replace("ToolCall", "");
    }
  }
  return keys[0] ?? "unknown";
}

/** Extract tool argument summary from a tool_call started event */
export function extractToolArgs(event: ToolCallEvent): string {
  const tc = event.tool_call;
  if (!tc) return "";
  for (const value of Object.values(tc)) {
    const v = value as Record<string, unknown>;
    if (v?.args) {
      const args = v.args as Record<string, unknown>;
      if (args.path) return String(args.path).split(/[/\\]/).pop() ?? "";
      if (args.pattern) return String(args.pattern);
      if (args.globPattern) return String(args.globPattern);
      if (args.command) {
        const cmd = String(args.command);
        return cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
      }
    }
  }
  return "";
}

/** Extract result text from a tool_call completed event */
export function extractToolResult(event: ToolCallEvent): string {
  const tc = event.tool_call;
  if (!tc) return "";
  for (const value of Object.values(tc)) {
    const v = value as Record<string, unknown>;
    // The result field may appear at different locations in completed events
    if (typeof v?.result === "string") return truncate(v.result, 2000);
    if (v?.output && typeof v.output === "string") return truncate(v.output, 2000);
    if (v?.content) {
      const content = v.content;
      if (Array.isArray(content)) {
        const texts = content
          .filter((c: Record<string, unknown>) => c.type === "text" && c.text)
          .map((c: Record<string, unknown>) => String(c.text));
        if (texts.length > 0) return truncate(texts.join("\n"), 2000);
      }
    }
  }
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (truncated, ${s.length - max} chars omitted)`;
}
