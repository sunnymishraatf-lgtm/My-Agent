import {
  handleApiError,
  issueApprovalToken,
  parseId,
  readJsonBody,
  requireMethod,
  sendJson,
  type VercelRequest,
  type VercelResponse,
} from "../_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireMethod(req, res, "POST")) return;
  try {
    const body = readJsonBody(req);
    const analysisId = parseId(body.analysisId, "analysis id");
    // Stateless approval: no server-side analysis store survives across
    // serverless invocations, so approval is a signed HMAC token (SERVER_SECRET)
    // bound to this analysis id. /api/demo/execute validates it.
    // (On this deployment execute is honestly unsupported, so the token only
    // gates the workflow order — it can never authorize a real run here.)
    const approvalToken = issueApprovalToken(analysisId);
    sendJson(res, 200, { ok: true, approved: true, analysisId, approvalToken });
  } catch (err) {
    handleApiError(res, err);
  }
}
