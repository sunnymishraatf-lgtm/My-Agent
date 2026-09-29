import { cloneRepo, listWorkspaceRepos } from "../../src/server/demo";
import { handleApiError, newDemoManager, readJsonBody, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "../_lib";

// Workspace repositories endpoint (single Vercel function — the Hobby plan
// allows at most 12 serverless functions per deployment, so list + clone
// share this file instead of living in api/demo/repos.js + api/demo/clone.js).
//   GET  /api/demo/repos -> { ok, repos[] }
//   POST /api/demo/repos -> { ok, repository, isDemo }  (clone; body: { url })
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  try {
    const manager = newDemoManager();
    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, repos: listWorkspaceRepos(manager.workspace) });
      return;
    }
    if (req.method === "POST") {
      const body = readJsonBody(req);
      if (typeof body.url !== "string" || !body.url.trim()) {
        sendJson(res, 400, { ok: false, error: "url is required" });
        return;
      }
      // Disabled unless NEUTRON_DEMO_ALLOW_CLONE=1 (do not set it on Vercel:
      // git clones can exceed serverless timeouts). cloneRepo rejects honestly.
      const repo = await cloneRepo(manager.workspace, body.url);
      sendJson(res, 200, { ok: true, repository: repo.name, isDemo: repo.isDemo });
      return;
    }
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    handleApiError(res, err);
  }
}
