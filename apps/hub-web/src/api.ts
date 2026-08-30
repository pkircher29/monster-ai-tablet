const PREVIEW_ENDPOINT = '/api/delegation/preview';
const ASSIGN_ENDPOINT = '/api/delegation/assign';
const AGENT_STATUS_ENDPOINT = '/api/agents/status';
const TOOL_RECON_ENDPOINT = '/api/recon/tools';
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_OBJECTIVE_LENGTH = 1_024;
const MAX_WORK_ITEMS = 16;
const MAX_ASSIGNMENT_REASONS = 8;
const MAX_BUDGET_MICRODOLLARS = 400_000;
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSIONED_PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}@[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const AGENT_IDS = ['hermes', 'codex', 'claude-code', 'openclaw', 'antigravity'] as const;

export type AgentId = (typeof AGENT_IDS)[number];
export type AgentConnectionState = 'READY' | 'DEGRADED' | 'OFFLINE' | 'UNSUPPORTED';
export type AgentStatusCode =
  | 'AVAILABLE'
  | 'AUTHENTICATED'
  | 'CONNECTED'
  | 'DESKTOP_ONLY'
  | 'UNAVAILABLE'
  | 'PROBE_TIMEOUT'
  | 'PROBE_FAILED';

export interface AgentRuntimeStatus {
  readonly id: AgentId;
  readonly state: AgentConnectionState;
  readonly statusCode: AgentStatusCode;
  readonly version: string | null;
}

export interface AgentStatusSnapshot {
  readonly schemaVersion: 1;
  readonly mode: 'READ_ONLY';
  readonly observedAt: string;
  readonly agents: readonly AgentRuntimeStatus[];
}

export interface AgentStatusRequestOptions {
  readonly signal?: AbortSignal;
}

export type AgentStatusRequester = (
  options?: AgentStatusRequestOptions,
) => Promise<AgentStatusSnapshot>;

export type ReconToolCategory = 'HARNESS' | 'IDE' | 'LOCAL_MODEL' | 'ASSISTANT' | 'INFRASTRUCTURE';
export type ReconToolDetection = 'PROFILE' | 'CLI' | 'BOTH';

export interface ReconToolSummary {
  readonly id: string;
  readonly name: string;
  readonly category: ReconToolCategory;
  readonly vendor: string;
  readonly detection: ReconToolDetection;
}

export interface ToolReconSnapshot {
  readonly schemaVersion: 1;
  readonly mode: 'READ_ONLY';
  readonly source: 'AI_SPY';
  readonly observedAt: string;
  readonly catalogCount: number;
  readonly installedCount: number;
  readonly tools: readonly ReconToolSummary[];
  readonly restrictedCapabilities: readonly [
    'COMMAND_EXECUTION_DISABLED',
    'KEY_MANAGEMENT_DISABLED',
    'NETWORK_SCAN_DISABLED',
  ];
}

export interface ToolReconRequestOptions {
  readonly signal?: AbortSignal;
}

export type ToolReconRequester = (options?: ToolReconRequestOptions) => Promise<ToolReconSnapshot>;

export interface DelegationPreviewRequest {
  readonly objective: string;
  readonly workspace: string;
  readonly budgetCapMicrodollars: number;
}

export interface DelegationPreviewRequestOptions {
  readonly signal?: AbortSignal;
}

export interface PreviewWorkItem {
  readonly id: string;
  readonly title: string;
}

export interface PreviewAssignment {
  readonly workItemId: string;
  readonly agentProfileId: string;
  readonly selectionReasons: readonly string[];
  readonly expectedCostMicrodollars: number;
  readonly confidence: number;
  readonly requiredApprovals: readonly string[];
}

export interface DelegationPreviewSummary {
  readonly objective: string;
  readonly workItems: readonly PreviewWorkItem[];
  readonly assignments: readonly PreviewAssignment[];
  readonly estimatedTotalCostMicrodollars: number;
}

export type DelegationPreviewRequester = (
  request: DelegationPreviewRequest,
  options?: DelegationPreviewRequestOptions,
) => Promise<DelegationPreviewSummary>;

export interface QueuedAssignmentItem {
  readonly workItemId: string;
  readonly title: string;
  readonly agentProfileId: string;
  readonly state: 'QUEUED';
}

export interface DelegationAssignment {
  readonly schemaVersion: 1;
  readonly mode: 'ASSIGNED';
  readonly assignmentId: string;
  readonly queuedAt: string;
  readonly objective: string;
  readonly items: readonly QueuedAssignmentItem[];
  readonly commandExecution: 'DISABLED';
}

export type DelegationAssignmentRequester = (
  request: DelegationPreviewRequest,
  options?: DelegationPreviewRequestOptions,
) => Promise<DelegationAssignment>;

export class HubApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HubApiError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function invalidResponse(): never {
  throw new HubApiError('INVALID_RESPONSE', 'The host returned an invalid preview response.');
}

function isSafeText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return false;
  }
  return true;
}

