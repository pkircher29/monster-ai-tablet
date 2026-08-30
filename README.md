# Monster Agent Hub

Monster Agent Hub is a local-first control surface for the Android coding tablet and its trusted
Windows host. The current milestone provides a real, reviewable delegation preview; it does not
launch agents or authorize external actions.

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

## Current preview milestone

- A touch-first installable PWA lists Hermes, Codex, Claude Code, OpenClaw, and Antigravity with
  explicit **Best for** and **Do not use for** guidance.
- The agent rack reads a host-owned `GET /api/agents/status` snapshot. Hermes, Codex, Claude Code,
  and OpenClaw are checked with bounded server-owned probes; Antigravity is reported honestly as a
  supervised desktop-only tool.
- A host-owned registry decomposes an objective into research, implementation, verification, and
  review work, then returns versioned agent/model/tool assignments with evidence and cost bounds.
- The OpenRouter adapter is exact-model, no-tools by default, secret-safe, and budget-reserved. No
  provider credential is configured and no paid model call has been made.
- Approval and execution controls remain deliberately disabled. A preview has an empty
  `sideEffects` list and cannot start work.
- The PWA is installed on the physical tablet. Its service worker, standalone display mode,
  private host link, and four-item preview were verified after installation.

On this workstation, [`scripts/start-hub.cmd`](scripts/start-hub.cmd) runs the built host on
`127.0.0.1:8790`. A private Tailscale Serve route publishes it to the tailnet on HTTPS port `9443`;
Tailscale Funnel is not enabled. The Windows scheduled task `Monster Agent Hub` is registered to
start the launcher at Paul’s next logon. A task-owned launch and Windows restart recovery still need
verification after the temporary test listeners are stopped.

## Security boundary

Credentials and provider tokens belong on the trusted host, not in the tablet browser or source
control. Probe output, command lines, paths, identities, and credentials are never returned by the
status API. The preview HTTP surface is loopback-only behind Tailscale and has no execution routes.
Authentication is still required before any future execution-capable API can be added. See
[`tasks/plan.md`](tasks/plan.md) for the full architecture and delivery phases.
