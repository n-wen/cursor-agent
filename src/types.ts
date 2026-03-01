/** Plugin configuration */
export interface CursorAgentConfig {
  agentPath?: string;
  defaultTimeoutSec?: number;
  noOutputTimeoutSec?: number;
  model?: string;
  enableMcp?: boolean;
  projects?: Record<string, string>;
  /** Maximum concurrent CLI processes, default 3 */
  maxConcurrent?: number;
  /** Whether to register Agent Tool for PI Agent auto-invocation, default true */
  enableAgentTool?: boolean;
}

/** Base type for stream-json events */
export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model_call_id?: string;
  timestamp_ms?: number;
}

/** system init event */
export interface SystemInitEvent extends StreamEvent {
  type: "system";
  subtype: "init";
  model: string;
  cwd: string;
  session_id: string;
}

/** assistant message event */
export interface AssistantEvent extends StreamEvent {
  type: "assistant";
  message: {
    role: "assistant";
    content: Array<{ type: "text"; text: string }>;
  };
}

/** tool_call event */
export interface ToolCallEvent extends StreamEvent {
  type: "tool_call";
  subtype: "started" | "completed";
  call_id: string;
  tool_call: Record<string, unknown>;
}

/** result event */
export interface ResultEvent extends StreamEvent {
  type: "result";
  subtype: "success" | "error";
  result: string;
  duration_ms: number;
  is_error: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/** user event */
export interface UserEvent extends StreamEvent {
  type: "user";
  message: {
    role: "user";
    content: Array<{ type: "text"; text: string }>;
  };
}

export type CursorStreamEvent =
  | SystemInitEvent
  | AssistantEvent
  | ToolCallEvent
  | ResultEvent
  | UserEvent
  | StreamEvent;

/** Collected event record for formatting output */
export interface CollectedEvent {
  type: "assistant" | "tool_start" | "tool_end" | "result" | "user";
  timestamp?: number;
  /** Text content from assistant / user */
  text?: string;
  /** Tool name */
  toolName?: string;
  /** Tool argument summary */
  toolArgs?: string;
  /** Result text from tool_call completed */
  toolResult?: string;
  /** Full data from result event */
  resultData?: ResultEvent;
}

/** Runner execution options */
export interface RunOptions {
  agentPath: string;
  projectPath: string;
  prompt: string;
  mode: "agent" | "ask" | "plan";
  timeoutSec: number;
  noOutputTimeoutSec: number;
  enableMcp: boolean;
  model?: string;
  signal?: AbortSignal;
  /** Continue previous session */
  continueSession?: boolean;
  /** Resume a specific session */
  resumeSessionId?: string;
  /** Run identifier for the process registry */
  runId?: string;
}

/** Runner execution result */
export interface RunResult {
  success: boolean;
  /** Assembled full conversation content */
  resultText: string;
  sessionId?: string;
  durationMs: number;
  toolCallCount: number;
  error?: string;
  usage?: ResultEvent["usage"];
  /** Full collected event stream */
  events: CollectedEvent[];
}

/** /cursor command parse result */
export interface ParsedCommand {
  project: string;
  prompt: string;
  mode: "agent" | "ask" | "plan";
  continueSession?: boolean;
  resumeSessionId?: string;
}
