import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

/**
 * process-registry uses module-level state (Map, variables).
 * Each test needs isolation via vi.resetModules() + dynamic import.
 */
async function loadFreshRegistry() {
  vi.resetModules();
  return await import("./process-registry.js");
}

/** Create a mock ChildProcess */
function createMockProc(pid = 1234): any {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    pid,
    exitCode: null as number | null,
    killed: false,
    kill: vi.fn(),
    stdout: null,
    stderr: null,
    stdin: null,
    stdio: [],
    connected: false,
    disconnect: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
    send: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  });
}

describe("process-registry", () => {
  describe("register / unregister / getActiveCount", () => {
    it("count increases after register, restores after unregister", async () => {
      const reg = await loadFreshRegistry();
      expect(reg.getActiveCount()).toBe(0);

      const proc = createMockProc();
      reg.register("run-1", { proc, projectPath: "/tmp/p", startTime: Date.now() });
      expect(reg.getActiveCount()).toBe(1);

      reg.register("run-2", { proc: createMockProc(5678), projectPath: "/tmp/q", startTime: Date.now() });
      expect(reg.getActiveCount()).toBe(2);

      reg.unregister("run-1");
      expect(reg.getActiveCount()).toBe(1);

      reg.unregister("run-2");
      expect(reg.getActiveCount()).toBe(0);
    });

    it("duplicate unregister does not throw", async () => {
      const reg = await loadFreshRegistry();
      reg.unregister("nonexistent");
      expect(reg.getActiveCount()).toBe(0);
    });
  });

  describe("isFull / setMaxConcurrent", () => {
    it("default concurrency limit is 3", async () => {
      const reg = await loadFreshRegistry();
      for (let i = 0; i < 3; i++) {
        reg.register(`run-${i}`, { proc: createMockProc(i + 100), projectPath: "/tmp", startTime: Date.now() });
      }
      expect(reg.isFull()).toBe(true);
    });

    it("setMaxConcurrent adjusts the limit", async () => {
      const reg = await loadFreshRegistry();
      reg.setMaxConcurrent(1);
      reg.register("run-1", { proc: createMockProc(), projectPath: "/tmp", startTime: Date.now() });
      expect(reg.isFull()).toBe(true);
    });

    it("setMaxConcurrent minimum is 1", async () => {
      const reg = await loadFreshRegistry();
      reg.setMaxConcurrent(0);
      reg.register("run-1", { proc: createMockProc(), projectPath: "/tmp", startTime: Date.now() });
      expect(reg.isFull()).toBe(true);
    });

    it("isFull returns false when not full", async () => {
      const reg = await loadFreshRegistry();
      reg.setMaxConcurrent(5);
      reg.register("run-1", { proc: createMockProc(), projectPath: "/tmp", startTime: Date.now() });
      expect(reg.isFull()).toBe(false);
    });
  });

  describe("gracefulKill", () => {
    it("does not throw when pid is undefined", async () => {
      const reg = await loadFreshRegistry();
      const proc = createMockProc();
      proc.pid = undefined;
      expect(() => reg.gracefulKill(proc)).not.toThrow();
    });

    it("sends SIGTERM to process group on Unix", async () => {
      const reg = await loadFreshRegistry();
      const proc = createMockProc(9999);
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        reg.gracefulKill(proc);
        expect(killSpy).toHaveBeenCalledWith(-9999, "SIGTERM");
      } finally {
        killSpy.mockRestore();
      }
    });

    it("falls back to proc.kill when process.kill fails", async () => {
      const reg = await loadFreshRegistry();
      const proc = createMockProc(9999);
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("no such process"); });
      try {
        reg.gracefulKill(proc);
        expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  describe("forceKill", () => {
    it("sends SIGKILL to process group on Unix", async () => {
      const reg = await loadFreshRegistry();
      const proc = createMockProc(8888);
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        reg.forceKill(proc);
        expect(killSpy).toHaveBeenCalledWith(-8888, "SIGKILL");
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  describe("killWithGrace", () => {
    it("sends SIGTERM first then SIGKILL after delay", async () => {
      vi.useFakeTimers();
      try {
        const reg = await loadFreshRegistry();
        const proc = createMockProc(7777);
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

        reg.killWithGrace(proc);
        expect(killSpy).toHaveBeenCalledWith(-7777, "SIGTERM");

        killSpy.mockClear();
        vi.advanceTimersByTime(5000);
        expect(killSpy).toHaveBeenCalledWith(-7777, "SIGKILL");

        killSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not send SIGKILL if process already exited", async () => {
      vi.useFakeTimers();
      try {
        const reg = await loadFreshRegistry();
        const proc = createMockProc(6666);
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

        reg.killWithGrace(proc);
        killSpy.mockClear();

        proc.exitCode = 0;
        vi.advanceTimersByTime(5000);
        expect(killSpy).not.toHaveBeenCalled();

        killSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
