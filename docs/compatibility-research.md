# Android “Monster AI Coding Tablet” compatibility research

**Research date:** 2026-08-30

**Scope:** Termux, OpenAI Codex CLI, Anthropic Claude Code, Nous Research Hermes Agent, OpenClaw, and Google Antigravity.

**Source policy:** Official documentation and official project repositories only. Reports in an official repository's issue tracker are identified as issue reports, not vendor support guarantees.
**Device impact:** Research only. No application, package, ADB setting, account, or device state was changed.

## Decision

The tablet can become an excellent AI coding **command center**, but it should not be designed as the only machine running every agent.

Use a hybrid architecture:

- Run a lightweight hub UI, SSH client, Git utilities, and optionally Hermes directly on the tablet.
- Run Codex, Claude Code, OpenClaw Gateway, and Antigravity on supported Windows/Linux hosts and drive them from their official remote/mobile surfaces or tightly scoped hub adapters.
- Keep repositories, builds, browser automation, long-running gateways, and provider credentials on the host whenever possible.
- Treat the tablet as the console and approval surface; treat the host as the execution and secret boundary.

This is not just a performance preference. Android/Termux uses Android's Bionic environment rather than a normal desktop GNU/Linux environment. A vendor publishing a `linux-arm64` binary does **not** automatically make it an Android binary. Current official-repository reports show this exact mismatch for [Codex](https://github.com/openai/codex/issues/37262), [Claude Code](https://github.com/anthropics/claude-code/issues/50270), and [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli/issues/41).

## Compatibility matrix

| Product | Official Android role | Native Termux status | Host required? | Recommended placement |
|---|---|---|---|---|
| **Termux** | Native Android terminal/userland | Supported on Android 7+; install only from an official source and do not mix app/plugin signing sources | No | Tablet foundation for SSH, Git, small scripts, and Hermes |
| **Hermes Agent** | Full local CLI is documented | **Yes, Tier 2 / best effort, aarch64 only** | No for the core CLI; recommended for durable gateway/browser/voice work | Local tablet CLI plus optional host-based durable Hermes profile |
| **OpenClaw** | Official Android **companion node** | Gateway-in-Termux is not the official Android design | **Yes** for the Gateway | Android app on tablet; Gateway on Linux/WSL2 or another supported host |
| **OpenAI Codex** | Official ChatGPT mobile Remote controller | Not a supported/reliable native Termux target; current packaging and filesystem-lock issue reports remain open | **Yes** for supported local/remote execution | Codex on Windows/Linux; ChatGPT Android Remote or hub deep-link on tablet |
| **Claude Code** | Official Claude mobile/browser Remote Control | Android is absent from the support matrix; current native-binary packaging is incompatible with Termux | **Yes** for supported local execution | Claude Code on Linux/Windows; Claude Android/browser Remote Control on tablet |
| **Google Antigravity IDE** | Official browser-based Remote Control works from mobile | No Android IDE build | **Yes** | IDE/daemon on Windows/Linux/macOS; Remote Control PWA on tablet |
| **Google Antigravity CLI (`agy`)** | No official Android target | Officially macOS/Linux/Windows; Termux support request exists | **Yes** for a supported installation | CLI on Windows/Linux; SSH terminal or Antigravity Remote Control from tablet |

### What “host required” means

It does not mean every task needs a cloud server. Paul's existing Windows 11 machine can be the first host. WSL2 or a small always-on Linux machine is useful where Linux sandboxing, `systemd`, browser automation, or a durable gateway is required. A separate purchase is not necessary for the first implementation.

## Product-by-product findings

### 1. Termux

**Verified facts**

