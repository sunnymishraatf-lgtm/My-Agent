import { listWorkspaceRepos } from "../../src/server/demo";
import { handleApiError, newDemoManager, requireMethod, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "../_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "GET")) return;
  try {
    const manager = newDemoManager();
    sendJson(res, 200, { ok: true, repos: listWorkspaceRepos(manager.workspace) });
  } catch (err) {
    handleApiError(res, err);
  }
}
