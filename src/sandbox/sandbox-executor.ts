import type { ToolCall, ToolResult } from '../llm/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext, ContainerExecResult } from '../tools/types.js';
import { createDockerExec, type DockerExecFn, type DockerExecResult } from './docker-cli.js';

export interface SandboxExecutorConfig {
  image: string;
  timeoutMs: number;
  memoryLimit: string;
  cpuLimit: string;
}

/** A tool result annotated with the tool name that produced it. */
export interface ToolObservation extends ToolResult {
  name: string;
}

/**
 * Interface the orchestrator depends on. The sandbox executor creates an
 * ephemeral container, runs all tool calls sequentially inside it, and tears
 * it down in a `finally` block — fresh sandbox per act step.
 */
export interface SandboxExecutor {
  execute(toolCalls: ToolCall[], registry: ToolRegistry): Promise<ToolObservation[]>;
}

export class DockerSandboxExecutor implements SandboxExecutor {
  private readonly dockerExec: DockerExecFn;
  private readonly config: SandboxExecutorConfig;
  private readonly extraContext: Partial<ToolContext>;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /**
   * `extraContext` is merged into every per-call `ToolContext` alongside
   * `execInContainer`, so tools that need to start nested loops (e.g.
   * `spawn_subagent`) get `callLlm`/`runLoop`/`toolRegistry`/etc. Tools that
   * only use `execInContainer` are unaffected by its presence.
   */
  constructor(
    config: SandboxExecutorConfig,
    dockerExec: DockerExecFn = createDockerExec(),
    extraContext: Partial<ToolContext> = {},
  ) {
    this.config = config;
    this.dockerExec = dockerExec;
    this.extraContext = extraContext;
  }

  async createSandbox(): Promise<string> {
    const args = [
      'run', '-d', '--rm',
      '--read-only',
      '--network', 'none',
      '--memory', this.config.memoryLimit,
      '--cpus', this.config.cpuLimit,
      '--tmpfs', '/work:rw,size=64m',
      '-w', '/work',
      '--entrypoint', 'sleep',
      this.config.image,
      'infinity',
    ];

    const result = await this.dockerExec(args, { timeoutMs: this.config.timeoutMs });
    const containerId = result.stdout.trim();

    if (!containerId) {
      throw new Error(`Failed to create sandbox: ${result.stderr || 'no container ID returned'}`);
    }

    this.startAutoKillTimer(containerId);
    return containerId;
  }

  async execInContainer(containerId: string, command: string, stdin?: string): Promise<ContainerExecResult> {
    const perToolTimeoutSec = Math.ceil(this.config.timeoutMs / 1000);
    const args = ['exec'];
    if (stdin !== undefined) {
      args.push('-i');
    }
    args.push(containerId, 'timeout', String(perToolTimeoutSec), 'sh', '-c', command);

    const result: DockerExecResult = await this.dockerExec(args, { stdin });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  }

  async removeSandbox(containerId: string): Promise<void> {
    this.clearAutoKillTimer(containerId);
    await this.dockerExec(['stop', '-t', '0', containerId], { timeoutMs: 5000 });
  }

  async execute(toolCalls: ToolCall[], registry: ToolRegistry): Promise<ToolObservation[]> {
    const containerId = await this.createSandbox();
    try {
      const context: ToolContext = {
        ...this.extraContext,
        execInContainer: (command: string, stdin?: string) =>
          this.execInContainer(containerId, command, stdin),
      };

      const observations: ToolObservation[] = [];
      for (const call of toolCalls) {
        try {
          const tool = registry.getTool(call.name);
          const result = await tool.execute(context, call.arguments);
          observations.push({ ...result, name: call.name });
        } catch (error) {
          observations.push({
            name: call.name,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return observations;
    } finally {
      await this.removeSandbox(containerId);
    }
  }

  private startAutoKillTimer(containerId: string): void {
    const timer = setTimeout(() => {
      void this.dockerExec(['stop', '-t', '0', containerId], { timeoutMs: 5000 });
      this.timers.delete(containerId);
    }, this.config.timeoutMs);
    this.timers.set(containerId, timer);
  }

  private clearAutoKillTimer(containerId: string): void {
    const timer = this.timers.get(containerId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(containerId);
    }
  }
}
