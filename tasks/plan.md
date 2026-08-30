# Implementation Plan: Monster AI Coding Tablet

## Overview

Build the SVITOO V13_B tablet into a touch-first command center for coding agents. The tablet will provide a local Termux toolbox and installable web hub, while the full agent runtimes execute on Paul's Windows workstation over a private Tailscale connection. The hub will show every agent's health, capabilities, **Best for**, **Do not use for**, launch actions, sessions, tasks, approvals, and mediated inter-agent handoffs. New agents will be added through versioned manifests instead of hard-coded UI changes.

## Verified Device Baseline

- Device: SVITOO V13_B / V13_B_US
- Android: 16, API 36, security patch 2026-04-05
- CPU: 64-bit Unisoc T7300 / UMS9360, 8 cores
- Memory: 8 GB physical RAM, about 5 GB available during inspection
- Storage: about 108 GB free of 112 GB user storage
- Display: 1600 x 2240 at 343 dpi
- Kernel/page size: Android 15-derived 6.6 kernel, 4 KiB pages
- Boot state: production build, SELinux enforcing, bootloader locked, verified boot green
- Existing tablet foundation: Google Play present; Termux and Tailscale not installed

## Architecture Decisions

1. **Use a hybrid architecture.** Android is the command surface and portable shell; Windows is the execution host for desktop-only or unsupported agent runtimes.
2. **Do not require root.** The bootloader exposes a minimal fastboot implementation, does not implement the standard unlock-capability query, and no verified stock firmware or boot image is available. Rooting now would create wipe/brick risk without unlocking a required hub feature.
3. **Use Tailscale as the only remote network path.** The hub server binds locally and is exposed to the tablet through Tailscale HTTPS/MagicDNS. It is not opened directly to the public internet.
4. **Keep provider credentials on the Windows host.** The tablet receives a scoped hub session, never a copy of every agent/API credential.
5. **Use npm workspaces and shared TypeScript contracts.** Proposed layout:

   ```text
   apps/hub-web/         touch-first installable PWA
   apps/hub-server/      local Windows control plane
   packages/contracts/   agent, task, event, and approval schemas
   config/agents/        extensible agent manifests
   docs/                 research, security, and operator guides
   tasks/                implementation plan and checklist
   ```

6. **Use a manifest-driven agent catalog.** Every manifest includes identity, runtime location, availability probe, launch modes, capabilities, best uses, prohibited/poor uses, required approvals, and supported handoff types.
7. **Mediate agent-to-agent communication.** Agents exchange bounded task/handoff envelopes through the hub. There is no unrestricted autonomous group chat. Every chain has an owner, hop limit, time-to-live, idempotency key, workspace boundary, and approval policy.
8. **Preserve each vendor's native surface.** The hub launches or embeds supported web/terminal surfaces; it does not pretend Antigravity's desktop IDE is a native Android app.
9. **Separate agents from models.** An agent is a harness with tools, workspace access, operating rules, and approvals. A model is a reasoning engine. The router selects an `(agent, model, tool profile)` candidate so a model can be auditioned without silently inheriting broad agent authority.
10. **Make delegation explainable and bounded.** A planner may propose a dependency graph, but a policy engine validates its authority, budget, size, and cycles before a durable scheduler runs it. Every assignment shows its reasons, alternatives, predicted cost, confidence, and override control.
11. **Route from evidence, not a single leaderboard.** Raw-model, agent-harness, and full-workflow benchmarks remain separate. Versioned category-specific routing profiles use reproducible quality, safety, reliability, cost, and latency evidence, and require explicit promotion before influencing automatic routing.

## Dependency Graph

```text
Device + private network baseline
              |
       Shared contracts
              |
        Agent registry
          /       \
  Hub API/store   Hub PWA
          \       /
        Agent adapters
          /         \
 OpenRouter adapter  Task/handoff bus
          \         /
     Planner + policy + router
              |
       Benchmark evidence
              |
       Tablet installation + QA
```

## Task List

### Phase 1: Safe Tablet Foundation

#### Task 1: Record the recoverable device baseline

**Description:** Preserve hardware, Android, storage, boot, ADB, and fastboot evidence before installing tools.

**Acceptance criteria:**
- Device inventory contains no account tokens, personal files, or private app list.
- ADB authorization and normal reboot are verified.
- Root decision and recovery limitation are documented.

**Verification:**
- `adb devices -l` reports the exact serial as `device`.
- `getprop sys.boot_completed` returns `1` after the bootloader audit.

