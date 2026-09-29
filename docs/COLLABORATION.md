# NEUTRON Collaboration Rooms

Real-time collaboration rooms: create a room, share the code, and work together
live — presence, chat, collaborative file editing (Yjs CRDT), and voice calls
(WebRTC). This document describes the whole system end-to-end: architecture,
protocol, configuration, honest limits, and the manual QA checklist.

## The one big requirement: the Node server

Collaboration rooms **only work on the Node server** (`node dist/cli-entry.js web`).
They use long-lived WebSocket connections, which serverless hosting (Vercel)
cannot hold. On Vercel the Rooms route shows an honest note explaining this —
no fake "connecting" state, no mock data.

## Concepts

- **Room**: identified by a code like `NEUTRON-AB12CD` (unambiguous alphabet, no
  `0/O/1/I/L`). Anyone with the code can join with a display name — rooms work
  like shared-doc links. There are **no accounts**; identity is the display name
  you pick per room (remembered in your browser).
- **Roles**: `owner` (the creator, via a one-time owner token shown once at
  creation and stored hashed server-side) and `member`. The owner can rename /
  delete the room and rename / delete / restore shared files. The client is
  **never** trusted for roles — the server derives them.
- **Persistence**: rooms, chat history (200/room), file snapshots, and versions
  persist to `<data-root>/.agent/collab/`. Presence, voice membership, cursor
  awareness, and Yjs session state are **ephemeral** and die with the socket.

## What lives where

| Piece | Location |
|---|---|
| Room registry, membership, chat, snapshots | `src/server/collab/room-manager.ts` |
| WebSocket protocol, rate limits, relay | `src/server/collab/collab-server.ts` |
| Shared-file store (Yjs docs, versions) | `src/server/collab/file-store.ts` |
| HTTP routes (`POST /api/collab/rooms`, `GET /api/collab/rooms/:code`) | `src/server/server.ts` |
| Client (rooms UI, editor, voice) | `src/web/app/rooms.js` |
| Pure client helpers (testable) | `src/web/app/ui-utils.js` |
| Styles (all 8 themes incl. glass) | `src/web/app/styles.css` |
| Tests | `tests/collab-*.test.ts` |

## Wire protocol (`/collab` WebSocket)

Client → server: `ROOM_JOIN`, `ROOM_LEAVE`, `ROOM_RENAME`, `ROOM_DELETE`,
`PRESENCE_UPDATE`, `CHAT_MESSAGE`, `CHAT_DELETE {id}`, `CHAT_TYPING`, `WEBRTC_OFFER/ANSWER/ICE`
(`to` + `payload`), `VOICE_JOIN`, `VOICE_LEAVE`, `VOICE_STATE {muted}`,
`FILE_*` (list/create/rename/delete/open/close/snapshot), `YJS_SYNC`
(step1/step2/update, y-protocols-compatible framing), `AWARENESS_UPDATE`,
`VERSION_*`, `AI_CONTEXT_REQUEST {requestId, fileId, selection}`, `AI_APPLY {fileId}`.

Server → client: `JOINED` (room, you, members, chat, files, `ice`, `voice`),
`LEFT`, `MEMBERS`, `CHAT_MESSAGE`, `CHAT_DELETED {id}`, `CHAT_TYPING`, `VOICE_MEMBERS`,
`WEBRTC_*` (with `from`/`fromName`), `FILE_*`, `YJS_SYNC`, `AWARENESS`,
`ROOM_RENAMED`, `ROOM_DELETED`, `FILE_SNAPSHOT`, `VERSIONS`,
`AI_CONTEXT {requestId, ok, code?, path?, text?, truncated?}`,
`ACTIVITY {event}`, `ERROR {code, message, fileId?}` (`fileId` is present on
`FILE_TOO_LARGE` open refusals so the client can tear down its optimistic tab).

Every message is membership-checked server-side: the server looks up the
connection's own member id and only relays within the **same room**. A forged
`to` / `roomId` / `userId` / `role` from the client is never trusted.

Rate limits (token buckets, per connection): join 5/min, chat burst 5,
presence 1/2s, **signaling 20/min**, Yjs 30/s, file ops 10/min, awareness 4/s.

