# Monster Agent Hub

Monster Agent Hub is a local-first control surface for the Android coding tablet and its trusted
Windows host. Version 0.2 adds the complete AI-Spy console as an isolated, authenticated operator
surface while retaining the hub's reviewable delegation and explicit assignment queue.

## Workspace layout

- `apps/hub-server` — host-side orchestration service
- `apps/hub-web` — tablet-friendly hub interface
- `packages/contracts` — shared schemas and API types
- `docs` — device baseline and compatibility research
- `tasks` — implementation plan and execution checklist

## Requirements

- Node.js 22.13 or newer
- npm 10.9 or newer

## Getting started

```sh
npm install
npm run check
```

Useful commands:

```sh
npm run build
npm run typecheck
npm test
npm run lint
npm run format
npm run format:check
```

The root commands automatically include workspace scripts as each application or package gains
an implementation.

The launcher requires one local password file. Create `.monster-hub/admin-password.txt` with one
14–256 character password, or point `MONSTER_HUB_ADMIN_PASSWORD_FILE` at another local file. The
directory is git-ignored; never commit the password.

## Version 0.2

- A touch-first installable PWA lists Hermes, Codex, Claude Code, OpenClaw, and Antigravity with
  explicit **Best for** and **Do not use for** guidance.
- The agent rack reads a host-owned `GET /api/agents/status` snapshot. Hermes, Codex, Claude Code,
  and OpenClaw are checked with bounded server-owned probes; Antigravity is reported honestly as a
  supervised desktop-only tool.
- Closed status snapshots are retained in a capped local SQLite history on the Windows host, so
  availability evidence survives a hub restart without storing raw probe output.
- A bounded reconnaissance card provides a safe summary, while **Open full AI-Spy console** exposes
  analytics, inventory, usage, network maps, Hermes status, Agora, skills, chat, consensus,
  benchmarks, orchestration, agent controls, keyring, directives, budgets, and model controls.
- AI-Spy runs as a separate loopback-only child with a random per-launch internal token. The child
  cannot be reached through the hub without an authenticated operator session.
- Read-only console requests require login. Execution and administrative requests require a second,
  exact, single-use approval bound to the session, HTTP method, path, query, and request body.
- Approval decisions and forwarded route/status metadata are appended to the git-ignored
  `.monster-hub/audit.jsonl`; prompts, key values, request bodies, passwords, and tokens are omitted.
- A host-owned registry decomposes an objective into research, implementation, verification, and
  review work, then returns versioned agent/model/tool assignments with evidence and cost bounds.
- The OpenRouter adapter is exact-model, no-tools by default, secret-safe, and budget-reserved. No
  provider credential is configured and no paid model call has been made.
- After reviewing a preview, the operator can explicitly queue its work-item assignments. The
  queue is capped and host-memory-only in this increment; it cannot launch commands or survive a
  host restart yet.
- The PWA is installed on the physical tablet. Its service worker, standalone display mode,
  private host link, and four-item preview were verified after installation.

On this workstation, [`scripts/start-hub.cmd`](scripts/start-hub.cmd) runs the built host on
`127.0.0.1:8790`. A private Tailscale Serve route publishes it to the tailnet on HTTPS port `9443`;
Tailscale Funnel is not enabled. The Windows scheduled task `Monster Agent Hub` is registered to
start the launcher at Paul’s next logon. A task-owned launch and Windows restart recovery still need
verification after the temporary test listeners are stopped.

## Security boundary

Credentials and provider tokens belong on the trusted host, not in the tablet browser or source
control. The HTTP surface and AI-Spy child are loopback-only behind private Tailscale Serve; Funnel
is disabled. Sessions are HttpOnly and rate-limited. High-impact AI-Spy calls are disabled until the
operator completes a separate one-use approval. No purchase, public post, message, ADB action, or
other external side effect is implied merely by opening the console.
