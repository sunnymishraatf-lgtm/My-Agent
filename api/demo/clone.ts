import { cloneRepo } from "../../src/server/demo";
import { handleApiError, newDemoManager, readJsonBody, requireMethod, sendJson, type VercelRequest, type VercelResponse } from "../_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireMethod(req, res, "POST")) return;
  try {
    const body = readJsonBody(req);
    if (typeof body.url !== "string" || !body.url.trim()) {
      sendJson(res, 400, { ok: false, error: "url is required" });
      return;
    }
    // Disabled unless NEUTRON_DEMO_ALLOW_CLONE=1 (do not set it on Vercel:
    // git clones can exceed serverless timeouts). cloneRepo rejects honestly.
    const repo = await cloneRepo(newDemoManager().workspace, body.url);
    sendJson(res, 200, { ok: true, repository: repo.name, isDemo: repo.isDemo });
  } catch (err) {
    handleApiError(res, err);
  }
}
