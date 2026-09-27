import { getVersion } from "../src/version";
import { loadAgents } from "../src/chat/agent-config";
import { handleApiError, requireMethod, sendJson, type VercelRequest, type VercelResponse } from "./_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireMethod(req, res, "GET")) return;
  try {
    let agents: string[] = [];
    try {
      agents = loadAgents(process.cwd()).map((a) => a.name);
    } catch {
      /* agent list is best-effort on serverless */
    }
    sendJson(res, 200, { ok: true, version: getVersion(), agents, serverless: true });
  } catch (err) {
    handleApiError(res, err);
  }
}