function boundedText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    !isSafeText(value)
  ) {
    return invalidResponse();
  }
  return value;
}

function stableId(value: unknown): string {
  const parsed = boundedText(value, 64);
  if (!STABLE_ID.test(parsed)) return invalidResponse();
  return parsed;
}

function versionedProfileId(value: unknown): string {
  const parsed = boundedText(value, 192);
  if (!VERSIONED_PROFILE_ID.test(parsed)) return invalidResponse();
  return parsed;
}

function nonnegativeInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    return invalidResponse();
  }
  return value as number;
}

function parseStringArray(value: unknown, maximumItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) return invalidResponse();
  return value.map((item) => boundedText(item, 240));
}

function parseWorkItems(value: unknown): readonly PreviewWorkItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WORK_ITEMS) {
    return invalidResponse();
  }
  const ids = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) return invalidResponse();
    const id = stableId(item.id);
    if (ids.has(id)) return invalidResponse();
    ids.add(id);
    return { id, title: boundedText(item.title, 160) };
  });
}

function parseAssignments(
  value: unknown,
  workItemIds: ReadonlySet<string>,
  budgetCapMicrodollars: number,
): readonly PreviewAssignment[] {
  if (!Array.isArray(value) || value.length !== workItemIds.size) return invalidResponse();
  const assignedIds = new Set<string>();

  return value.map((assignment) => {
    if (!isRecord(assignment) || !isRecord(assignment.candidate)) return invalidResponse();
    const workItemId = stableId(assignment.workItemId);
    if (!workItemIds.has(workItemId) || assignedIds.has(workItemId)) return invalidResponse();
    assignedIds.add(workItemId);
    const confidence = assignment.confidence;
    if (
      typeof confidence !== 'number' ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      return invalidResponse();
    }
    return {
      workItemId,
      agentProfileId: versionedProfileId(assignment.candidate.agentProfileId),
      selectionReasons: parseStringArray(assignment.selectionReasons, MAX_ASSIGNMENT_REASONS),
      expectedCostMicrodollars: nonnegativeInteger(
        assignment.expectedCostMicrodollars,
        budgetCapMicrodollars,
      ),
      confidence,
      requiredApprovals: parseStringArray(assignment.requiredApprovals, 16).map((approval) => {
        if (!STABLE_ID.test(approval)) return invalidResponse();
        return approval;
      }),
    };
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      return invalidResponse();
    }
  }

  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return invalidResponse();
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return invalidResponse();
    }
    try {
      text += decoder.decode(value, { stream: true });
    } catch {
      return invalidResponse();
    }
  }
  try {
    return text + decoder.decode();
  } catch {
    return invalidResponse();
  }
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) return invalidResponse();
  const text = await readBoundedText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return invalidResponse();
  }
}

function parseServerError(value: unknown): HubApiError {
  if (!isRecord(value) || !isRecord(value.error)) {
    return new HubApiError('REQUEST_FAILED', 'The host rejected the preview request.');
  }
  const code = value.error.code;
  const message = value.error.message;
  if (
    typeof code !== 'string' ||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(code) ||
    typeof message !== 'string' ||
    message.length === 0 ||
    message.length > 240 ||
    !isSafeText(message)
  ) {
    return new HubApiError('REQUEST_FAILED', 'The host rejected the preview request.');
  }
  return new HubApiError(code, message);
}

