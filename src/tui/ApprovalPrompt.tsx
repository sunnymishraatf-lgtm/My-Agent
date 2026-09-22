import { Box, Text } from "ink";
import { redact } from "../config";
import type { TuiApproval } from "./types";
import { borderStyle, truncate } from "./utils";

export interface ApprovalPromptProps {
  approval: TuiApproval;
  width: number;
  onApprove: () => void;
  onDeny: () => void;
  onApproveSession: () => void;
}

export function ApprovalPrompt({ approval, width, onApprove, onDeny, onApproveSession }: ApprovalPromptProps) {
  const inner = Math.max(30, Math.min(width - 8, 80));
  const isShell = approval.tool === "shell" || !!approval.command;
  return (
    <Box flexDirection="column" alignItems="center" width="100%">
      <Box flexDirection="column" borderStyle={borderStyle} borderColor="yellow" paddingX={2} paddingY={1} width={inner}>
        <Text bold color="yellow">
          Permission required
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{isShell ? "Run command?" : `Run tool "${approval.tool}"?`}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="white" bold>
            {truncate(redact(approval.command ?? approval.reason), inner - 4)}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Reason: {approval.reason}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="green" bold>
            [Y]
          </Text>
          <Text> Allow </Text>
          <Text color="red" bold>
            [N]
          </Text>
          <Text> Deny </Text>
          <Text color="cyan" bold>
            [A]
          </Text>
          <Text> Allow for session</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Approve or deny this action to continue.</Text>
      </Box>
    </Box>
  );
}

export { ApprovalPrompt as default };
