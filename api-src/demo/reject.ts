import { handleApiError, parseId, readJsonBody, requireMethod, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "../_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;
  try {
    const body = readJsonBody(req);
    const analysisId = parseId(body.analysisId, "analysis id");
    // Rejection is stateless and fail-closed: nothing was ever approved,
    // and on this deployment nothing can execute anyway.
    sendJson(res, 200, { ok: true, rejected: true, analysisId });
  } catch (err) {
    handleApiError(res, err);
  }
}
