# AI-Spy 🕵️‍♂️⚡

**Recon and command console for every AI agent, harness, and local model on your machine.**

AI-Spy scans your machine for the AI tools you already run — coding agents (Claude Code, Codex,
Copilot, Gemini CLI, Antigravity), local model runtimes (Ollama, LM Studio), IDEs, and dozens of others — and gives you one
green-phosphor terminal to see what you use, what you spend, what's gone stale, and to actually
*drive* them: launch local models, swap which model each runs, chat with any agent, and have Claude
orchestrate a task across the whole fleet.

Zero runtime dependencies. Plain Node (v18+). Cross-platform on **Linux**, **macOS**, and **Windows**. Your data never leaves your machine.

![terminal](https://img.shields.io/badge/UI-phosphor%20CRT-3bff77) ![deps](https://img.shields.io/badge/dependencies-0-3bff77) ![node](https://img.shields.io/badge/node-%E2%89%A518-3bff77)

---

## Quick start

```sh
git clone https://github.com/pkircher29/ai-spy.git
cd ai-spy
node server.mjs
```

Open **http://localhost:4177**. That's it — no build step, no `npm install`.

---

## What it does

| Page | What's there |
|---|---|
| **Status** | Machine-wide meters: sessions, API-equivalent value, active tools, idle model disk, spend alerts. |
| **Dispatch** | Give one prompt; Claude plans a route across your agents/models, you can edit it, then it executes each step on the best agent and synthesizes the answer. Past runs are saved and replayable. |
| **Terminal** | Direct 1:1 chat with any single agent (Claude, Codex, Ollama, LM Studio) — pick the model, hold a conversation. |
| **Garage** | Launch / restart local model servers, rename agents, edit descriptions, and load a different model into memory per agent (cross-platform Linux/Windows process management). |
| **Keyring** | Store API keys once, push them to your tools (env vars, this server, Hermes). Masked, gitignored, never sent back to the browser. |
| **Ledger** | Spend trends over time (daily/cumulative/monthly), model mix, and a projected month-end with editable budget alerts. |
| **Caps** | Subscriptions vs API-equivalent value, live usage/remaining where a provider exposes it (OpenRouter credits, Anthropic rate limits). |
| **Workshop** | Benchmark local models — first-token latency and tokens/sec on *your* hardware — so routing is data-driven. |
| **Map** | Discover agent services on this machine and your Tailscale mesh, each labeled with its address and live model list. |
| **Perks** | Inventory of skills, plugins, MCP servers, and subagents across harnesses, with usage counts and share/remove/audit directives you can run with one click. |
| **Inventory** | Every AI tool detected on the machine, with last-used and data footprint. |
| **Radio** | Ask the same question to every installed engine at once (consensus). |
| **Data / Log** | Per-model/project/day usage breakdown; recommendations log. |

---

## 🧪 Testing

AI-Spy includes a zero-dependency test suite using Node.js built-in `node:test` runner:

```sh
npm test
```

---

## 📄 License

MIT License.
