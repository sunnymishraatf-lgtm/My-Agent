import { serializeAnalysis } from "../../src/server/demo";
import { handleApiError, newDemoManager, parseRiskTolerance, readJsonBody, requireMethod, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "../_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;
  try {
    const body = readJsonBody(req);
    const manager = newDemoManager();
    // The REAL NEUTRON pipeline: analyzeRepository -> analyzeImpact -> buildPlan.
    // Key-less and fast (~25ms on the TaskFlow demo), so it fits serverless limits.
    const record = manager.analyze(
      typeof body.repo === "string" ? body.repo : "demo",
      typeof body.request === "string" ? body.request : "",
      parseRiskTolerance(body.riskTolerance),
    );
    sendJson(res, 200, { ok: true, ...serializeAnalysis(record) });
  } catch (err) {
    handleApiError(res, err);
  }
}