## Collaborative editing (Phase 2)

Files are Yjs documents. The client sends local edits as Yjs updates; the
server applies them to its authoritative doc and relays the update to other
openers, who merge via CRDT — **no last-write-wins**, concurrent edits to
different (or nearby) lines both survive. Debounced snapshots persist the doc;
version history is kept per file (owner can restore — a restore is itself a
Yjs update, so everyone converges). Cursor awareness is relay-only, throttled
to ~4/s, never persisted.

## Voice calls (Phase 3)

- **Topology**: full mesh — one `RTCPeerConnection` per other participant,
  capped at **6** voice participants per room (the 7th gets an honest
  `VOICE_FULL` error). Correct for small rooms; no SFU.
- **Signaling**: `WEBRTC_OFFER/ANSWER/ICE` relayed by the server (membership
  validated, same-room only). **Non-trickle ICE**: the full candidate set
  travels inside the SDP, so call setup is 1 offer + 1 answer per peer and the
  20/min signaling bucket is never the bottleneck.
- **Glare avoidance**: deterministic offerer rule — the member with the
  lexicographically smaller member id creates the offer (`shouldInitiateVoiceOffer`).
- **NAT traversal**: every client tries Google's public STUN servers by
  default. For restrictive NATs/firewalls, configure TURN:

  | Env var | Purpose |
  |---|---|
  | `NEUTRON_STUN_URL` | Override/add a STUN server (optional) |
  | `NEUTRON_TURN_URL` | TURN server URL, e.g. `turn:turn.example.com:3478` |
  | `NEUTRON_TURN_USERNAME` | TURN username (optional) |
  | `NEUTRON_TURN_CREDENTIAL` | TURN credential (optional) |

  TURN config is advertised **only inside the `JOINED` message to validated
  room members** — never on a public endpoint, never logged, never hardcoded.
  Without TURN, voice still works for most NATs via STUN. For production,
  prefer short-lived TURN credentials (TURN REST API) over static env secrets.
- **Microphone**: requested **only** when the user taps "Join voice" — never
  before. Denial shows a specific fix ("click the lock icon in the address
  bar…"). Leaving the room or the call stops all mic tracks (the OS mic
  indicator goes off). If the mic disconnects mid-call, the client leaves
  cleanly with an explanation.
- **Speaking indicators**: a local `AnalyserNode` per remote stream computes
  RMS; above threshold lights a subtle green ring on the speaker's chip.
  Analysis only — no raw audio data leaves the browser except the peer
  connection itself. The analyser chain is never connected to the destination
  (no feedback), and the ring is static under `prefers-reduced-motion`.
- **Connection states** per peer: connecting / connected / reconnecting /
  failed, with an honest **Retry** button on failure (re-runs the offer flow).
- **Reconnect**: the mic stays open across socket drops; on re-`JOINED` the
  client re-announces `VOICE_JOIN` and restores its mute state, and the mesh
  rebuilds from the authoritative `VOICE_MEMBERS` list.
- **Mute**: local track `enabled` toggle + `VOICE_STATE {muted}` broadcast, so
  everyone sees who's muted.
- **Mobile**: voice is the fifth room tab (Files | Editor | Chat | Members |
  Voice); all controls use theme variables and have `aria-label`s; join/leave
  is announced via the screen-reader live region.

## AI in rooms (Phase 4)

- **Server-authorized context**: the client never ships room files anywhere
  itself. It sends `AI_CONTEXT_REQUEST {requestId, fileId, selection}`; the
  server reads the file from its own `CollabFileStore` and replies
  `AI_CONTEXT {requestId, ok, …}` — only for files in the requester's room.
  Non-members get `ok: false`. Selection indices are validated and clamped
  server-side; long files come back truncated with `truncated: true`.
- **Approval gate**: AI edits are never applied silently. The client shows a
  review UI (diff stats); only on explicit approval does it send `AI_APPLY`,
  which the server logs to the activity feed. The edit itself flows through
  the normal Yjs update path, so all collaborators converge.