**Dependencies:** None

**Files likely touched:** `docs/device-baseline.md`

**Estimated scope:** S

#### Task 2: Install the Android developer foundation

**Description:** Install official-source Termux for arm64, Tailscale, and the supported OpenClaw Android node/client. Configure Android battery settings so only the required services can remain active.

**Acceptance criteria:**
- Every APK comes from Google Play or a verified upstream release with recorded checksum/source.
- Termux can run Git, SSH, Node, Python, ripgrep, tmux, and a Debian proot environment.
- Tailscale joins Paul's existing tailnet without exposing the hub publicly.

**Verification:**
- Package/version checks pass on the tablet.
- SSH and HTTPS connectivity to the Windows MagicDNS name succeed.
- Reboot test confirms required apps recover cleanly.

**Dependencies:** Task 1

**Files likely touched:** `docs/tablet-setup.md`, `scripts/tablet/verify-foundation.sh`

**Estimated scope:** M

### Checkpoint: Foundation

- ADB is healthy after reboot.
- The tablet remains locked, verified, and SELinux enforcing.
- No API keys are stored in repository files or Android shared storage.

### Phase 2: Hub Core

#### Task 3: Define agent and handoff contracts

**Description:** Create strict TypeScript schemas for agent manifests, health, sessions, tasks, messages, artifacts, approvals, and errors.

**Acceptance criteria:**
- Invalid manifests and unbounded messages fail validation.
- Contracts include versioning, capability IDs, risk level, and approval requirements.
- Handoffs include objective, provenance, limitations, authority, requested action, and definition of done.

**Verification:**
- Contract tests cover valid and malicious/oversized inputs.
- Type checking and schema fixtures pass.

**Dependencies:** Task 1

**Files likely touched:** `packages/contracts/src/*`, `packages/contracts/test/*`

**Estimated scope:** M

#### Task 4: Build the registry and health API

**Description:** Load agent manifests and expose a read-only catalog/health API backed by local SQLite for runtime status history.

**Acceptance criteria:**
- Adding a manifest adds a hub card without UI source changes.
- Health probes are bounded, timed out, and cannot execute arbitrary manifest commands.
- Secrets and command lines are redacted from responses and logs.

**Verification:**
- API and persistence tests pass.
- Missing, offline, degraded, and ready states are demonstrated.

**Dependencies:** Task 3

**Files likely touched:** `apps/hub-server/src/*`, `config/agents/*.yaml`

**Estimated scope:** M

#### Task 5: Build the installable tablet PWA

**Description:** Create a large-touch dashboard with agent cards, filters, status, best-use/do-not-use guidance, task inbox, approvals, and launch actions.

**Acceptance criteria:**
- The 1600 x 2240 tablet layout works in portrait, landscape, split-screen, and installed-PWA modes.
- All core actions are keyboard, touch, and screen-reader accessible.
- Offline mode shows cached catalog/help but disables unsafe actions.

**Verification:**
- Browser tests cover Android-sized viewports and keyboard navigation.
- PWA install, update, offline, and reconnect paths work.

**Dependencies:** Tasks 3 and 4

**Files likely touched:** `apps/hub-web/src/*`, `apps/hub-web/public/*`

**Estimated scope:** M

### Checkpoint: Hub Core

- Catalog and health work end-to-end with fixture agents.
- Security tests show the browser cannot submit arbitrary shell commands.
- The PWA is installable on the tablet.

### Phase 3: Agent Adapters

#### Task 6: Integrate Hermes and OpenClaw gateways

**Description:** Prefer their supported HTTP/gateway capabilities for long-lived sessions, messaging, memory, and agent fleets.

**Acceptance criteria:**
- Capabilities and health are discovered rather than assumed.
- Existing profiles and memories remain isolated by owner.
- Gateway tokens stay on the Windows host and are never returned to the PWA.

**Verification:**
- Start, stream, stop, and resume flows work through bounded test sessions.
- Failure/restart behavior is visible in the hub.

**Dependencies:** Tasks 3 and 4

**Files likely touched:** `apps/hub-server/src/adapters/hermes.ts`, `apps/hub-server/src/adapters/openclaw.ts`

**Estimated scope:** M

#### Task 7: Integrate Codex and Claude Code

**Description:** Add PTY-backed adapters on Windows with one workspace/worktree per task, explicit approval modes, streaming output, cancellation, and cleanup.

