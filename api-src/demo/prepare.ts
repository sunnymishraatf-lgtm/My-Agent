import { prepareDemoRepo } from "../../src/server/demo";
import { handleApiError, newDemoManager, requireMethod, sendJson, type VercelRequest, type VercelResponse } from "../_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireMethod(req, res, "POST")) return;
  try {
    const manager = newDemoManager();
    // Real TaskFlow scaffold into /tmp (the only writable dir on serverless).
    sendJson(res, 200, { ok: true, ...prepareDemoRepo(manager.workspace) });
  } catch (err) {
    handleApiError(res, err);
  }
}
