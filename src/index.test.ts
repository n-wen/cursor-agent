import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./runner.js", () => ({
  runCursorAgent: vi.fn().mockResolvedValue({
    success: true,
    resultText: "ok",
    durationMs: 1000,
    toolCallCount: 0,
    events: [],
  }),
}));

vi.mock("./process-registry.js", () => ({
  ensureShutdownHook: vi.fn(),
  setMaxConcurrent: vi.fn(),
}));

vi.mock("./tool.js", () => ({
  createCursorAgentTool: vi.fn(() => vi.fn(() => ({}))),
}));

import { parseCommandArgs, tokenize, resolveProjectPath } from "./index.js";
import plugin from "./index.js";
import { runCursorAgent } from "./runner.js";
import { ensureShutdownHook, setMaxConcurrent } from "./process-registry.js";
import { createCursorAgentTool } from "./tool.js";

// ──────────── tokenize ────────────

describe("tokenize", () => {
  it("splits by spaces", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"]);
  });

  it("collapses multiple spaces", () => {
    expect(tokenize("a   b  c")).toEqual(["a", "b", "c"]);
  });

  it("preserves spaces within double quotes", () => {
    expect(tokenize('project "hello world"')).toEqual(["project", "hello world"]);
  });

  it("preserves spaces within single quotes", () => {
    expect(tokenize("project 'hello world'")).toEqual(["project", "hello world"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("treats tab as delimiter", () => {
    expect(tokenize("a\tb")).toEqual(["a", "b"]);
  });

  it("strips quotes from result", () => {
    expect(tokenize('"quoted"')).toEqual(["quoted"]);
  });
});

// ──────────── parseCommandArgs ────────────

describe("parseCommandArgs", () => {
  it("basic format <project> <prompt>", () => {
    const result = parseCommandArgs("myapp analyze code");
    expect(result).toEqual({
      project: "myapp",
      prompt: "analyze code",
      mode: "agent",
      continueSession: false,
      resumeSessionId: undefined,
    });
  });

  it("empty string returns usage error", () => {
    const result = parseCommandArgs("");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Usage");
  });

  it("project only without prompt returns error", () => {
    const result = parseCommandArgs("myapp");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("prompt");
  });

  it("--mode ask", () => {
    const result = parseCommandArgs("myapp --mode ask what is this");
    expect(result).not.toHaveProperty("error");
    expect((result as any).mode).toBe("ask");
    expect((result as any).prompt).toBe("what is this");
  });

  it("--mode plan", () => {
    const result = parseCommandArgs("myapp --mode plan design caching");
    expect(result).not.toHaveProperty("error");
    expect((result as any).mode).toBe("plan");
  });

  it("--mode with invalid value returns error", () => {
    const result = parseCommandArgs("myapp --mode invalid do something");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Unsupported mode");
  });

  it("--mode without argument returns error", () => {
    const result = parseCommandArgs("myapp --mode");
    expect(result).toHaveProperty("error");
  });

  it("--continue", () => {
    const result = parseCommandArgs("myapp --continue continue the analysis");
    expect(result).not.toHaveProperty("error");
    expect((result as any).continueSession).toBe(true);
    expect((result as any).prompt).toBe("continue the analysis");
  });

  it("--resume <chatId>", () => {
    const result = parseCommandArgs("myapp --resume chat-123 add tests");
    expect(result).not.toHaveProperty("error");
    expect((result as any).resumeSessionId).toBe("chat-123");
    expect((result as any).prompt).toBe("add tests");
  });

  it("--resume without chatId returns error", () => {
    const result = parseCommandArgs("myapp --resume");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("chatId");
  });

  it("combined --mode + --continue", () => {
    const result = parseCommandArgs("myapp --mode ask --continue tell me more");
    expect(result).not.toHaveProperty("error");
    expect((result as any).mode).toBe("ask");
    expect((result as any).continueSession).toBe(true);
    expect((result as any).prompt).toBe("tell me more");
  });

  it("quoted prompt", () => {
    const result = parseCommandArgs('myapp "analyze the auth module"');
    expect(result).not.toHaveProperty("error");
    expect((result as any).prompt).toBe("analyze the auth module");
  });

  it("null / undefined input returns error", () => {
    expect(parseCommandArgs(null as any)).toHaveProperty("error");
    expect(parseCommandArgs(undefined as any)).toHaveProperty("error");
  });
});

// ──────────── resolveProjectPath ────────────

describe("resolveProjectPath", () => {
  const projects = { myapp: "/home/user/myapp", backend: "/home/user/backend" };

  it("exact match", () => {
    expect(resolveProjectPath("myapp", projects)).toBe("/home/user/myapp");
  });

  it("case-insensitive match", () => {
    expect(resolveProjectPath("MyApp", projects)).toBe("/home/user/myapp");
    expect(resolveProjectPath("BACKEND", projects)).toBe("/home/user/backend");
  });

  it("non-existent project name returns null", () => {
    expect(resolveProjectPath("nonexistent", projects)).toBeNull();
  });

  it("empty projects returns null (non-real path)", () => {
    expect(resolveProjectPath("anything", {})).toBeNull();
  });

  it("existsSync works for real paths", () => {
    // "/" always exists on macOS/Linux
    if (process.platform !== "win32") {
      expect(resolveProjectPath("/", {})).toBe("/");
    }
  });
});

// ──────────── plugin.register ────────────

describe("plugin.register", () => {
  let api: { registerCommand: ReturnType<typeof vi.fn>; registerTool: ReturnType<typeof vi.fn>; pluginConfig: any };

  beforeEach(() => {
    vi.clearAllMocks();
    api = {
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      pluginConfig: {
        agentPath: "/usr/local/bin/agent",
        projects: { myapp: "/home/user/myapp" },
      },
    };
  });

  it("registers /cursor command", () => {
    plugin.register(api);
    expect(api.registerCommand).toHaveBeenCalledWith(expect.objectContaining({
      name: "cursor",
      acceptsArgs: true,
      requireAuth: true,
    }));
  });

  it("enables ensureShutdownHook", () => {
    plugin.register(api);
    expect(ensureShutdownHook).toHaveBeenCalled();
  });

  it("sets maxConcurrent", () => {
    api.pluginConfig.maxConcurrent = 5;
    plugin.register(api);
    expect(setMaxConcurrent).toHaveBeenCalledWith(5);
  });

  it("registers Agent Tool by default", () => {
    plugin.register(api);
    expect(api.registerTool).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ name: "cursor_agent", optional: true }),
    );
  });

  it("does not register Agent Tool when enableAgentTool=false", () => {
    api.pluginConfig.enableAgentTool = false;
    plugin.register(api);
    expect(api.registerTool).not.toHaveBeenCalled();
  });

  it("does not register Agent Tool with no projects", () => {
    api.pluginConfig.projects = {};
    plugin.register(api);
    expect(api.registerTool).not.toHaveBeenCalled();
  });

  it("does not register when agentPath not configured and detection fails", () => {
    api.pluginConfig.agentPath = undefined;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const apiNoAgent = { ...api, pluginConfig: { projects: { a: "/tmp" } } };
    plugin.register(apiNoAgent);
    warnSpy.mockRestore();
  });

  describe("command handler", () => {
    it("parses and executes command", async () => {
      plugin.register(api);
      const handler = api.registerCommand.mock.calls[0]![0].handler;

      const result = await handler({ args: "myapp analyze code" });
      expect(runCursorAgent).toHaveBeenCalledWith(expect.objectContaining({
        projectPath: "/home/user/myapp",
        prompt: "analyze code",
        mode: "agent",
      }));
      expect(result.text).toBeTruthy();
    });

    it("returns usage on no arguments", async () => {
      plugin.register(api);
      const handler = api.registerCommand.mock.calls[0]![0].handler;
      const result = await handler({ args: "" });
      expect(result.text).toContain("Usage");
    });

    it("returns error for non-existent project", async () => {
      plugin.register(api);
      const handler = api.registerCommand.mock.calls[0]![0].handler;
      const result = await handler({ args: "nonexistent do something" });
      expect(result.text).toContain("Project not found");
    });
  });
});