function parsePreview(
  value: unknown,
  requestedObjective: string,
  budgetCapMicrodollars: number,
): DelegationPreviewSummary {
  if (!isRecord(value) || value.mode !== 'PREVIEW_ONLY') return invalidResponse();
  if (!Array.isArray(value.sideEffects) || value.sideEffects.length !== 0) return invalidResponse();
  if (!isRecord(value.intent) || !isRecord(value.intent.budget) || !isRecord(value.plan)) {
    return invalidResponse();
  }

  const objective = boundedText(value.intent.objective, MAX_OBJECTIVE_LENGTH);
  if (objective !== requestedObjective) return invalidResponse();
  const responseBudgetCap = nonnegativeInteger(
    value.intent.budget.maxCostMicrodollars,
    MAX_BUDGET_MICRODOLLARS,
  );
  if (responseBudgetCap !== budgetCapMicrodollars) return invalidResponse();
  const workItems = parseWorkItems(value.plan.workItems);
  const workItemIds = new Set(workItems.map((item) => item.id));
  const assignments = parseAssignments(value.assignments, workItemIds, budgetCapMicrodollars);
  const estimatedTotalCostMicrodollars = nonnegativeInteger(
    value.estimatedTotalCostMicrodollars,
    budgetCapMicrodollars,
  );
  const calculatedCost = assignments.reduce(
    (total, assignment) => total + assignment.expectedCostMicrodollars,
    0,
  );
  if (calculatedCost !== estimatedTotalCostMicrodollars) return invalidResponse();

  return deepFreeze({ objective, workItems, assignments, estimatedTotalCostMicrodollars });
}

function parseAssignment(value: unknown, requestedObjective: string): DelegationAssignment {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'mode',
      'assignmentId',
      'queuedAt',
      'objective',
      'items',
      'commandExecution',
    ]) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'ASSIGNED' ||
    typeof value.assignmentId !== 'string' ||
    !/^assignment\.[a-f0-9-]{36}$/.test(value.assignmentId) ||
    !isCanonicalTimestamp(value.queuedAt) ||
    value.objective !== requestedObjective ||
    value.commandExecution !== 'DISABLED' ||
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    value.items.length > MAX_WORK_ITEMS
  ) {
    return invalidResponse();
  }
  const ids = new Set<string>();
  const items = value.items.map((item): QueuedAssignmentItem => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['workItemId', 'title', 'agentProfileId', 'state']) ||
      item.state !== 'QUEUED'
    ) {
      return invalidResponse();
    }
    const workItemId = stableId(item.workItemId);
    if (ids.has(workItemId)) return invalidResponse();
    ids.add(workItemId);
    return {
      workItemId,
      title: boundedText(item.title, 160),
      agentProfileId: versionedProfileId(item.agentProfileId),
      state: 'QUEUED',
    };
  });
  return deepFreeze({
    schemaVersion: 1,
    mode: 'ASSIGNED',
    assignmentId: value.assignmentId,
    queuedAt: value.queuedAt,
    objective: requestedObjective,
    items,
    commandExecution: 'DISABLED',
  });
}

function parseAgentStatus(value: unknown): AgentStatusSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'mode', 'observedAt', 'agents']) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'READ_ONLY' ||
    !isCanonicalTimestamp(value.observedAt) ||
    !Array.isArray(value.agents) ||
    value.agents.length !== AGENT_IDS.length
  ) {
    return invalidResponse();
  }

  const expectedIds = new Set<string>(AGENT_IDS);
  const observedIds = new Set<string>();
  const states = new Set<AgentConnectionState>(['READY', 'DEGRADED', 'OFFLINE', 'UNSUPPORTED']);
  const statusCodes = new Set<AgentStatusCode>([
    'AVAILABLE',
    'AUTHENTICATED',
    'CONNECTED',
    'DESKTOP_ONLY',
    'UNAVAILABLE',
    'PROBE_TIMEOUT',
    'PROBE_FAILED',
  ]);
  const expectedState: Readonly<Record<AgentStatusCode, AgentConnectionState>> = {
    AVAILABLE: 'READY',
    AUTHENTICATED: 'READY',
    CONNECTED: 'READY',
    DESKTOP_ONLY: 'UNSUPPORTED',
    UNAVAILABLE: 'OFFLINE',
    PROBE_TIMEOUT: 'DEGRADED',
    PROBE_FAILED: 'DEGRADED',
  };

  const agents = value.agents.map((agent): AgentRuntimeStatus => {
    if (!isRecord(agent) || !hasExactKeys(agent, ['id', 'state', 'statusCode', 'version'])) {
      return invalidResponse();
    }
    if (
      typeof agent.id !== 'string' ||
      !expectedIds.has(agent.id) ||
      observedIds.has(agent.id) ||
      typeof agent.state !== 'string' ||
      !states.has(agent.state as AgentConnectionState) ||
      typeof agent.statusCode !== 'string' ||
      !statusCodes.has(agent.statusCode as AgentStatusCode) ||
      expectedState[agent.statusCode as AgentStatusCode] !== agent.state ||
      (agent.version !== null &&
        (typeof agent.version !== 'string' || !SAFE_VERSION.test(agent.version)))
    ) {
      return invalidResponse();
    }
    observedIds.add(agent.id);
    return {
      id: agent.id as AgentId,
      state: agent.state as AgentConnectionState,
      statusCode: agent.statusCode as AgentStatusCode,
      version: agent.version as string | null,
    };
  });
  if (observedIds.size !== expectedIds.size) return invalidResponse();

  return deepFreeze({
    schemaVersion: 1,
    mode: 'READ_ONLY',
    observedAt: value.observedAt,
    agents,
  });
}

