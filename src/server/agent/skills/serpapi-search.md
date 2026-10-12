---
name: serpapi-search
description: Google/Bing/DuckDuckGo results via SerpApi, with searxng then duckduckgo fallback.
version: 1.0.0
author: groot
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [search, serpapi, google, bing, web-search, fallback]
    related_skills: [searxng-search, duckduckgo-search]
    fallback_for_toolsets: [web]
---

# SerpApi Search

Structured web search using [SerpApi](https://serpapi.com/) — a search API that returns
Google, Bing, DuckDuckGo, Yahoo and 100+ other engines' results as clean JSON.
Best result quality of the agent's search options, but **requires an API key**.
A free SerpApi account includes 250 searches per month.

Preferred when `SERPAPI_API_KEY` is configured and high-quality structured results
are wanted. Without a key, follow the fallback chain below.

## Configuration

SerpApi requires a `SERPAPI_API_KEY` environment variable:

```bash
# Get a free key at https://serpapi.com/ (250 searches/month)
export SERPAPI_API_KEY="your-key-here"
```

Never hardcode the key in commands, files, or chat. Read it from the environment.

## Detection Flow

Check what is actually available before choosing an approach:

```bash
# Check if a SerpApi key is configured
[ -n "$SERPAPI_API_KEY" ] && echo "SERPAPI=configured" || echo "SERPAPI=missing"
```

Decision tree (the fallback chain):
1. If `SERPAPI_API_KEY` is set, use SerpApi (this skill)
2. Else if `SEARXNG_URL` is set and reachable, use the `searxng-search` skill
3. Else use the `duckduckgo-search` skill (keyless)
4. Otherwise fall back to built-in web/browser tools

If the user wants SerpApi specifically but has no key, point them at
https://serpapi.com/ for a free account — do not proceed keyless and
do not invent a key.

## Method 1: CLI via curl (Preferred)

Use `curl` via `terminal` to call the SerpApi JSON API. This avoids assuming
any particular Python package is installed.

```bash
# Google search (JSON output)
curl -s --max-time 15 "https://serpapi.com/search.json?engine=google&q=python+async+programming&num=10&api_key=${SERPAPI_API_KEY}"

# Bing search
curl -s --max-time 15 "https://serpapi.com/search.json?engine=bing&q=fastapi+deployment&count=10&api_key=${SERPAPI_API_KEY}"

# News search via Google News engine
curl -s --max-time 15 "https://serpapi.com/search.json?engine=google_news&q=AI+regulation&api_key=${SERPAPI_API_KEY}"
```

### Common Parameters

| Param | Description | Example |
|-------|-------------|---------|
| `engine` | Search engine: `google`, `bing`, `duckduckgo`, `yahoo`, `google_news`, `youtube` | `engine=google` |
| `q` | Query string (URL-encoded) | `q=python+async` |
| `num` | Max results (Google, up to 100) | `num=10` |
| `count` | Max results (Bing) | `count=10` |
| `hl` | Interface language | `hl=en` |
| `gl` | Country for results | `gl=us` |
| `location` | Location context | `location=Austin,Texas` |
| `api_key` | Your SerpApi key — **always from env, never hardcoded** | `api_key=${SERPAPI_API_KEY}` |

### Parsing JSON Results

```bash
# Extract titles, links, snippets from organic results
curl -s --max-time 15 "https://serpapi.com/search.json?engine=google&q=fastapi&num=5&api_key=${SERPAPI_API_KEY}" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'error' in data:
    print('SerpApi error:', data['error']); sys.exit(1)
for r in data.get('organic_results', []):
    print(r.get('title',''))
    print(r.get('link',''))
    print(r.get('snippet','')[:200])
    print()
"
```

Returns per result: `position`, `title`, `link`, `snippet`, `displayed_link`,
plus optional `answer_box`, `knowledge_graph`, `related_questions`.

## Method 2: Python API

Use the official SerpApi Python client. Verify it is installed in the
target runtime first — do not assume `execute_code` has it.

```bash
pip install google-search-results
```

```python
import os
from serpapi import GoogleSearch

api_key = os.environ.get("SERPAPI_API_KEY", "")
if not api_key:
    raise RuntimeError("SERPAPI_API_KEY is not set")

params = {
    "engine": "google",
    "q": "fastapi deployment guide",
    "num": 5,
    "api_key": api_key,
}
data = GoogleSearch(params).get_dict()
if "error" in data:
    raise RuntimeError(f"SerpApi error: {data['error']}")

for r in data.get("organic_results", []):
    print(r["title"])
    print(r["link"])
    print(r.get("snippet", "")[:200])
    print()
```

Important runtime note (same as other search skills):
- Terminal and `execute_code` are separate runtimes
- A successful `pip install` in terminal does not guarantee `execute_code` can import it
- Never assume third-party Python packages are preinstalled inside `execute_code`

## Fallback Chain

When SerpApi is unavailable, degrade gracefully instead of failing:

```bash
if [ -n "$SERPAPI_API_KEY" ]; then
  echo "path=serpapi"      # this skill
elif curl -s --max-time 5 "${SEARXNG_URL}/search?q=test&format=json" >/dev/null 2>&1; then
  echo "path=searxng"       # searxng-search skill
else
  echo "path=duckduckgo"    # duckduckgo-search skill (keyless)
fi
```

Document which path was used when reporting results, so the user knows
the result quality to expect.

## Workflow: Search then Extract

SerpApi returns titles, links, and snippets — not full page content. To get
full page content, search first and then extract the most relevant link with
`web_extract`, browser tools, or `curl`.

## Limitations

- **API key required**: Without `SERPAPI_API_KEY` this skill cannot function.
  Use the fallback chain instead of failing.
- **Quota**: Free accounts get 250 searches/month. Each API call counts,
  including retries — cache results when iterating on parsing.
- **No content extraction**: Returns snippets, not full page content.
- **Rate limiting**: HTTP 429 means quota or rate limit hit; back off and
  use the fallback chain.

## Troubleshooting

| Problem | Likely Cause | What To Do |
|---------|--------------|------------|
| `SERPAPI_API_KEY` not set | No key configured | Follow the fallback chain; point user at serpapi.com |
| `"error": "Invalid API key"` | Wrong or revoked key | User must regenerate the key on serpapi.com |
| `"error"` about credits | Monthly quota exhausted | Wait for reset or use searxng/duckduckgo fallback |
| HTTP 429 | Rate limited | Back off, retry once, then fall back |
| Empty `organic_results` | Query too narrow or engine hiccup | Broaden query or try another engine |

## Pitfalls

- **Never hardcode the API key**: Always read `SERPAPI_API_KEY` from the
  environment. Keys in chat logs, files, or command history leak.
- **Always check for the `error` field**: A 200 response can still carry
  `{"error": "..."}` — check before parsing results.
- **URL-encode queries**: Spaces and special characters must be encoded,
  or pass params properly in Python.
- **Set a timeout**: Always use `--max-time` or `timeout=` to avoid hangs.
- **Count your calls**: Every request burns quota. Don't loop searches
  when one call plus local parsing will do.
- **Don't assume the key exists**: Check first, then choose the fallback
  chain path. Never block on a missing key.
