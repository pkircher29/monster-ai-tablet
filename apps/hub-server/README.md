# Monster Agent Hub server

The hub server is a local, preview-only HTTP host. It serves the built tablet PWA and creates reviewable delegation plans; it does not launch agents, call models, read credentials, push, deploy, purchase, message, or run ADB.

## Start

Build the web app and server from the workspace root, then start the host:

```sh
npm run build --workspace @monster-agent-hub/hub-web
npm run build --workspace @monster-agent-hub/hub-server
npm start --workspace @monster-agent-hub/hub-server
```

The default listener is `127.0.0.1:8787`. `MONSTER_HUB_HOST` and `MONSTER_HUB_PORT` explicitly override the bind address and port. Keep the listener on loopback when placing it behind Tailscale Serve; a non-loopback bind expands who can reach the unauthenticated preview surface.

`SIGINT` and `SIGTERM` stop accepting requests, close idle connections, and allow active requests five seconds to finish before their sockets are closed. Repeated shutdown requests share the same in-flight shutdown operation.

## HTTP contract

`GET /api/health` returns:

```json
{
  "status": "ok",
  "service": "monster-agent-hub",
  "mode": "PREVIEW_ONLY",
  "schemaVersion": 1
}
```

`GET /api/agents/status` runs bounded, server-owned availability checks and returns only closed
status enums and safe version strings. It never accepts executable names or arguments from the
client and never returns raw stdout, stderr, paths, account identities, process IDs, or command
lines. The endpoint is read-only and does not launch an agent session.

`POST /api/delegation/preview` accepts only uncompressed UTF-8 `application/json` with this exact shape:

```json
{
  "objective": "Build a local task inbox and verify its safety boundaries.",
  "workspace": "monster-agent-hub",
  "budgetCapMicrodollars": 400000
}
```

No other fields are accepted. The client may narrow the cost cap but cannot exceed the host ceiling. The host injects the requester identity, current time, plan revision, TTL, concurrency, token/duration ceilings, authority, and immutable agent registry. `Plan work` remains a preview and never starts execution.

Success returns the `DelegationPreview` contract. Every error uses one stable envelope and omits stacks and internal values:

```json
{
  "error": {
    "code": "INVALID_PREVIEW_REQUEST",
    "message": "Expected an authorized local preview request."
  }
}
```

Cross-site API requests are rejected and no permissive CORS header is emitted. Fetch Metadata must be absent, `same-origin`, or `none`; contradictory or unknown site classifications fail closed. The request body is capped at 8 KiB, and the entire `/api` namespace is reserved for API responses rather than the SPA fallback.

## Static PWA

The default static root is `apps/hub-web/dist`. `GET` and `HEAD` serve files with explicit MIME types and security headers. A single static response is capped at 16 MiB before the file is read into memory. Extensionless application routes fall back to `index.html`; API paths, asset paths, directories, dotfiles, encoded separators, traversal segments, control characters, and Windows alternate-data-stream syntax do not.

The server registry records provenance-tagged host inventory observations for Hermes, Codex, Claude Code, OpenClaw, and Antigravity. Numeric benchmark evidence intentionally remains empty until real benchmark runs produce it.