function parseToolRecon(value: unknown): ToolReconSnapshot {
  const keys = [
    'schemaVersion',
    'mode',
    'source',
    'observedAt',
    'catalogCount',
    'installedCount',
    'tools',
    'restrictedCapabilities',
  ];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'READ_ONLY' ||
    value.source !== 'AI_SPY' ||
    !isCanonicalTimestamp(value.observedAt) ||
    value.catalogCount !== 14 ||
    !Number.isSafeInteger(value.installedCount) ||
    (value.installedCount as number) < 0 ||
    (value.installedCount as number) > value.catalogCount ||
    !Array.isArray(value.tools) ||
    value.tools.length !== value.installedCount
  ) {
    return invalidResponse();
  }

  const categories = new Set<ReconToolCategory>([
    'HARNESS',
    'IDE',
    'LOCAL_MODEL',
    'ASSISTANT',
    'INFRASTRUCTURE',
  ]);
  const detections = new Set<ReconToolDetection>(['PROFILE', 'CLI', 'BOTH']);
  const ids = new Set<string>();
  const tools = value.tools.map((tool): ReconToolSummary => {
    if (!isRecord(tool) || !hasExactKeys(tool, ['id', 'name', 'category', 'vendor', 'detection'])) {
      return invalidResponse();
    }
    const id = stableId(tool.id);
    if (
      ids.has(id) ||
      typeof tool.category !== 'string' ||
      !categories.has(tool.category as ReconToolCategory) ||
      typeof tool.detection !== 'string' ||
      !detections.has(tool.detection as ReconToolDetection)
    ) {
      return invalidResponse();
    }
    ids.add(id);
    return {
      id,
      name: boundedText(tool.name, 128),
      category: tool.category as ReconToolCategory,
      vendor: boundedText(tool.vendor, 128),
      detection: tool.detection as ReconToolDetection,
    };
  });
  const restrictions = [
    'COMMAND_EXECUTION_DISABLED',
    'KEY_MANAGEMENT_DISABLED',
    'NETWORK_SCAN_DISABLED',
  ] as const;
  const restrictedCapabilities = value.restrictedCapabilities;
  if (
    !Array.isArray(restrictedCapabilities) ||
    restrictedCapabilities.length !== restrictions.length ||
    !restrictions.every((restriction, index) => restrictedCapabilities[index] === restriction)
  ) {
    return invalidResponse();
  }
  return deepFreeze({
    schemaVersion: 1,
    mode: 'READ_ONLY',
    source: 'AI_SPY',
    observedAt: value.observedAt,
    catalogCount: value.catalogCount,
    installedCount: value.installedCount as number,
    tools,
    restrictedCapabilities: restrictions,
  });
}

