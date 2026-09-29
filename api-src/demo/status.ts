import { getDemoStatus } from "../../src/server/demo";
import {
  extractRequestKeyFromHeaders,
  extractRequestProviderFromHeaders,
} from "../../src/server/byok";
import { handleApiError, newDemoManager, requireMethod, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "../_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "GET")) return;
  try {
    const manager = newDemoManager();
    sendJson(res, 200, {
      ...getDemoStatus(manager, {
        apiKey: extractRequestKeyFromHeaders(req.headers),
        providerId: extractRequestProviderFromHeaders(req.headers),
      }),
      serverless: true,
      // Honest capability flag: analysis/impact/plan/approval run live;
      // full agent execution needs the persistent Node host.
      executionSupported: false,
    });
  } catch (err) {
    handleApiError(res, err);
  }
}
