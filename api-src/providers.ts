/**
 * GET /api/providers — the real provider catalog for the /app Settings UI,
 * so the frontend never hardcodes provider ids or names.
 *
 * Response: { ok: true, providers: [{ id, displayName, description, defaultModels }] }
 * `defaultModels` are UI dropdown suggestions only (free-text override is
 * always allowed); model lists themselves are discovered per provider.
 * There is no default provider — the user must pick one explicitly.
 */
import { listCatalog, defaultModelsFor } from "../src/providers/catalog";
import { requireMethod, sendJson, type VercelRequest, type VercelResponse, handlePreflight } from "./_lib";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "GET")) return;
  sendJson(res, 200, {
    ok: true,
    providers: listCatalog().map((e) => ({
      id: e.id,
      displayName: e.displayName,
      description: e.description,
      defaultModels: defaultModelsFor(e.id),
    })),
  });
}