**Acceptance criteria:**
- Neither adapter can escape its assigned workspace through hub-supplied paths.
- Users can see model, approval mode, working directory, and live state before launch.
- Cancellation terminates the exact child process tree without affecting unrelated sessions.

**Verification:**
- Fixture repositories prove edit/test/diff workflows for both agents.
- Adversarial path, output-bound, timeout, and cancellation tests pass.

**Dependencies:** Tasks 3 and 4

**Files likely touched:** `apps/hub-server/src/adapters/codex.ts`, `apps/hub-server/src/adapters/claude.ts`

**Estimated scope:** M

#### Task 8: Integrate Antigravity launch and status

**Description:** Represent Antigravity and Antigravity IDE honestly as Windows desktop tools. Provide availability, best-use guidance, safe project launching, and remote-desktop/deep-link options where supported.

**Acceptance criteria:**
- Hub never claims a native Android Antigravity IDE installation.
- Project paths are allowlisted and quoted safely.
- Unsupported headless operations are visibly unavailable.

**Verification:**
- A safe test project launches on Windows.
- Offline/closed states render correctly on the tablet.

**Dependencies:** Tasks 3 and 4

**Files likely touched:** `apps/hub-server/src/adapters/antigravity.ts`, `config/agents/antigravity.yaml`

**Estimated scope:** S

### Phase 4: Inter-Agent Work

#### Task 9: Add the mediated task and handoff bus

**Description:** Let an authorized user or agent send structured work to another agent and receive status, artifacts, and evidence without uncontrolled recursive chatter.

**Acceptance criteria:**
- Sender/receiver ACLs, hop limits, TTLs, idempotency, payload limits, and approval gates are enforced.
- Agents cannot grant themselves broader authority or forward secrets.
- Every handoff has a durable audit trail and can be stopped by the user.

**Verification:**
- Unit and integration tests cover success, duplicate delivery, cycles, timeout, cancellation, unauthorized routing, and oversized output.
- A Hermes-to-Codex-to-Claude review workflow completes in a disposable repository.

**Dependencies:** Tasks 4, 6, and 7

**Files likely touched:** `apps/hub-server/src/bus/*`, `apps/hub-web/src/features/tasks/*`

**Estimated scope:** M

#### Task 10: Add bounded intent decomposition and delegation

**Description:** Turn a plain-language objective into a small dependency graph, validate it against policy and budget, rank eligible `(agent, model, tool profile)` candidates, and schedule dependency-ready work.

**Initial safety bounds:**
- At most 16 work items, decomposition depth 2, and 3 concurrent tasks.
- At most 2 attempts with one candidate and 2 cross-agent handoffs per work item.
- Four-hour plan TTL unless Paul extends it.
- No automatic push, deploy, purchase, external message, or credential change.
- Child authority must be a strict subset of parent authority.

**Acceptance criteria:**
- Cyclic, oversized, over-budget, or authority-expanding plans fail before execution.
- Each proposed assignment shows selection reasons, alternatives, expected cost, confidence, and required approvals.
- Paul can revise, pin, override, approve, or cancel a plan or assignment.
- Verification failure triggers at most one corrective attempt before a bounded alternate handoff.

**Verification:**
- A multi-part feature request becomes research, implementation, testing, and review tasks with valid dependencies.
- Tests cover cycles, unavailable agents, budget exhaustion, authority escalation, cancellation, retry, and handoff limits.

**Dependencies:** Tasks 3, 4, 6, 7, and 9

**Files likely touched:** `apps/hub-server/src/orchestration/*`, `apps/hub-web/src/features/plans/*`, `packages/contracts/src/orchestration/*`

**Estimated scope:** L

### Phase 5: Model Audition and Evidence

#### Task 11: Add the host-side OpenRouter adapter

**Description:** Add OpenRouter as a model provider for response-only auditions and a restricted disposable-repository tool loop. Keep the inference key on Windows and snapshot the live model catalog before estimating cost or dispatching work.

**Acceptance criteria:**
- The PWA cannot supply an API origin, authorization header, or raw secret reference.
- New models start in audition-only state and cannot receive write-capable tools without approval.
- Requests enforce model/provider allowlists, timeouts, output limits, privacy policy, no silent fallback, and an atomic dollar reservation.
- Requested model, actual model, provider, generation ID, tokens, latency, catalog snapshot, and actual cost are recorded without prompt secrets.

**Verification:**
- Malformed provider responses, stale pricing, unsupported parameters, rate limits, timeout, cancellation, and insufficient budget all fail safely.
- Secret scans confirm the OpenRouter key never reaches Android storage, responses, events, logs, SQLite, or the repository.

