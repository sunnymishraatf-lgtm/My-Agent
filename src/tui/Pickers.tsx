import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { AgentConfig } from "../chat/agent-config";
import type { TuiMcpServer, TuiModel, TuiProvider, TuiSession } from "./types";
import { PALETTE_ACTIONS } from "./commands";
import { borderStyle, displayWidth, glyphs, padEnd, truncate } from "./utils";

export interface ListItem {
  key: string;
  label: string;
  hint?: string;
  color?: "green" | "red" | "yellow" | "cyan" | "white";
}

export function Overlay({ title, children, width, footer }: { title: string; children: ReactNode; width: number; footer?: string }) {
  return (
    <Box flexDirection="column" alignItems="center" width="100%">
      <Box flexDirection="column" borderStyle={borderStyle} borderColor="blue" paddingX={2} paddingY={1} width={width}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {title}
          </Text>
        </Box>
        {children}
        {footer ? (
          <Box marginTop={1}>
            <Text dimColor>{footer}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export function ListOverlay({
  title,
  items,
  selected,
  width,
  footer,
  emptyText = "Nothing here yet.",
  max = 14,
}: {
  title: string;
  items: ListItem[];
  selected: number;
  width: number;
  footer?: string;
  emptyText?: string;
  max?: number;
}) {
  const innerWidth = Math.max(20, width - 6);
  const view = items.slice(0, max);
  return (
    <Overlay title={title} width={Math.min(width, 68)} footer={footer}>
      {view.length === 0 ? (
        <Text dimColor>{emptyText}</Text>
      ) : (
        view.map((item, index) => {
          const isSelected = index === selected;
          const labelWidth = Math.min(28, Math.max(...view.map((v) => displayWidth(v.label)), 4) + 2);
          const row = `${padEnd(item.label, labelWidth)}${item.hint ? truncate(item.hint, Math.max(0, innerWidth - labelWidth)) : ""}`;
          return (
            <Text
              key={item.key}
              color={isSelected ? "white" : item.color ?? "white"}
              backgroundColor={isSelected ? "blue" : undefined}
            >
              {isSelected ? `${glyphs.arrow} ` : "  "}
              {padEnd(row, innerWidth)}
            </Text>
          );
        })
      )}
    </Overlay>
  );
}

export function agentItems(agents: AgentConfig[]): ListItem[] {
  return agents
    .filter((a) => !a.hidden)
    .map((agent) => ({
      key: agent.name,
      label: agent.name,
      hint: `[${agent.mode}] ${agent.description}`,
    }));
}

export function modelItems(models: TuiModel[]): ListItem[] {
  return models.map((model) => ({
    key: `${model.provider}:${model.id}`,
    label: `${model.id}${model.free ? " (FREE)" : ""}`,
    hint: model.provider,
    color: model.free ? "green" : "white",
  }));
}

export function providerItems(providers: TuiProvider[]): ListItem[] {
  return providers.map((provider) => ({
    key: provider.id,
    label: provider.label,
    hint: `${provider.models.length} model(s)`,
    color: provider.hasKey ? "white" : "yellow",
  }));
}

export function sessionItems(sessions: TuiSession[]): ListItem[] {
  return sessions.map((session) => ({
    key: session.id,
    label: session.title || "Untitled session",
    hint: `${session.messageCount} msg · ${session.updatedAt.slice(0, 10)}`,
  }));
}

export function mcpItems(servers: TuiMcpServer[]): ListItem[] {
  return servers.map((server) => ({
    key: server.name,
    label: `${server.enabled ? "[x]" : "[ ]"} ${server.name}`,
    hint: server.error ? `error: ${server.error}` : `${server.tools.length} tool(s)`,
    color: server.error ? "red" : server.enabled ? "green" : "yellow",
  }));
}

export function paletteItems(): ListItem[] {
  return PALETTE_ACTIONS.map((action) => ({ key: action.id, label: action.label, hint: action.keywords }));
}

export function TextView({ title, text, width, footer }: { title: string; text: string; width: number; footer?: string }) {
  return (
    <Overlay title={title} width={Math.min(width, 90)} footer={footer}>
      <Box flexDirection="column">
        {text.split("\n").map((line, i) => (
          <Text key={i}>{truncate(line, Math.min(width, 90) - 8)}</Text>
        ))}
      </Box>
    </Overlay>
  );
}

export function HelpView({ commands, width }: { commands: { name: string; description: string }[]; width: number }) {
  return (
    <Overlay title="Help" width={Math.min(width, 74)} footer="Esc to close">
      <Box flexDirection="column">
        {commands.map((cmd) => (
          <Text key={cmd.name}>
            <Text color="cyan">{padEnd(`/${cmd.name}`, 16)}</Text>
            <Text dimColor>{cmd.description}</Text>
          </Text>
        ))}
        <Box marginTop={1} flexDirection="column">
          <Text bold>Shortcuts</Text>
          <Text dimColor>tab agents ctrl+p commands ctrl+l models ctrl+r providers</Text>
          <Text dimColor>ctrl+k models ctrl+s sessions ctrl+n new shift+enter newline</Text>
          <Text dimColor>ctrl+u/ctrl+w edit ctrl+c cancel · providers: C configure R refresh</Text>
        </Box>
      </Box>
    </Overlay>
  );
}

export { ListOverlay as CommandPalette };
