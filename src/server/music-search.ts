/**
 * Server-side music search for the NEUTRON web app's Music section.
 *
 * Why this exists: the Music section's search used to call public
 * Piped/Invidious instances straight from the browser. Those volunteer
 * instances die regularly (four died at once in Sep 2026), leaving search
 * permanently "unreachable". A browser also cannot query YouTube directly:
 * youtubei validates the Origin header and answers preflights with 403.
 *
 * So the app's own backend does the searching now (server-to-server has no
 * CORS/Origin problem): it queries YouTube's InnerTube search API directly
 * — the same catalog the official YouTube Music clients use — with one
 * public Piped instance as a parallel fallback. Playback stays on official
 * YouTube embeds; this endpoint only returns video IDs + titles, never
 * stream URLs.
 *
 * Shared by the Vercel function (api-src/chat.ts, action "music-search")
 * and the Node server (src/server/server.ts, POST /api/chat).
 */

export interface MusicSearchResult {
  id: string;
  title: string;
  artist?: string;
}

/* Public client key embedded in YouTube's own web clients. It identifies
   the WEB_REMIX client; it is not a secret and grants no account access. */
const YOUTUBEI_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const YOUTUBEI_URL =
  "https://www.youtube.com/youtubei/v1/search?key=" + YOUTUBEI_KEY + "&prettyPrint=false";
const PIPED_FALLBACK = "https://api.piped.private.coffee/search?filter=videos&q=";

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_RESULTS = 12;

/**
 * Parse a YouTube InnerTube search response into song results.
 * Walks the tree for musicResponsiveListItemRenderer nodes; each carries
 * navigationEndpoint.watchEndpoint.videoId plus flexColumns[0] = title and
 * flexColumns[1] = "Song • Artist1, Artist2".
 */
export function parseYoutubeiSearch(data: unknown): MusicSearchResult[] {
  const out: MusicSearchResult[] = [];
  const seen = new Set<string>();
  function textOf(col: unknown): string | null {
    try {
      const c = col as {
        musicResponsiveListItemFlexColumnRenderer: { text: { runs: { text: string }[] } };
      };
      const runs = c.musicResponsiveListItemFlexColumnRenderer.text.runs;
      const first = Array.isArray(runs) ? runs[0] : undefined;
      if (first && typeof first.text === "string") {
        return first.text;
      }
    } catch {
      /* malformed node — skip */
    }
    return null;
  }
  function artistsOf(col: unknown): string | undefined {
    try {
      const c = col as {
        musicResponsiveListItemFlexColumnRenderer: { text: { runs: { text: string }[] } };
      };
      const runs = c.musicResponsiveListItemFlexColumnRenderer.text.runs;
      if (!Array.isArray(runs) || runs.length < 2) return undefined;
      // runs[0] is the type badge ("Song"/"Video"); the rest alternate
      // artist names and separators (" • ", ", ", " & ").
      const names = runs
        .slice(1)
        .map((r) => (typeof r.text === "string" ? r.text.trim() : ""))
        .filter((t) => t && t !== "•" && t !== "," && t !== "&");
      return names.length ? names.join(", ") : undefined;
    } catch {
      return undefined;
    }
  }
  function walk(node: unknown): void {
    if (out.length >= MAX_RESULTS) return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      const item = rec["musicResponsiveListItemRenderer"] as
        | {
            navigationEndpoint?: { watchEndpoint?: { videoId?: unknown } };
            flexColumns?: unknown[];
          }
        | undefined;
      if (item && typeof item === "object") {
        const vid = item.navigationEndpoint?.watchEndpoint?.videoId;
        const cols = Array.isArray(item.flexColumns) ? item.flexColumns : [];
        const title = cols.length ? textOf(cols[0]) : null;
        if (typeof vid === "string" && ID_RE.test(vid) && title && !seen.has(vid)) {
          seen.add(vid);
          const artist = cols.length > 1 ? artistsOf(cols[1]) : undefined;
          out.push(artist ? { id: vid, title, artist } : { id: vid, title });
        }
      }
      for (const v of Object.values(rec)) walk(v);
    }
  }
  walk(data);
  return out;
}

/** Normalize a Piped search payload ({items:[{url,title}]}) into results. */
export function parsePipedSearch(data: unknown): MusicSearchResult[] {
  const out: MusicSearchResult[] = [];
  const seen = new Set<string>();
  const items = (data as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (out.length >= MAX_RESULTS) break;
    const rec = it as { url?: unknown; title?: unknown } | null;
    if (!rec || typeof rec !== "object") continue;
    const m =
      typeof rec.url === "string" ? rec.url.match(/[?&]v=([A-Za-z0-9_-]{11})/) : null;
    const vid = m ? m[1] : undefined;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (vid && ID_RE.test(vid) && title && !seen.has(vid)) {
      seen.add(vid);
      out.push({ id: vid, title });
    }
  }
  return out;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error("upstream http " + res.status);
  return res.json();
}

async function youtubeiSearch(q: string): Promise<MusicSearchResult[]> {
  const data = await fetchJson(
    YOUTUBEI_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20250924.03.00", hl: "en", gl: "US" } },
        query: q,
      }),
    },
    8000,
  );
  return parseYoutubeiSearch(data);
}

async function pipedSearch(q: string): Promise<MusicSearchResult[]> {
  const data = await fetchJson(
    PIPED_FALLBACK + encodeURIComponent(q),
    { headers: { "user-agent": "Mozilla/5.0" } },
    8000,
  );
  return parsePipedSearch(data);
}

/**
 * Search for music. Queries YouTube directly and one Piped instance in
 * parallel, preferring YouTube's own results; returns up to 12 results.
 * Throws when every upstream fails so the caller can fall back honestly.
 */
export async function searchMusic(q: string): Promise<MusicSearchResult[]> {
  const query = q.trim().slice(0, 120);
  if (!query) throw new Error("Empty query");
  const [yt, piped] = await Promise.allSettled([youtubeiSearch(query), pipedSearch(query)]);
  if (yt.status === "fulfilled" && yt.value.length) return yt.value;
  if (piped.status === "fulfilled" && piped.value.length) return piped.value;
  if (yt.status === "fulfilled") return yt.value; // empty but reachable
  throw new Error(
    "Music search is unreachable right now — paste a YouTube link instead.",
  );
}
