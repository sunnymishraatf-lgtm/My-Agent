import type { Agent } from "./agent";
import { RequirementsAgent } from "./requirements";
import { DesignAgent } from "./design-agent";
import { FrontendAgent } from "./frontend";
import { BackendAgent } from "./backend";
import { DatabaseAgent } from "./database";
import { SecurityAgent } from "./security";
import { DevOpsAgent } from "./devops";
import { QAAgent } from "./qa";
import { ReviewerAgent } from "./reviewer";
import { ManagerAgent } from "./manager";
import type { Task } from "../scheduler/task";

export function createAgentRegistry(): Agent[] {
  return [
    new ManagerAgent(),
    new RequirementsAgent(),
    new DesignAgent(),
    new FrontendAgent(),
    new BackendAgent(),
    new DatabaseAgent(),
    new SecurityAgent(),
    new DevOpsAgent(),
    new QAAgent(),
    new ReviewerAgent(),
  ];
}

export function findAgentForTask(agents: Agent[], task: Task): Agent | undefined {
  const direct = agents.find((a) => a.canHandle(task));
  if (direct) return direct;
  const roleMatch = agents.find((a) => a.role === task.agent);
  if (roleMatch) return roleMatch;
  return undefined;
}

export {
  RequirementsAgent,
  DesignAgent,
  FrontendAgent,
  BackendAgent,
  DatabaseAgent,
  SecurityAgent,
  DevOpsAgent,
  QAAgent,
  ReviewerAgent,
  ManagerAgent,
};