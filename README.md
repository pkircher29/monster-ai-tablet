# Monster Agent Hub

Monster Agent Hub is a local-first control surface for the Android coding tablet and its trusted
Windows host. The current milestone provides reviewable delegation plus an explicit local
assignment queue; it does not launch commands or authorize external actions.

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

## Current assignment milestone

- A touch-first installable PWA lists Hermes, Codex, Claude Code, OpenClaw, and Antigravity with
  explicit **Best for** and **Do not use for** guidance.
- The agent rack reads a host-owned `GET /api/agents/status` snapshot. Hermes, Codex, Claude Code,
  and OpenClaw are checked with bounded server-owned probes; Antigravity is reported honestly as a
  supervised desktop-only tool.
- Closed status snapshots are retained in a capped local SQLite history on the Windows host, so
  availability evidence survives a hub restart without storing raw probe output.
- A bounded AI-Spy-derived reconnaissance panel detects a fixed catalog of host tools without
  returning paths, commands, credentials, recursive file scans, or network-scan data.
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
control. Probe output, command lines, paths, identities, and credentials are never returned by the
status or reconnaissance APIs. The HTTP surface is loopback-only behind Tailscale; assignment only
writes to a bounded in-memory queue and has no command-execution route. Authentication is still
required before any execution-capable API can be added. See
[`tasks/plan.md`](tasks/plan.md) for the full architecture and delivery phases.
