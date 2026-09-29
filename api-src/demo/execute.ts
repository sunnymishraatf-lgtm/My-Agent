import {
  handleApiError,
  parseId,
  readJsonBody,
  requireMethod,
  sendJson,
  verifyApprovalToken,
  type VercelRequest,
  type VercelResponse,
} from "../_lib";
import { extractRequestKeyFromHeaders, extractRequestProviderFromHeaders } from "../../src/server/byok";
import { registerSecrets } from "../../src/config";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireMethod(req, res, "POST")) return;
  try {
    // BYOK plumbing: accept the request key and register it for redaction so
    // it can never leak into logs or error text. The provider choice is
    // accepted the same way (x-provider header). (Full agent execution stays
    // honestly unsupported on serverless — neither changes that.)
    const requestKey = extractRequestKeyFromHeaders(req.headers);
    const requestProvider = extractRequestProviderFromHeaders(req.headers);
    if (requestKey) registerSecrets([requestKey]);
    const body = readJsonBody(req);
    const analysisId = parseId(body.analysisId, "analysis id");
    // The approval gate is still enforced: without a valid signed approval
    // token for this analysis, execution is refused — exactly like the
    // 409 requiresApproval on the persistent server.
    if (!verifyApprovalToken(body.approvalToken, analysisId)) {
      sendJson(res, 403, {
        ok: false,
        requiresApproval: true,
        error: "A valid plan approval is required before execution. Review the plan and approve it first.",
      });
      return;
    }
    // Honest serverless limit — NOT faked: a maintain run needs long-running
    // processes and a persistent workspace, which do not fit serverless
    // function timeouts. Everything before this step (repository analysis,
    // impact analysis, implementation plan, human approval) ran for real.
    sendJson(res, 200, {
      ok: true,
      analysisId,
      executionUnsupported: true,
      message:
        "Full agent execution is not available on this serverless demo: it needs long-running processes " +
        "and a persistent workspace, which do not fit serverless function limits. Everything up to this point — " +
        "repository analysis, impact analysis, implementation plan, and your approval — ran for real. " +
        "To watch the agents execute, test, scan and review, run the persistent Node server instead: " +
        "see docs/DEPLOYMENT.md (Render / Docker).",
    });
  } catch (err) {
    handleApiError(res, err);
  }
}
