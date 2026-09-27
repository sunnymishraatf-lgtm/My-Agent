import { handleApiError, parseId, requireMethod, sendJson, type VercelRequest, type VercelResponse } from "../../_lib";

function jobIdFrom(req: VercelRequest): string {
  const raw = req.query?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return parseId(id, "job id");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!requireMethod(req, res, "GET")) return;
  try {
    jobIdFrom(req);
    // No background jobs exist on serverless: execute is honestly unsupported,
    // so there is nothing to poll. The UI never reaches this route.
    sendJson(res, 404, {
      ok: false,
      error: "No jobs exist on this serverless demo. Full agent execution needs the persistent Node host — see docs/DEPLOYMENT.md.",
    });
  } catch (err) {
    handleApiError(res, err);
  }
}
