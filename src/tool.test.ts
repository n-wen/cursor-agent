import { describe, it, expect, vi, beforeEach } from "vitest";

const { runCursorAgentMock } = vi.hoisted(() => ({
  runCursorAgentMock: vi.fn(),
}));

vi.mock("./runner.js", () => ({
  runCursorAgent: runCursorAgentMock,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((p: string) => p === "/real/path"),
}));

import { createCursorAgentTool } from "./tool.js";
import type { RunResult } from "./types.js";

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    success: true,
    resultText: "Analysis completed",
    sessionId: "sess-abc",
    durationMs: 3000,
    toolCallCount: 2,
    events: [
      { type: "assistant", text: "Result text", timestamp: 1 },
    ],
    ...overrides,
  };
}

describe("createCursorAgentTool", () => {
  const projects = { myapp: "/home/user/myapp", backend: "/home/user/backend" };
  const cfg = { defaultTimeoutSec: 300, noOutputTimeoutSec: 60, enableMcp: true };
  const agentPath = "/usr/local/bin/agent";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("factory function returns correct tool definition", () => {
    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    expect(tool.name).toBe("cursor_agent");
    expect(tool.label).toBe("Cursor Agent");
    expect(tool.description).toContain("myapp");
    expect(tool.description).toContain("backend");
    expect(tool.description).toContain("MUST NOT summarize");
    expect(tool.parameters.required).toEqual(["project", "prompt"]);
  });

  it("returns error when project is missing", async () => {
    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    const result = await tool.execute("call-1", { prompt: "test" });
    expect(result.content[0]!.text).toContain("Missing required parameters");
  });

  it("returns error when prompt is missing", async () => {
    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    const result = await tool.execute("call-1", { project: "myapp" });
    expect(result.content[0]!.text).toContain("Missing required parameters");
  });

  it("returns error for non-existent project", async () => {
    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    const result = await tool.execute("call-1", { project: "nonexistent", prompt: "test" });
    expect(result.content[0]!.text).toContain("Project not found");
    expect(result.content[0]!.text).toContain("myapp");
  });

  it("matches project name exactly and invokes runner", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    const result = await tool.execute("call-1", { project: "myapp", prompt: "analyze code" });

    expect(runCursorAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      agentPath,
      projectPath: "/home/user/myapp",
      prompt: "analyze code",
      mode: "ask",
    }));
    expect(result.details?.success).toBe(true);
    expect(result.details?.sentDirectly).toBe(false);
  });

  it("matches project name case-insensitively", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    await tool.execute("call-1", { project: "MyApp", prompt: "test" });

    expect(runCursorAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: "/home/user/myapp",
    }));
  });

  it("falls back to absolute path matching", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    await tool.execute("call-1", { project: "/real/path", prompt: "test" });

    expect(runCursorAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: "/real/path",
    }));
  });

  it("defaults to ask mode", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    await tool.execute("call-1", { project: "myapp", prompt: "test" });

    expect(runCursorAgentMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "ask" }));
  });

  it("uses specified agent mode", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    await tool.execute("call-1", { project: "myapp", prompt: "test", mode: "agent" });

    expect(runCursorAgentMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "agent" }));
  });

  it("tool result includes DO_NOT_SUMMARIZE directive", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    const result = await tool.execute("call-1", { project: "myapp", prompt: "test" });

    const text = result.content[0]!.text;
    expect(text).toContain("CRITICAL INSTRUCTION");
    expect(text).toContain("MUST NOT summarize");
    expect(text).toContain("MUST NOT add your own analysis");
  });

  it("passes AbortSignal", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());
    const ac = new AbortController();

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    await tool.execute("call-1", { project: "myapp", prompt: "test" }, ac.signal);

    expect(runCursorAgentMock).toHaveBeenCalledWith(expect.objectContaining({ signal: ac.signal }));
  });

  it("uses timeout settings from config", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult());

    const factory = createCursorAgentTool({
      agentPath,
      projects,
      cfg: { defaultTimeoutSec: 999, noOutputTimeoutSec: 88, enableMcp: false, model: "test-model" },
    });
    const tool = factory({});
    await tool.execute("call-1", { project: "myapp", prompt: "test" });

    expect(runCursorAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      timeoutSec: 999,
      noOutputTimeoutSec: 88,
      enableMcp: false,
      model: "test-model",
    }));
  });

  describe("sendMessage path", () => {
    it("uses direct delivery when sendMessage is available", async () => {
      runCursorAgentMock.mockResolvedValue(makeRunResult());
      const sendMessage = vi.fn().mockResolvedValue(undefined);

      const factory = createCursorAgentTool({ agentPath, projects, cfg, sendMessage });
      const tool = factory({ sessionKey: "sk-123", messageChannel: "telegram" });
      const result = await tool.execute("call-1", { project: "myapp", prompt: "test" });

      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        sessionKey: "sk-123",
        channel: "telegram",
      }));
      expect(result.details?.sentDirectly).toBe(true);
      expect(result.content[0]!.text).toContain("ALREADY delivered");
    });

    it("falls back to tool result when sendMessage fails", async () => {
      runCursorAgentMock.mockResolvedValue(makeRunResult());
      const sendMessage = vi.fn().mockRejectedValue(new Error("send failed"));

      const factory = createCursorAgentTool({ agentPath, projects, cfg, sendMessage });
      const tool = factory({ sessionKey: "sk-123", messageChannel: "telegram" });
      const result = await tool.execute("call-1", { project: "myapp", prompt: "test" });

      expect(result.details?.sentDirectly).toBe(false);
      expect(result.content[0]!.text).toContain("CRITICAL INSTRUCTION");
    });

    it("does not call sendMessage when sessionKey is missing", async () => {
      runCursorAgentMock.mockResolvedValue(makeRunResult());
      const sendMessage = vi.fn();

      const factory = createCursorAgentTool({ agentPath, projects, cfg, sendMessage });
      const tool = factory({ messageChannel: "telegram" });
      const result = await tool.execute("call-1", { project: "myapp", prompt: "test" });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(result.details?.sentDirectly).toBe(false);
    });
  });

  it("details include modifiedFiles", async () => {
    runCursorAgentMock.mockResolvedValue(makeRunResult({
      events: [
        { type: "tool_start", toolName: "editFile", toolArgs: "main.ts", timestamp: 1 },
        { type: "tool_start", toolName: "writeFile", toolArgs: "config.ts", timestamp: 2 },
      ],
    }));

    const factory = createCursorAgentTool({ agentPath, projects, cfg });
    const tool = factory({});
    const result = await tool.execute("call-1", { project: "myapp", prompt: "test" });

    expect(result.details?.modifiedFiles).toEqual(["main.ts", "config.ts"]);
  });
});
