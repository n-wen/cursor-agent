# Cursor Agent — OpenClaw 插件

[English](README.md) | 中文

通过 OpenClaw 聊天对话中的 `/cursor` 命令，直接调用本机 Cursor Agent CLI 对项目进行代码分析、排查和修改。结果原样返回，不经过 LLM 二次总结。同时支持作为 PI Agent Tool 注册，在用户未使用命令时自动调用。

## 核心能力

- 通过 `/cursor` 命令直接调用，结果原样返回（绕过 LLM agent）
- 作为可选 Agent Tool 注册，PI Agent 可在对话中自动调用（兜底机制）
- 自动加载项目的 `.cursor/rules`、`AGENTS.md` 等上下文
- 支持启用项目配置的 MCP 服务器（GitLab、数据库、监控等）
- 三种运行模式：`agent`（默认，可修改文件）、`ask`（只读分析）、`plan`（出方案）
- 会话管理：支持继续/恢复历史会话
- 多项目映射表，按名称快速切换分析目标
- 完善的子进程管理：独立进程组、两阶段优雅终止、并发控制、Gateway 退出清理
- 长内容自动拆分为多条消息

## 前置要求

| 依赖 | 说明 |
|------|------|
| Cursor Agent CLI | 需在本机安装 `agent` 命令（见下方安装步骤） |
| Cursor 订阅 | CLI 使用 Cursor 订阅中的模型额度 |
| OpenClaw Gateway | v2026.2.24+ |

## 安装 Cursor Agent CLI

### Linux / macOS

```bash
curl https://cursor.com/install -fsSL | bash
```

安装完成后，可能需要将 `$HOME/.local/bin` 加入 PATH：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Windows

在 PowerShell 中运行：

```powershell
irm https://cursor.com/install | iex
```

安装后默认路径为 `%LOCALAPPDATA%\cursor-agent\agent.cmd`。

### 验证安装

```bash
agent --version
```

### 认证登录

首次使用需要登录 Cursor 账号：

```bash
agent login
```

或通过环境变量设置 API Key：

```bash
export CURSOR_API_KEY="your-api-key"
```

## 安装插件

### 方式一：源码路径加载（开发模式）

在 `~/.openclaw/openclaw.json` 的 `plugins.load.paths` 中添加插件源码路径：

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/cursor-agent"]
    }
  }
}
```

### 方式二：tgz 包安装

```bash
# 构建打包
cd plugins/cursor-agent
npm ci && npm run build && npm pack

# 通过 OpenClaw CLI 安装
openclaw plugin install cursor-agent-0.1.0.tgz
```

## 配置

在 `~/.openclaw/openclaw.json` 中配置插件：

```json
{
  "plugins": {
    "entries": {
      "cursor-agent": {
        "enabled": true,
        "config": {
          "projects": {
            "my-project": "/home/user/projects/my-project",
            "another-project": "/home/user/projects/another"
          },
          "defaultTimeoutSec": 600,
          "noOutputTimeoutSec": 120,
          "enableMcp": true,
          "maxConcurrent": 3,
          "enableAgentTool": true
        }
      }
    }
  }
}
```

### 配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `projects` | `object` | `{}` | 项目名称到本地绝对路径的映射表 |
| `agentPath` | `string` | 自动检测 | Cursor Agent CLI 的完整路径 |
| `defaultTimeoutSec` | `number` | `600` | 单次调用最大执行时间（秒） |
| `noOutputTimeoutSec` | `number` | `120` | 无输出超时（秒），连续无输出超过此时间判定挂死 |
| `model` | `string` | CLI 默认 | 指定 Cursor Agent 使用的模型 |
| `enableMcp` | `boolean` | `true` | 是否启用 MCP 服务器（`--approve-mcps`） |
| `maxConcurrent` | `number` | `3` | 最大并发 Cursor CLI 进程数 |
| `enableAgentTool` | `boolean` | `true` | 是否注册 Agent Tool 供 PI Agent 自动调用 |

## 使用

配置完成并重启 Gateway 后，在 OpenClaw 对话中使用 `/cursor` 命令：

### 基本用法

```
/cursor my-project 分析认证模块的实现，找出潜在的安全问题
```

### 指定模式

```
/cursor my-project --mode ask 解释一下 src/auth 目录的架构设计
/cursor my-project --mode plan 设计一个新的缓存层方案
```

### 会话管理

```
# 继续上一次会话
/cursor my-project --continue 还有其他安全问题吗？