- The official Termux application supports Android 7 and newer. Its maintainers warn not to mix APKs and plugins from different sources because they use different signing keys. See the official [Termux installation guidance](https://github.com/termux/termux-app#installation).
- Termux packages include current Node.js and Rust toolchains, but the existence of those packages does not override an upstream application's OS/ABI support. For example, the official Termux package repository currently carries [Node.js](https://github.com/termux/termux-packages/blob/master/packages/nodejs/build.sh), and documents on-device Rust installation through `pkg install rust` in its [Rust setup code](https://github.com/termux/termux-packages/blob/master/scripts/build/setup/termux_setup_rust.sh).
- `proot-distro` can run an ARM64 Linux userland without root, but it is not a VM or security sandbox. It intercepts syscalls through `ptrace`, is slower for filesystem-heavy work, has no real root, cgroups, namespaces, or normal init system, and cannot provide Docker-style isolation. See the official [PRoot-Distro limitations](https://github.com/termux/proot-distro#limitations).

**Recommendation**

Use Termux for:

- SSH and terminal access to hosts
- Git inspection and small edits
- hub maintenance and diagnostics
- the officially documented Hermes Termux install
- emergency access when a graphical remote client is unavailable

Do not use Termux/proot as the security boundary for mutually untrusted agents, a Docker replacement, or the only home for long-running production gateways.

### 2. Hermes Agent

**Verified support**

Hermes is the strongest native-tablet candidate in this set. Nous Research lists **Android (Termux) aarch64** as Tier 2: maintained in-tree on a best-effort basis, but releases can break it. The official [platform matrix](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/platform-support.md) distinguishes it from Tier 1 Linux, Windows, macOS, and Docker.

The official [Hermes Termux guide](https://hermes-agent.nousresearch.com/docs/getting-started/termux) documents:

- working local CLI, cron, PTY/background terminals, MCP, ACP, Honcho memory, and best-effort Telegram gateway support;
- Python plus `git`, `clang`, `rust`, `make`, `pkg-config`, `libffi`, `openssl`, `ripgrep`, and `ffmpeg` for the explicit path;
- `python -m venv` and pip rather than `uv` on Android;
- the curated `.[termux]`/`.[termux-all]` extras rather than `.[all]`;
- no tested local voice extra, no Docker backend, browser bootstrap skipped by default, and possible Android suspension of background gateway jobs.

The same guide says the one-line installer is Termux-aware, but it also labels the platform Tier 2. The community APT repository described on that page is explicitly not built, signed, hosted, or audited by Nous Research; it should not be the default for this project.

**Best use**

- Persistent personal agent and memory
- A native on-tablet agent for SSH, code reading, planning, and coordination
- MCP/ACP bridge into the hub
- Delegation to isolated Hermes subagents

Hermes can run as an MCP server with `hermes mcp serve`, and its ACP mode lets another compatible harness own the conversation transport while Hermes retains its model, memory, skills, and tools. See the official [Hermes CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands/) and [ACP integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp).

**Do not use on the tablet for**

- full local browser/Playwright automation as a baseline
- voice transcription via `faster-whisper`
- Docker-isolated execution
- a gateway that must survive Android battery management without supervision

### 3. OpenClaw

**Verified support**

There is naming ambiguity in the wider internet, so this report means the official [`openclaw/openclaw`](https://github.com/openclaw/openclaw) project and `docs.openclaw.ai` product.

OpenClaw's official [Android documentation](https://github.com/openclaw/openclaw/blob/main/docs/platforms/android.md) is explicit:

- the Android app is a **companion node**;
- Android does **not** host the Gateway;
- a Gateway must run on macOS, Linux, or Windows via WSL2;
- the official app is distributed through Google Play and supported GitHub releases.

The Gateway/CLI currently requires one of the documented Node lines—22.22.3+, 24.15+, or 25.9+, with Node 26 recommended—and supports macOS, Linux, and Windows. See the official [install page](https://docs.openclaw.ai/install).

**Best use**

- The shared agent roster and message-routing layer
- Long-running, channel-connected agents
- Separate agent workspaces, credentials, and session stores
- Android device-node capabilities and a tablet chat surface

OpenClaw's official [multi-agent design](https://github.com/openclaw/openclaw/blob/main/docs/concepts/multi-agent.md) runs isolated agents in one Gateway, each with its own workspace, state directory, auth profile, and session history. That is a useful foundation for the requested “agents hub,” but it is OpenClaw's internal agent model—not proof that every external proprietary CLI can safely share one session or credential store.

**Do not use for**

- Hosting the Gateway directly on Android as the supported architecture
- Sharing one `agentDir`, OAuth store, or workspace across agents
- Exposing Gateway bearer credentials to the hub frontend: OpenClaw documents that HTTP bearer auth is effectively full operator access. See [Gateway security](https://docs.openclaw.ai/gateway/security).

### 4. OpenAI Codex

**Verified desktop/Linux support**

Codex publishes standalone binaries for macOS and Linux, including `aarch64-unknown-linux-musl`, and also supports npm installation. The standalone binary does not need Node at runtime; npm installation does. Rust is needed only to build from source. See the official [Codex repository install section](https://github.com/openai/codex#installing-and-running-codex-cli) and [build requirements](https://github.com/openai/codex/blob/main/docs/install.md).

The documented system requirements list macOS 12+, Ubuntu 20.04+/Debian 10+, or Windows 11 via WSL2—not Android.

**Native Termux assessment**

Do not make native Termux Codex a launch requirement. An open August 2026 issue in the official repository reports that Node identifies Termux as `android/arm64`, while the required optional npm package is published for `linux/arm64`, so the CLI cannot start. A separate open report documents Android filesystem locking failure in `codex exec`. These are current issue reports rather than a vendor support statement, but they align with the published system requirements: [package mismatch #37262](https://github.com/openai/codex/issues/37262), [filesystem locking #26277](https://github.com/openai/codex/issues/26277).

**Recommended tablet path**

OpenAI officially supports ChatGPT Remote on Android for work running on a connected Mac or Windows host. The phone/tablet sends prompts and approvals, while projects, files, credentials, tools, and commands stay on the host. The relay does not require a public inbound listener. See [Remote connections](https://learn.chatgpt.com/docs/remote-connections).

This is the preferred Codex tile in the hub: open the official ChatGPT Remote surface or deep-link to it. If the code lives on Linux, connect the ChatGPT desktop host to the Linux environment over SSH using least-privilege keys; the official remote guide supports that topology.

**Best use**

- Repository implementation, refactoring, testing, and code review
- Work that benefits from Codex permissions, plugins, worktrees, and host toolchains
- Remote supervision and approvals from Android

**Do not use for**

- A required native Termux runtime
- A shared plaintext credential file copied among agents
- Directly exposing `codex app-server` to the public internet

### 5. Anthropic Claude Code

**Verified desktop/Linux support**

Claude Code officially supports macOS 13+, Windows 10 1809+, Ubuntu 20.04+, Debian 10+, and Alpine 3.19+, on x64 or ARM64 with at least 4 GB RAM. Android is not in that matrix. See the official [Claude Code installation page](https://code.claude.com/docs/en/installation).

The recommended native installer does not require Node. The optional npm route now requires Node.js 22+ and installs the same platform-native binary; its documented npm targets include Linux ARM64 but not Android ARM64.

An open issue in Anthropic's official repository reports that the current native binary cannot execute in Termux because Android reports a different platform and uses Bionic rather than the glibc Linux target. The report notes that proot Ubuntu can launch it, but slowly. This is issue evidence, not an official support promise: [anthropics/claude-code#50270](https://github.com/anthropics/claude-code/issues/50270).

**Recommended tablet path**

Claude Code has an official [Remote Control](https://code.claude.com/docs/en/remote-control) mode for the Claude Android app or any browser. The session continues to run on the host with its filesystem, MCP servers, tools, and project settings. The host makes outbound HTTPS connections and does not open an inbound port. Remote Control requires a Claude subscription login; API keys are not supported for that feature.

**Best use**

- Deep codebase understanding and architectural work
- Careful implementation and review with explicit permissions
- Remote steering of an existing host session

**Do not use for**

- Latest-version native Termux installation
- Feeding Claude.ai subscription/OAuth tokens into a custom cross-agent broker
- Unattended “bypass permissions” execution on a shared host

Anthropic explicitly says third-party products should use API-key authentication rather than route users through Free/Pro/Max subscription credentials. The hub should launch or link to the official Claude client, never capture its OAuth tokens. See [Claude Code legal and authentication guidance](https://code.claude.com/docs/en/legal-and-compliance).

### 6. Google Antigravity

**Name ambiguity resolved**

“Antigravity” can refer to three different Google artifacts:

1. **Antigravity IDE / Antigravity 2.0**, the desktop coding environment.
2. **Antigravity CLI**, the native `agy` terminal client.
3. **Google Antigravity SDK**, a separate Python SDK whose PyPI wheels include a compiled runtime. Installing that SDK does not install the IDE or CLI. See its official [SDK repository](https://github.com/google-antigravity/antigravity-sdk-python).

For this tablet, the relevant entries are the IDE and CLI; the SDK is optional future developer infrastructure.

**IDE support**

The IDE's official [getting-started page](https://antigravity.google/docs/ide-getting-started) lists macOS, Windows 10 64-bit, and glibc-based Linux. It does not list Android. Antigravity's official [Remote Control](https://antigravity.google/docs/remote-control/) lets any web browser—including a mobile home-screen PWA—control an Antigravity 2.0 session running on a host. It preserves the host's filesystem and toolchains and uses the same Google Account on both ends.

**CLI support**

The official [CLI install/auth guide](https://antigravity.google/docs/cli/install/) says `agy` runs natively on macOS, Linux, and Windows. It is a standalone native client; the published installation path does not require Python, Node, or Rust. It supports a browser sign-in locally, a manual OAuth URL/code flow over SSH, or a Gemini API key selected explicitly in settings.

Android/Termux is not an official target. A Termux request in the official CLI repository was closed as a duplicate of the Android support request, and its description records that the official installer did not work there: [google-antigravity/antigravity-cli#41](https://github.com/google-antigravity/antigravity-cli/issues/41). Do not base the build on third-party patched Antigravity binaries.

**Best use**

- Google/Gemini-centric coding workflows
- IDE-based artifact and browser verification
- Built-in subagents and agent management on a supported host
- Remote Control from the tablet

**Do not use for**

- Installing the desktop IDE on Android
- Treating the Python SDK as the IDE/CLI
- Native Termux as a required path
- Persisting `GEMINI_API_KEY` in the hub manifest or Android shell profile

## ARM64 and runtime constraints

The tablet must be inventoried before installation. `arm64-v8a`/`aarch64` is likely but not yet verified.

| Concern | Consequence |
|---|---|
| **CPU architecture** | Hermes' documented Termux path is aarch64 only. A 32-bit userspace or ARMv7 device changes the plan. |
| **Android ABI** | Linux ARM64 binaries may depend on glibc or musl assumptions that Android/Bionic does not meet. Codex, Claude Code, and Antigravity currently demonstrate this risk. |
| **RAM** | Claude Code documents a 4 GB minimum. Concurrent local agents, compilers, and proot can cause Android process eviction even when installation succeeds. |
| **Storage** | Python/Rust builds, npm caches, repositories, and proot root filesystems can consume many gigabytes. Free space must be measured first. |
| **Battery/process policy** | Android may suspend Termux background work; Hermes documents gateway persistence as best effort on Android. |
| **proot** | Useful compatibility fallback, but slower and not isolated; unsuitable as the main multi-agent security boundary. |

Read-only device inventory for the implementation phase should capture at least:

```text
adb shell getprop ro.product.manufacturer
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.product.cpu.abi
adb shell cat /proc/meminfo
adb shell df -h /data
```

No result from those commands is assumed in this report.

## Authentication and secret risks

### Rules for the hub

1. **The frontend never stores secrets.** Its agent catalog contains secret references or an `authStatus`, never API keys, OAuth refresh tokens, cookies, passwords, or SSH private keys.
2. **Use native sign-in surfaces.** Codex, Claude, and Antigravity tiles should open their official app/web authentication flows. The hub should not proxy or scrape subscription OAuth.
3. **Keep provider secrets on the execution host.** Use an OS keyring or a host-side secret service. Give each agent its own OS account or credential directory where practical.
4. **Use per-agent workspaces/worktrees.** Never point multiple autonomous agents at the same writable Git working tree.
5. **Keep default permissions conservative.** Read and plan by default; require approval for writes, commands, network expansion, deployment, purchases, and credential changes.
6. **Do not expose raw agent control ports publicly.** Use official relays or a private authenticated network. SSH must use trusted keys, least-privilege accounts, and no unauthenticated listener, matching OpenAI's [remote-host guidance](https://learn.chatgpt.com/docs/remote-connections).

### Product-specific storage facts

- **Codex:** its configuration supports keyring, file, auto-fallback, or process-ephemeral credential storage. File mode persists credentials under `CODEX_HOME/auth.json`; a tablet/headless environment may lack a usable desktop keyring. See the official [Codex configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).
- **Claude Code:** Linux credentials are stored in `~/.claude/.credentials.json` with mode `0600`; Windows uses the user profile ACL. See [Claude authentication](https://code.claude.com/docs/en/authentication).
- **Hermes:** provider settings can live in `~/.hermes/.env`, while conversations, memory, and skills are local under `~/.hermes/`. Treat the entire directory as private. See the official [Hermes FAQ](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/faq.md).
- **OpenClaw:** `~/.openclaw/` may include Gateway tokens, channel credentials, OAuth refresh tokens, and SQLite state. The official [security guide](https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md) recommends dedicated users/hosts and separate gateways across trust boundaries.
- **Antigravity CLI:** local login uses the OS keyring; SSH uses a manual browser code flow; Gemini API-key mode reads `GEMINI_API_KEY` from the environment. Use OAuth on an interactive host or a secret-injection mechanism—not a tablet `.bashrc`—for API-key mode. See [Antigravity CLI authentication](https://antigravity.google/docs/cli/install/).

### ADB

Developer mode and ADB are useful for initial deployment and diagnostics but are not required for normal hub operation. Android documents that an authorized workstation remains paired until it is forgotten or debugging authorizations are revoked. Keep wireless debugging off when it is not actively needed, do not select “always allow” on an untrusted network, and periodically remove stale paired workstations. See the official [Android hardware-device/ADB guide](https://developer.android.com/studio/run/device).

## Recommended hybrid architecture

```text
Android tablet
├── Monster Hub PWA / Android wrapper
│   ├── agent catalog: Best For / Do Not Use For / host / health
│   ├── task inbox, approvals, evidence, notifications
│   └── deep links to official Codex, Claude, Antigravity, OpenClaw surfaces
├── Termux
│   ├── SSH + Git + diagnostics
│   └── Hermes Tier-2 local profile (optional)
└── Official companion apps
    ├── ChatGPT Remote
    ├── Claude Remote Control
    ├── Antigravity Remote Control PWA
    └── OpenClaw Android node

Private/official remote transport
├── Vendor relays for Codex, Claude, and Antigravity
└── Private authenticated HTTPS/SSH for the custom hub and gateways

Execution hosts
├── Windows 11 host
│   ├── ChatGPT/Codex desktop Remote host
│   └── Antigravity IDE / Windows-only desktop integration
└── Linux or WSL2 worker host
    ├── OpenClaw Gateway
    ├── Claude Code and Codex CLI
    ├── durable Hermes gateway/profile
    └── per-agent users, worktrees, sandboxes, toolchains, and secrets
```

### Agent-to-agent hub

There is no verified universal “let all five proprietary clients freely talk to each other” switch. Implement a mediated task bus instead.

Each handoff should include:

- task ID and objective
- source and target agent
- repository and dedicated worktree
- allowed tools, paths, and network destinations
- read-only/write/commit/deploy authority
- input artifacts and provenance
- timeout/cancellation state
- requested deliverable and definition of done
- evidence: diff, tests, logs, commit, or report

The bus should pass task records and bounded artifacts, not raw credentials, unrestricted transcripts, or shared home directories. Use adapters:

- **Hermes:** MCP server or ACP process, both officially documented.
- **OpenClaw:** its Gateway and isolated multi-agent routing; cross-agent access only through explicit features/configuration.
- **Codex/Claude/Antigravity:** initially launch their official interactive/remote clients. Add programmatic adapters only through documented SDK, MCP, ACP, app-server, or headless interfaces and only after authentication terms and approval behavior are verified.

This preserves the customer's requested shared hub while avoiding a single compromised prompt, plugin, or skill inheriting every agent's secrets and authority.

## Hub catalog: initial “Best For / Do Not Use For” entries

| Agent | Best for | Do not use for |
|---|---|---|
| **Hermes** | Durable memory, personal workflows, scheduled work, model flexibility, native tablet coordination | Full tablet-local browser/voice/Docker stack; guaranteed always-on Android gateway |
| **OpenClaw** | Multi-agent roster, channels, mobile node, long-running Gateway routing | Gateway hosted on Android; agents sharing one auth/state directory |
| **Codex** | Hands-on repository changes, tests, refactors, review, worktrees | Required native Termux runtime; unreviewed production or financial actions |
| **Claude Code** | Deep codebase reasoning, architectural changes, careful review and implementation | Latest native Termux install; third-party reuse of Claude subscription OAuth |
| **Antigravity** | Google/Gemini workflows, IDE artifacts, browser validation, subagent orchestration | Android IDE install; patched unofficial Termux binary as a production dependency |
| **Termux shell** | SSH, Git, diagnostics, small scripts, recovery access | Security sandbox, Docker replacement, heavy parallel builds, durable daemon host |

## Recommended implementation sequence

1. **Inventory only:** verify tablet model, Android version, ABI, RAM, free space, keyboard/mouse support, and battery policy.
2. **Choose the execution boundary:** start with the existing Windows 11 machine; add WSL2/Linux for OpenClaw and stronger Linux sandboxing.
3. **Build the hub shell:** installable PWA with a data-driven agent catalog, health states, launch adapters, approvals, audit history, and an extension schema.
4. **Connect official remote surfaces first:** Codex Remote, Claude Remote Control, Antigravity Remote Control, and OpenClaw Android pairing.
5. **Pilot native Hermes only:** use the official Termux path, record the exact version, run `hermes doctor`, and test background suspension before enabling a gateway.
6. **Add the mediated task bus:** read-only handoffs first, then scoped write permissions in isolated worktrees.
7. **Add agents incrementally:** every new adapter must declare runtime, host, auth method, best use, prohibited use, permissions, health check, and uninstall/disable path.
8. **Adversarial verification:** test prompt injection, credential leakage, cross-workspace writes, stale remote pairing, revoked devices, offline hosts, concurrent edits, and recovery before calling the tablet operational.

## Unknowns that must be verified before installation

- Tablet manufacturer/model, Android version, ABI, RAM, free storage, and CPU features
- Whether the tablet has Google Play certification required by the chosen official apps
- Which ChatGPT, Claude, Google, and model-provider plans are active and whether Remote features are enabled for those accounts
- Whether the existing Windows host can remain awake and reachable
- Whether WSL2 is installed and suitable for an always-on OpenClaw Gateway
- Which repositories each agent may access and whether any contain regulated or customer-sensitive data
- Which actions require approval: writes, shell, Git push, deployment, messaging, purchases, or physical-device control

Until those are measured, the implementation should be considered **feasible and designed, but not device-verified**.