- **Activity feed**: `ACTIVITY` broadcasts (member join/leave, file
  create/rename/delete, voice join/leave, AI apply, version restore) keep a
  lightweight room timeline. Presence/cursor data is never persisted.
- **Honest scope**: the AI answers with the room's files as context using the
  user's own BYOK key (`x-api-key`, never stored server-side). It cannot see
  other rooms' files, and it cannot act without the approval gate.

## Security model (honest)

- No accounts: "user-specific" = this browser (same trust boundary as the
  BYOK API key in `localStorage`). There is no login to fake.
- The server validates **membership on every message**; cross-room relay is
  impossible even with a forged `to` id (tested).
- Owner-only operations require the server-side role derived from the owner
  token at join; the token itself is returned once at creation and stored
  SHA-256-hashed.
- Rate limits on every message class; signaling payloads capped at 16KB;
  sync payloads capped at ~1MB; chat text sanitized (2000 chars).
- Operational logs never include tokens, message text, or voice data.

## Honest limits

- **Vercel**: rooms and voice need the Node server; the app says so instead of
  pretending.
- **Scale**: in-memory room state + debounced disk snapshots. Fine for teams;
  not a multi-server design (no Redis adapter — out of scope).
- **Voice**: mesh caps at 6; no screen sharing (not requested); no PSTN.
- **Files**: shared editing caps at 500K characters per file (`MAX_FILE_CHARS`).
  Oversized files stop accepting edits but keep serving reads; opening one is
  refused at the handshake with an honest message instead of freezing the client.
- **AI**: answers with room-file context via the user's BYOK key; edits require
  explicit approval through the gate — the AI never writes silently.

## Manual QA checklist

### Rooms / chat / presence
- [ ] Create a room → code + invite link shown; deep link `#room=NEUTRON-XXXXXX` joins.
- [ ] Two browsers join → member list updates live on both; count correct.
- [ ] Chat messages appear live both ways; typing indicator shows; history
      survives rejoin (200 cap).
- [ ] Owner rename/delete works; non-owner controls hidden; deleted room kicks
      everyone with a toast.
- [ ] Kill the server → "Reconnecting…" → restart → auto-rejoin, tabs reopen.

### Collaborative editing
- [ ] A and B open the same file; A types at line 10, B at line 20 → both see
      both edits, no overwrites.
- [ ] Cursor chips show the other user's position live.
- [ ] "🟢 Saved" appears after edits; Versions lists entries; owner restores one
      → everyone converges.

### Voice (needs two real devices/browsers — cannot be automated in vitest)
- [ ] Tap "Join voice" → **mic permission prompt appears only now**, not before.
- [ ] Deny the mic → clear error with the address-bar fix hint; "Try again" works.
- [ ] A and B join → both hear each other; chips show names; mute on A shows
      🔇 on B's screen and A is actually silent.
- [ ] Speaking → green ring on the active speaker's chip (no flicker on pauses).
- [ ] C joins mid-call → mesh forms without refresh (offerer rule, no glare).

### AI + activity (Phase 4)
- [ ] "Ask AI" on an open file → answer references the file; a second room's
      files are never visible to the AI.
- [ ] AI-proposed edit → review UI shows diff stats; Approve applies through
      Yjs (everyone converges); Reject changes nothing.
- [ ] Activity tab shows join/file/voice/AI events in order; refresh keeps it.
- [ ] Opening a 500K+ char file → honest "too large" message, no frozen editor.
- [ ] 7th joiner → "Voice is full in this room (6 max)."
- [ ] A closes the tab → B's chip list drops A within seconds; A's mic
      indicator is off.
- [ ] Disconnect network mid-call → "Reconnecting voice…" → restore network →
      call resumes without re-tapping Join.
- [ ] One peer's connection fails (e.g. firewall) → "Connection failed" + Retry
      → Retry re-establishes.
- [ ] Leave room while in call → mic indicator off, no lingering connections
      (`chrome://webrtc-internals` shows none).
- [ ] Mobile: Voice tab reachable; Mute/Leave ≥44px targets; works in all 8 themes.
- [ ] With `NEUTRON_TURN_*` set, a call across symmetric NATs connects
      (check `chrome://webrtc-internals` shows a `relay` candidate pair).
