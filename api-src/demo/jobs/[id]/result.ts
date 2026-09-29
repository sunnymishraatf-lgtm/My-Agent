import { handleApiError, handlePreflight, parseId, requireMethod, sendJson, type VercelRequest, type VercelResponse } from "../../../_lib";

function jobIdFrom(req: VercelRequest): string {
  const raw = req.query?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return parseId(id, "job id");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "GET")) return;
  try {
    jobIdFrom(req);
    sendJson(res, 404, {
      ok: false,
      error: "No job results exist on this serverless demo. Full agent execution needs the persistent Node host — see docs/DEPLOYMENT.md.",
    });
  } catch (err) {
    handleApiError(res, err);
  }
}