**Dependencies:** Tasks 3, 4, and 10

**Files likely touched:** `apps/hub-server/src/providers/openrouter/*`, `apps/hub-web/src/features/auditions/*`, `packages/contracts/src/providers/*`

**Estimated scope:** M

#### Task 12: Build the reproducible benchmark lab

**Description:** Benchmark raw models, agent/model harnesses, and delegated workflows separately across task categories, then produce versioned routing evidence.

**Acceptance criteria:**
- Fixtures are immutable, disposable, licensed/provenanced, and split into development, validation, and private holdout sets.
- Formal runs pin model/provider where possible, disable fallback and caching, reset state, randomize balanced order, and record environment hashes.
- Deterministic build/test/schema/safety scoring is primary; subjective results use blinded pairwise human review.
- A critical safety violation disqualifies a candidate from automatic routing regardless of average quality or cost.
- Production feedback is stored separately and never rewrites benchmark history.

**Verification:**
- Each candidate runs at least three repetitions and reports pass@1, success rate, median/p95 latency and cost, variance, tool use, and safety failures.
- Private holdouts are absent from prompts, memory, retrieval, examples, and routing context.
- Promotion requires enough current category evidence and Paul's explicit approval.

**Dependencies:** Tasks 10 and 11

**Files likely touched:** `apps/hub-server/src/benchmarks/*`, `apps/hub-web/src/features/benchmarks/*`, `packages/contracts/src/benchmarks/*`, `benchmarks/*`

**Estimated scope:** L

### Phase 6: Extensibility and Release

#### Task 13: Add plug-in onboarding for future agents

**Description:** Provide a validated manifest template, adapter interface, compatibility test kit, and UI preview for adding more agents later.

**Acceptance criteria:**
- A fixture agent can be added without changing hub UI code.
- Missing security/help metadata blocks activation.
- Removal disables launches while preserving audit history.

**Verification:**
- Plug-in conformance suite passes for every built-in adapter.

**Dependencies:** Tasks 3, 4, 9, 10, and 12

**Files likely touched:** `packages/adapter-sdk/*`, `config/agents/_template.yaml`, `docs/add-an-agent.md`

**Estimated scope:** M

### Checkpoint: Complete

- Hub is installed on the tablet and reachable only over the private network.
- Hermes, Codex, Claude Code, OpenClaw, and Antigravity show truthful status and guidance.
- At least one real coding task and one delegated cross-agent reviewed workflow complete with evidence.
- At least one OpenRouter model audition and reproducible benchmark comparison complete within an approved budget.
- Reboot, update, offline, cancellation, and backup/restore checks pass.

## Initial Agent Guidance

| Agent | Best for | Do not use for |
|---|---|---|
| Hermes | Long-lived personal agents, memory, scheduled work, multi-channel continuity | Unreviewed production changes or tiny deterministic commands |
| Codex | Repository implementation, debugging, tests, Git workflows, bounded machine work | Personal-assistant messaging or broad unsandboxed automation |
| Claude Code | Architecture, code comprehension, review, and large-context refactors | Always-on scheduling or acting as the message gateway |
| OpenClaw | Remote messaging, agent fleets, channel routing, and mobile node workflows | Giving every chat sender privileged shell access |
| Antigravity | Interactive visual agent development and Windows IDE workflows | Headless Android execution or unattended server automation |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Android kills background processes | High | Use the tablet mainly as a client; exempt only required apps from battery optimization |
| Unsupported desktop binaries on Android | High | Run them on Windows; use Termux/proot only for explicitly verified local tools |
| Obscure bootloader and no stock firmware | High | Keep the tablet locked; revisit root only after obtaining verified matching firmware and a restore test |
| Credential sprawl | High | Host-side credential vaults, scoped sessions, redaction, no secrets in manifests or shared storage |
| Runaway agent-to-agent loops | High | Hop budgets, TTL, ACLs, cost/time limits, idempotency, and user stop/approval controls |
| Host machine unavailable | Medium | Clear offline UX; allow local Termux work and queued tasks without claiming remote agents are ready |
| Tool/version drift | Medium | Version probes, compatibility metadata, and explicit degraded/unsupported states |

## Non-Blocking Product Choices

- Working repository name: `monster-ai-tablet`
- Working UI name: **Monster Agent Hub**
- Both names and the visual theme can be changed later without affecting contracts or adapters.