# 恢复指定会话（会话 ID 在每次执行结果的 footer 中显示）
/cursor my-project --resume abc123 在这个基础上添加单元测试
```

### 查看历史对话

每次执行结果的 footer 会显示会话 ID（如 `💬 97fe5ea8-...`），可通过 `--resume` 继续该对话。

如需在终端中查看完整的历史对话列表，可直接使用 Cursor Agent CLI：

```bash
# 在项目目录下查看历史会话
cd /path/to/project
agent ls

# 交互式恢复某个会话
agent resume
# 或指定会话 ID
agent --resume <chatId>
```

更多用法请参考 [Cursor Agent CLI 文档](https://cursor.com/cn/docs/cli/using)。

### 命令格式

```
/cursor <project> [options] <prompt>
```

| 参数 | 说明 |
|------|------|
| `<project>` | 项目名称（映射表中的 key）或绝对路径 |
| `<prompt>` | 分析任务的详细描述 |
| `--mode <mode>` | 运行模式：`agent`（默认）/ `ask` / `plan` |
| `--continue` | 继续上一次会话 |
| `--resume <chatId>` | 恢复指定会话 |

## 开发

```bash
cd plugins/cursor-agent

# 安装依赖
npm install

# 开发模式（watch）
npm run dev

# 构建
npm run build

# 打包
npm pack
```

## Agent Tool（兜底调用）

除了 `/cursor` 命令外，插件还可以注册一个 `cursor_agent` Agent Tool，使 PI Agent 在对话中自动调用 Cursor CLI。

### 工作方式

当用户在对话中提到项目代码分析需求但未使用 `/cursor` 命令时，PI Agent 可自动调用 `cursor_agent` 工具。

### 启用方式

1. 确保 `enableAgentTool` 为 `true`（默认）
2. 在 OpenClaw 配置的 `tools.allow` 中添加 `cursor_agent` 或 `group:plugins`

### 与 /cursor 命令的区别

| 特性 | `/cursor` 命令 | Agent Tool |
|------|---------------|------------|
| 触发方式 | 用户显式输入 | PI Agent 自动判断 |
| 结果处理 | 直接返回，不经 LLM | 作为 tool result 返回 |
| 默认模式 | `agent`（可修改文件） | `ask`（只读分析） |
| 会话管理 | 支持 --continue/--resume | 不支持 |

## 架构

```
src/
├── index.ts              # 插件入口，注册 /cursor 命令 + cursor_agent 工具
├── types.ts              # 类型定义（配置、事件、命令解析结果）
├── parser.ts             # Cursor Agent stream-json 输出解析
├── runner.ts             # CLI 进程管理、超时控制、事件流收集
├── formatter.ts          # 事件流格式化为 Markdown 输出
├── process-registry.ts   # 全局进程注册表、并发控制、Gateway 退出清理
└── tool.ts               # Agent Tool 工厂函数
```

### 两条调用路径

```
用户消息
  ├─ /cursor 命令 ──→ registerCommand handler ──→ runCursorAgent ──→ 结果直接返回用户
  └─ 普通对话 ──→ PI Agent ──→ cursor_agent tool ──→ runCursorAgent ──→ tool result
```

### 子进程管理

- Unix 上使用 `detached: true` 创建独立进程组，避免信号误杀 Gateway
- 两阶段终止：先 SIGTERM（优雅退出）→ 5 秒后 SIGKILL（强制终止）
- 全局进程注册表追踪所有活跃进程，支持并发限制
- Gateway 退出时自动清理所有子进程

## 许可证

[Apache-2.0](LICENSE)
