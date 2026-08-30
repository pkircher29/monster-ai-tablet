# Monster AI Coding Tablet Checklist

## Phase 1: Foundation

- [x] Record redacted device and bootloader baseline
- [x] Install official-source Termux arm64 build and verify checksum
- [x] Install and verify Git, SSH, Python, Node, ripgrep, tmux, Rust, Clang, FFmpeg, and Debian proot in Termux
- [x] Install and pair Tailscale using MagicDNS
- [x] Install and pair the supported OpenClaw Android node/client without `operator.admin`
- [x] Verify tablet reboot recovery and Android battery settings without broad exemptions

## Phase 2: Hub Core

- [x] Scaffold npm-workspace TypeScript project
- [x] Implement versioned contracts and adversarial validation tests
- [ ] Implement manifest-driven agent registry
- [x] Implement bounded read-only health probes for all five named agent profiles
- [ ] Persist bounded status history in SQLite
- [x] Build accessible, responsive installable PWA
- [ ] Add authentication, redaction, CSP, and private-network checks

## Phase 3: Agent Adapters

- [ ] Connect Hermes gateway/API capabilities
- [ ] Connect OpenClaw gateway and agent fleet
- [ ] Add workspace-bounded Codex adapter
- [ ] Add workspace-bounded Claude Code adapter
- [ ] Add honest Antigravity desktop launch/status adapter
- [x] Seed Best for and Do not use for guidance

## Phase 4: Agent Collaboration

- [ ] Implement durable task and handoff envelopes
- [ ] Enforce ACLs, approvals, hop limit, TTL, idempotency, and payload bounds
- [ ] Add streaming status, artifacts, cancellation, and audit history
- [ ] Verify a Hermes to Codex to Claude reviewed coding workflow

## Phase 5: Delegation and Model Audition

- [x] Implement intent, plan-DAG, authority, budget, assignment, attempt, and routing-profile contracts
- [x] Add a deterministic preview-only DAG and evidence-ranked versioned assignments
- [ ] Implement DAG validation, monotonic child authority, durable scheduling, retry, and exact cancellation
- [ ] Implement capability router with explainable alternatives and manual pin/override
- [x] Add a host-only, exact-model OpenRouter adapter with bounded catalog snapshots and no tablet credential surface
- [ ] Add response-only and disposable-sandbox model audition modes
- [ ] Enforce per-call, per-intent, daily, and monthly cost reservations and approvals
- [ ] Verify no secret reaches the tablet, API payloads, logs, events, SQLite, or repository

## Phase 6: Benchmarking

- [ ] Add immutable benchmark case registry and disposable fixture workspaces
- [ ] Separate raw-model, agent-harness, and full-workflow leaderboards
- [ ] Add deterministic scorers, blinded pairwise review, and critical-safety gates
- [ ] Record model/provider/catalog/prompt/tool/environment versions, cost, and latency
- [ ] Add private holdouts, contamination canaries, repeated runs, and variance reporting
- [ ] Feed explicitly promoted, versioned category evidence into the capability router

## Phase 7: Extensibility and Release

- [ ] Add adapter SDK, manifest template, and conformance suite
- [x] Install Monster Agent Hub PWA on the tablet
- [x] Verify portrait, landscape, split-width, keyboard-focus, and offline behavior in a real desktop browser
- [ ] Verify physical tablet landscape, split-screen, and offline states; portrait, keyboard, and touch passed
- [ ] Verify Windows host-task restart recovery; tablet reboot recovery passed
- [ ] Document backup, restore, update, and add-an-agent workflows
- [ ] Run secret scan, security tests, full CI, and release verification