export async function requestToolRecon(
  options: ToolReconRequestOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<ToolReconSnapshot> {
  if (options.signal?.aborted === true) {
    throw new HubApiError('REQUEST_CANCELLED', 'The reconnaissance request was cancelled.');
  }
  const controller = new AbortController();
  let callerCancelled = false;
  const cancelFromCaller = () => {
    callerCancelled = true;
    controller.abort();
  };
  options.signal?.addEventListener('abort', cancelFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(TOOL_RECON_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await readJson(response);
    if (!response.ok) throw new HubApiError('HOST_UNAVAILABLE', 'Tool inventory is unavailable.');
    return parseToolRecon(body);
  } catch (error) {
    if (callerCancelled) {
      throw new HubApiError('REQUEST_CANCELLED', 'The reconnaissance request was cancelled.');
    }
    if (error instanceof HubApiError) throw error;
    throw new HubApiError('HOST_UNAVAILABLE', 'Tool inventory is unavailable.');
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancelFromCaller);
  }
}

export async function requestAgentStatus(
  options: AgentStatusRequestOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<AgentStatusSnapshot> {
  if (options.signal?.aborted === true) {
    throw new HubApiError('REQUEST_CANCELLED', 'The agent status request was cancelled.');
  }

  const controller = new AbortController();
  let callerCancelled = false;
  const cancelFromCaller = () => {
    callerCancelled = true;
    controller.abort();
  };
  options.signal?.addEventListener('abort', cancelFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(AGENT_STATUS_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new HubApiError('HOST_UNAVAILABLE', 'Live agent status is unavailable.');
    }
    return parseAgentStatus(body);
  } catch (error) {
    if (callerCancelled) {
      throw new HubApiError('REQUEST_CANCELLED', 'The agent status request was cancelled.');
    }
    if (error instanceof HubApiError) throw error;
    throw new HubApiError('HOST_UNAVAILABLE', 'Live agent status is unavailable.');
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancelFromCaller);
  }
}

export async function requestDelegationPreview(
  input: DelegationPreviewRequest,
  options: DelegationPreviewRequestOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<DelegationPreviewSummary> {
  const objective = typeof input.objective === 'string' ? input.objective.trim() : '';
  if (
    objective.length === 0 ||
    objective.length > MAX_OBJECTIVE_LENGTH ||
    !isSafeText(objective) ||
    input.workspace !== 'monster-agent-hub' ||
    !Number.isSafeInteger(input.budgetCapMicrodollars) ||
    input.budgetCapMicrodollars < 0 ||
    input.budgetCapMicrodollars > MAX_BUDGET_MICRODOLLARS
  ) {
    throw new HubApiError('INVALID_REQUEST', 'The preview request is invalid.');
  }

  if (options.signal?.aborted === true) {
    throw new HubApiError('REQUEST_CANCELLED', 'The preview request was cancelled.');
  }

  const controller = new AbortController();
  let callerCancelled = false;
  let deadlineExceeded = false;
  const cancelFromCaller = () => {
    if (controller.signal.aborted) return;
    callerCancelled = true;
    controller.abort();
  };
  const throwIfInterrupted = () => {
    if (callerCancelled) {
      throw new HubApiError('REQUEST_CANCELLED', 'The preview request was cancelled.');
    }
    if (deadlineExceeded) {
      throw new HubApiError(
        'HOST_UNAVAILABLE',
        'The trusted host is unavailable. Try again shortly.',
      );
    }
  };
  options.signal?.addEventListener('abort', cancelFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    if (controller.signal.aborted) return;
    deadlineExceeded = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(PREVIEW_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective,
        workspace: input.workspace,
        budgetCapMicrodollars: input.budgetCapMicrodollars,
      }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    throwIfInterrupted();
    const body = await readJson(response);
    throwIfInterrupted();
    if (!response.ok) throw parseServerError(body);
    return parsePreview(body, objective, input.budgetCapMicrodollars);
  } catch (error) {
    throwIfInterrupted();
    if (error instanceof HubApiError) throw error;
    throw new HubApiError(
      'HOST_UNAVAILABLE',
      'The trusted host is unavailable. Try again shortly.',
    );
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancelFromCaller);
  }
}

export async function requestDelegationAssignment(
  input: DelegationPreviewRequest,
  options: DelegationPreviewRequestOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<DelegationAssignment> {
  const objective = typeof input.objective === 'string' ? input.objective.trim() : '';
  if (
    objective.length === 0 ||
    objective.length > MAX_OBJECTIVE_LENGTH ||
    !isSafeText(objective) ||
    input.workspace !== 'monster-agent-hub' ||
    !Number.isSafeInteger(input.budgetCapMicrodollars) ||
    input.budgetCapMicrodollars < 0 ||
    input.budgetCapMicrodollars > MAX_BUDGET_MICRODOLLARS
  ) {
    throw new HubApiError('INVALID_REQUEST', 'The assignment request is invalid.');
  }
  if (options.signal?.aborted === true) {
    throw new HubApiError('REQUEST_CANCELLED', 'The assignment request was cancelled.');
  }
  const controller = new AbortController();
  let callerCancelled = false;
  const cancelFromCaller = () => {
    callerCancelled = true;
    controller.abort();
  };
  options.signal?.addEventListener('abort', cancelFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(ASSIGN_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective,
        workspace: input.workspace,
        budgetCapMicrodollars: input.budgetCapMicrodollars,
        confirmation: 'ASSIGN',
      }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await readJson(response);
    if (!response.ok) throw parseServerError(body);
    return parseAssignment(body, objective);
  } catch (error) {
    if (callerCancelled) {
      throw new HubApiError('REQUEST_CANCELLED', 'The assignment request was cancelled.');
    }
    if (error instanceof HubApiError) throw error;
    throw new HubApiError('HOST_UNAVAILABLE', 'The trusted host could not queue the assignment.');
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancelFromCaller);
  }
}
