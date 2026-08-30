# Delegation, OpenRouter, and Benchmark Design

## Product boundary

Monster Agent Hub distinguishes an **agent** from a **model**:

- An agent is a harness with tools, workspace access, approval rules, memory boundaries, and an execution lifecycle.
- A model is a reasoning engine used by an agent or by a restricted one-off runner.
- A routing candidate is the versioned combination `(agent, model, tool profile)`.

This prevents a newly auditioned model from automatically receiving the authority of an established coding agent.

## Authority grants

Delegation payloads carry opaque, namespaced grant IDs—not filesystem paths,
network URLs, credentials, or executable commands. The Windows policy service
resolves `workspace.*`, `tool.*`, `network.*`, `credential.*`, and `action.*`
grants from trusted host configuration immediately before execution. This keeps
reparse-point resolution, credential lookup, and destination allowlisting out of
planner-controlled data. Every work item receives a strict subset of its parent
authority; equality is rejected.

## Delegation flow

```text
User intent
  -> planner proposes a bounded dependency graph
  -> policy engine validates graph, authority, approvals, and budget
  -> capability router ranks eligible candidates
  -> Paul approves or overrides where required
  -> durable scheduler runs dependency-ready tasks
  -> verifiers evaluate evidence
  -> bounded correction, retry, or alternate-agent handoff
  -> final synthesis reports evidence and unresolved issues
```

The planner is an untrusted proposer. It cannot approve spending, add tools or paths, expand authority, bypass limits, or perform consequential external actions.

Initial limits are 16 work items, depth 2, 3 concurrent tasks, 2 attempts per candidate, 2 handoffs per work item, and a four-hour plan TTL. Push, deployment, purchases, external messages, and credential changes always require a separate approval.

## Routing

Routing has two stages:

1. Hard-filter by runtime availability, capabilities, workspace, tool profile, authority, privacy, modality, context, and remaining budget.
2. Rank eligible candidates from category-specific evidence using a conservative confidence bound.

The UI shows selection reasons, alternatives, predicted cost, confidence, and the exact agent/model/tool combination. Routing profiles include `BEST_QUALITY`, `BALANCED`, `LOWEST_COST`, and `FASTEST_SAFE`; there is no universal best-model score.

Declared capabilities and measured results stay separate. New candidates start as `AUDITION`, then may become `ELIGIBLE`, `PREFERRED`, or `RETIRED` only through a versioned, auditable promotion decision.

## OpenRouter boundary

The OpenRouter adapter runs only on the trusted Windows host. Its inference key is stored through Windows credential protection and is never sent to the PWA, Android storage, source control, logs, events, or benchmark artifacts.

The first two modes are:

- `RAW_MODEL_AUDITION`: structured prompt/response with no tools.
- `SANDBOX_AGENT_AUDITION`: a controlled tool loop in a disposable repository with read-only or patch/test-only tools.

The adapter uses a fixed official API origin, validates every external response, snapshots the changing model catalog, disables silent model/provider fallback for formal comparisons, and records requested versus actual model/provider. See the official [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [model catalog API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), and [provider-routing controls](https://openrouter.ai/docs/guides/routing/provider-selection).

Budget enforcement is layered: a limited inference key, hub daily/monthly ceilings, per-intent and per-call limits, preflight worst-case estimates, an atomic reservation before dispatch, and settlement from returned usage. Provider unit-price ceilings do not replace the hub's total-dollar ledger. Current key limits and usage are verified through the official [key APIs](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key).

No paid OpenRouter request is sent until Paul sets the initial per-request, daily, and monthly limits and approves the credential setup.

## Benchmark lab

Three result sets remain separate:

1. Base-model audition without tools.
2. Agent harness: model plus agent loop and tools.
3. Full workflow: decomposition, delegation, implementation, verification, and synthesis.

Cases cover planning, research, implementation, debugging, review, testing, documentation, UI critique, tool selection, and adversarial safety. Deterministic evidence—hidden tests, builds, type checks, exact artifacts, citation validation, and out-of-scope activity—is primary. Subjective quality uses blinded pairwise human review; a model is never its sole judge.

Formal runs record immutable fixture SHA, catalog snapshot, model and provider, agent version, prompt hash, parameters, tool versions, environment hash, repetitions, tokens, cost, latency, artifacts, and policy violations. Fallback and response caching are disabled for formal comparisons; OpenRouter documents its [response caching controls](https://openrouter.ai/docs/guides/features/response-caching).

Private holdouts are excluded from agent memory, retrieval, examples, routing prompts, and other candidates' outputs. Public benchmarks are labeled as potentially contaminated. Any critical safety violation blocks automatic routing even when average quality or cost looks attractive.

## Promotion gate

A candidate is not automatically promoted from a single good run. The initial gate requires:

- At least 10 distinct cases in the relevant category.
- At least 3 repetitions per case.
- No critical safety failures.
- Evidence recent enough for the exact agent/model version.
- A meaningful quality improvement or a useful quality/cost/latency tradeoff.
- Paul's explicit approval to influence automatic routing.

Production acceptance and user ratings become separate evidence; they never rewrite historical benchmark results.
