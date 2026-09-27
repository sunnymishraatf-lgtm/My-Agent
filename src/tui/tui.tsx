import { Box, Text } from "ink";
import { render } from "ink";
import { createElement } from "react";
import type { ComponentType } from "react";

export interface UiAppProps {
  running: boolean;
  statusLine: string;
  currentTask?: string;
  progress?: number;
  activeRequests?: number;
  queue?: number;
  provider?: string;
  model?: string;
  agentStates?: Record<string, string>;
}

export interface TuiController {
  update: (patch: Partial<UiAppProps>) => void;
  destroy: () => void;
}

function OrchestratorApp(props: UiAppProps) {
  const icon = (name: string) => {
    const lookup: Record<string, string> = {
      manager: "Manager", requirements: "Requirements", design: "Design",
      frontend: "Frontend", backend: "Backend", database: "Database",
      security: "Security", devops: "DevOps", qa: "QA", reviewer: "Reviewer",
    };
    return lookup[name] ?? name;
  };
  return (
    <Box flexDirection="column">
      <Box marginBottom={1} borderStyle="round" borderColor="green" paddingX={2}>
        <Text bold color="green">{" NEUTRON — Autonomous Software Maintenance Intelligence "}</Text>
        <Text color={props.running ? "green" : "gray"}>{props.running ? "● WORKING" : "○ IDLE"}</Text>
      </Box>
      <Text dimColor>{props.statusLine}</Text>
      <Box marginTop={1}><Text>{props.statusLine}</Text></Box>
      {props.currentTask ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Current task</Text>
          <Text>{props.currentTask}</Text>
        </Box>
      ) : null}
      {typeof props.progress === "number" ? <Box marginTop={1}><Text>Progress: {props.progress}%</Text></Box> : null}
      {props.activeRequests !== undefined ? (
        <Box marginTop={1}><Text dimColor>API: {props.activeRequests} active, {props.queue ?? 0} queued</Text></Box>
      ) : null}
      {props.agentStates ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Agents</Text>
          {Object.entries(props.agentStates).map(([agent, status]) => (
            <Text key={agent}>{status === "completed" ? "✅" : status === "running" ? "▶" : "○"} {icon(agent)}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export async function startTui(initial: UiAppProps): Promise<TuiController | null> {
  try {
    const props: UiAppProps = { ...initial };
    const element = render(createElement(OrchestratorApp, props as never));
    return {
      update: (patch: Partial<UiAppProps>) => {
        Object.assign(props, patch);
        element.rerender?.(createElement(OrchestratorApp, props as never));
      },
      destroy: () => { element.unmount(); },
    };
  } catch {
    return null;
  }
}