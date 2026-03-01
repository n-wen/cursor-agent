import { describe, it, expect } from "vitest";
import { parseStreamLine, extractToolName, extractToolArgs, extractToolResult } from "./parser.js";
import type { ToolCallEvent } from "./types.js";

describe("parseStreamLine", () => {
  it("parses valid JSON lines", () => {
    const line = '{"type":"system","subtype":"init","session_id":"abc"}';
    const result = parseStreamLine(line);
    expect(result).toEqual({ type: "system", subtype: "init", session_id: "abc" });
  });

  it("ignores empty lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("ignores invalid JSON", () => {
    expect(parseStreamLine("not json")).toBeNull();
    expect(parseStreamLine("{broken")).toBeNull();
  });

  it("handles lines with leading/trailing whitespace", () => {
    const line = '  {"type":"result"}  ';
    const result = parseStreamLine(line);
    expect(result).toEqual({ type: "result" });
  });
});

describe("extractToolName", () => {
  it("extracts name from *ToolCall suffix", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: { readToolCall: { args: {} } },
    } as ToolCallEvent;
    expect(extractToolName(event)).toBe("read");
  });

  it("takes first match with multiple ToolCall suffixes", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: { editToolCall: {}, shellToolCall: {} },
    } as ToolCallEvent;
    const name = extractToolName(event);
    expect(["edit", "shell"]).toContain(name);
  });

  it("falls back to first key when no ToolCall suffix", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: { customAction: {} },
    } as ToolCallEvent;
    expect(extractToolName(event)).toBe("customAction");
  });

  it("returns unknown for empty tool_call", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: {},
    } as ToolCallEvent;
    expect(extractToolName(event)).toBe("unknown");
  });

  it("returns unknown when tool_call is missing", () => {
    const event = { type: "tool_call", subtype: "started", call_id: "1" } as unknown as ToolCallEvent;
    expect(extractToolName(event)).toBe("unknown");
  });
});

describe("extractToolArgs", () => {
  it("extracts filename from path argument", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: {
        readToolCall: { args: { path: "/home/user/project/src/main.ts" } },
      },
    } as ToolCallEvent;
    expect(extractToolArgs(event)).toBe("main.ts");
  });

  it("extracts pattern argument", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: {
        searchToolCall: { args: { pattern: "TODO" } },
      },
    } as ToolCallEvent;
    expect(extractToolArgs(event)).toBe("TODO");
  });

  it("extracts globPattern argument", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: {
        globToolCall: { args: { globPattern: "**/*.ts" } },
      },
    } as ToolCallEvent;
    expect(extractToolArgs(event)).toBe("**/*.ts");
  });

  it("truncates long command arguments", () => {
    const longCmd = "a".repeat(50);
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: {
        shellToolCall: { args: { command: longCmd } },
      },
    } as ToolCallEvent;
    const result = extractToolArgs(event);
    expect(result.length).toBeLessThanOrEqual(43);
    expect(result).toContain("...");
  });

  it("does not truncate short commands", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: {
        shellToolCall: { args: { command: "ls -la" } },
      },
    } as ToolCallEvent;
    expect(extractToolArgs(event)).toBe("ls -la");
  });

  it("returns empty string when no args", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "1",
      tool_call: { readToolCall: {} },
    } as ToolCallEvent;
    expect(extractToolArgs(event)).toBe("");
  });
});

describe("extractToolResult", () => {
  it("extracts from result field", () => {
    const event = {
      type: "tool_call",
      subtype: "completed",
      call_id: "1",
      tool_call: {
        readToolCall: { result: "file contents here" },
      },
    } as ToolCallEvent;
    expect(extractToolResult(event)).toBe("file contents here");
  });

  it("extracts from output field", () => {
    const event = {
      type: "tool_call",
      subtype: "completed",
      call_id: "1",
      tool_call: {
        shellToolCall: { output: "command output" },
      },
    } as ToolCallEvent;
    expect(extractToolResult(event)).toBe("command output");
  });

  it("extracts from content array", () => {
    const event = {
      type: "tool_call",
      subtype: "completed",
      call_id: "1",
      tool_call: {
        readToolCall: {
          content: [
            { type: "text", text: "line 1" },
            { type: "text", text: "line 2" },
          ],
        },
      },
    } as ToolCallEvent;
    expect(extractToolResult(event)).toBe("line 1\nline 2");
  });

  it("truncates long results", () => {
    const longResult = "x".repeat(3000);
    const event = {
      type: "tool_call",
      subtype: "completed",
      call_id: "1",
      tool_call: { readToolCall: { result: longResult } },
    } as ToolCallEvent;
    const result = extractToolResult(event);
    expect(result.length).toBeLessThan(longResult.length);
    expect(result).toContain("truncated");
  });

  it("returns empty string when tool_call is missing", () => {
    const event = { type: "tool_call", subtype: "completed", call_id: "1" } as unknown as ToolCallEvent;
    expect(extractToolResult(event)).toBe("");
  });
});
