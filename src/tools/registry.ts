import type { Tool, ToolContext, ToolResult } from "./types";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) this.tools.set(tool.name, tool);
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: `Unknown tool: ${name}. Available tools: ${this.names().join(", ")}` };
    }
    try {
      return await tool.execute(args ?? {}, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, output: `Tool ${name} failed: ${message}` };
    }
  }
}
