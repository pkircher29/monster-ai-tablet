import type {
  AgentAvailabilityProbe,
  AgentCapabilityDeclaration,
  AgentCapabilityLevel,
  AgentCapabilityRisk,
  AgentCapabilitySupport,
  AgentHandoffType,
  AgentLaunchMode,
  AgentLifecycleState,
  AgentManifest,
  AgentRuntimeLocation,
  DelegationAuthority,
  DelegationBudget,
  DelegationIntent,
  DelegationPlan,
  DelegationPlanValidationContext,
  DelegationWorkItem,
  RoutingAssignment,
  RoutingAssignmentValidationContext,
  RoutingAssignmentValidationContextInput,
  RoutingCandidate,
  RoutingCandidateEligibility,
} from './types.js';

export type {
  AgentAvailabilityProbe,
  AgentAvailabilityProbeKind,
  AgentCapabilityDeclaration,
  AgentCapabilityLevel,
  AgentCapabilityRisk,
  AgentCapabilitySupport,
  AgentHandoffType,
  AgentLaunchMode,
  AgentLifecycleState,
  AgentManifest,
  AgentRuntimeLocation,
  DelegationAuthority,
  DelegationBudget,
  DelegationIntent,
  DelegationPlan,
  DelegationPlanValidationContext,
  DelegationWorkItem,
  RoutingAssignment,
  RoutingAssignmentValidationContext,
  RoutingAssignmentValidationContextInput,
  RoutingCandidate,
  RoutingCandidateEligibility,
} from './types.js';

const MAX_ID_LENGTH = 128;
const MAX_OBJECTIVE_LENGTH = 4_096;
const MAX_TITLE_LENGTH = 256;
const MAX_PROFILE_ID_LENGTH = 256;
const MAX_REASON_LENGTH = 1_024;
const MAX_WORK_ITEMS = 16;
const MAX_CAPABILITIES = 32;
const MAX_CONCURRENCY = 3;
const MAX_ATTEMPTS = 2;
const MAX_HANDOFFS = 2;
const MAX_PLAN_TTL_MS = 4 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_CONTRACT_COST_MICRODOLLARS = 100_000_000;
const MAX_AGENT_DISPLAY_NAME_LENGTH = 128;
const MAX_AGENT_SUMMARY_LENGTH = 1_024;
const MAX_AGENT_VERSION_LENGTH = 64;
const MAX_AGENT_CAPABILITIES = 32;
const MAX_AGENT_GUIDANCE_ENTRIES = 16;
const MAX_AGENT_GUIDANCE_LENGTH = 512;
const MAX_AGENT_TOOL_PROFILES = 16;
const MAX_AGENT_PROBE_TIMEOUT_MS = 10_000;
const MAX_RECORD_KEYS = 64;

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const STABLE_PROFILE_ID_PATTERN = /^[a-z0-9]+(?:[._/@:-][a-z0-9]+)*$/;

const AGENT_RUNTIME_LOCATIONS = ['TABLET', 'WINDOWS_HOST'] as const;
const AGENT_AVAILABILITY_PROBE_KINDS = ['HTTP'] as const;
const AGENT_LAUNCH_MODES = ['INTERACTIVE', 'REMOTE_CONTROL', 'DELEGATED'] as const;
const AGENT_CAPABILITY_SUPPORT = ['NATIVE', 'BRIDGED', 'UNSUPPORTED'] as const;
const AGENT_CAPABILITY_LEVELS = ['BASIC', 'STRONG', 'EXPERT'] as const;
const AGENT_CAPABILITY_RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const AGENT_HANDOFF_TYPES = ['task', 'review', 'artifact'] as const;
const AGENT_LIFECYCLE_STATES = ['ACTIVE', 'PAUSED', 'RETIRED'] as const;

const validatedDelegationIntents = new WeakSet<object>();
const validatedDelegationPlans = new WeakSet<object>();
const validatedRoutingAssignmentContexts = new WeakSet<object>();
const trustedPromotionEvidenceRecords = new WeakSet<object>();
const trustedPromotionApprovalRecords = new WeakSet<object>();

type UnknownRecord = Readonly<Record<string, unknown>>;

export class ContractValidationError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ContractValidationError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new ContractValidationError(path, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown, path: string, allowedKeys: readonly string[]): UnknownRecord {
  if (!isRecord(value)) {
    fail(path, 'must be an object');
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'must be a plain data object with own fields');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(path, 'must not contain symbol fields');
  }

  const keys = Object.getOwnPropertyNames(value);
  if (keys.length > MAX_RECORD_KEYS) {
    fail(path, `must contain at most ${MAX_RECORD_KEYS} fields`);
  }

  const allowed = new Set(allowedKeys);
  for (const key of keys) {
    const safeKey = key.replaceAll(/[^A-Za-z0-9_.-]/g, '?').slice(0, MAX_ID_LENGTH);
    if (!allowed.has(key)) {
      fail(`${path}.${safeKey}`, 'is not a recognized field');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      fail(`${path}.${safeKey}`, 'must be a data field');
    }
  }

  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function parseBoundedString(
  value: unknown,
  path: string,
  maximumLength: number,
  requireTrimmed = false,
): string {
  if (typeof value !== 'string') {
    fail(path, 'must be a string');
  }
  if (value.trim().length === 0) {
    fail(path, 'must not be blank');
  }
  if (value.length > maximumLength) {
    fail(path, `must contain at most ${maximumLength} characters`);
  }
  if (value.includes('\0')) {
    fail(path, 'must not contain null characters');
  }
  if (requireTrimmed && value !== value.trim()) {
    fail(path, 'must not have leading or trailing whitespace');
  }
  return value;
}

function parseId(value: unknown, path: string): string {
  return parseStableId(value, path);
}

function parseStableId(value: unknown, path: string): string {
  const parsed = parseBoundedString(value, path, MAX_ID_LENGTH, true);
  if (!STABLE_ID_PATTERN.test(parsed)) {
    fail(
      path,
      'must be a lowercase stable identifier containing only letters, digits, dots, or hyphens',
    );
  }
  return parsed;
}

function parseProfileId(value: unknown, path: string): string {
  const parsed = parseBoundedString(value, path, MAX_PROFILE_ID_LENGTH, true);
  if (!STABLE_PROFILE_ID_PATTERN.test(parsed)) {
    fail(
      path,
      'must be a stable profile identifier containing only lowercase letters, digits, and ID separators',
    );
  }
  return parsed;
}

function parseEnum<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  allowedValues: Values,
): Values[number] {
  if (typeof value !== 'string' || !(allowedValues as readonly string[]).includes(value)) {
    fail(path, `must be one of ${allowedValues.join(', ')}`);
  }
  return value as Values[number];
}

function parseArray(
  value: unknown,
  path: string,
  maximumLength: number,
  minimumLength = 0,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, 'must be an array');
  }
  if (value.length < minimumLength) {
    fail(path, `must contain at least ${minimumLength} item(s)`);
  }
  if (value.length > maximumLength) {
    fail(path, `must contain at most ${maximumLength} item(s)`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail(`${path}[${index}]`, 'must be present; sparse arrays are not allowed');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      fail(`${path}[${index}]`, 'must be a data item');
    }
  }
  return value;
}

function parseStringList(
  value: unknown,
  path: string,
  maximumItems: number,
  maximumItemLength: number,
  minimumItems = 0,
): string[] {
  const values = parseArray(value, path, maximumItems, minimumItems).map((entry, index) =>
    parseBoundedString(entry, `${path}[${index}]`, maximumItemLength, true),
  );
  if (new Set(values).size !== values.length) {
    fail(path, 'must not contain duplicate values');
  }
  return values;
}

function parseStableIdList(
  value: unknown,
  path: string,
  maximumItems: number,
  minimumItems = 0,
): string[] {
  const values = parseArray(value, path, maximumItems, minimumItems).map((entry, index) =>
    parseStableId(entry, `${path}[${index}]`),
  );
  if (new Set(values).size !== values.length) {
    fail(path, 'must not contain duplicate values');
  }
  return values;
}

function parseEnumList<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  allowedValues: Values,
  minimumItems = 0,
): Values[number][] {
  const values = parseArray(value, path, allowedValues.length, minimumItems).map((entry, index) =>
    parseEnum(entry, `${path}[${index}]`, allowedValues),
  );
  if (new Set(values).size !== values.length) {
    fail(path, 'must not contain duplicate values');
  }
  return values;
}

function parseFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number');
  }
  return value;
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(path, 'must be a boolean');
  }
  return value;
}

function parseIntegerInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)) {
    fail(path, 'must be a safe integer');
  }
  const parsed = value as number;
  if (parsed < minimum || parsed > maximum) {
    fail(path, `must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseSchemaVersion(value: unknown, path: string): 1 {
  if (value !== 1) {
    fail(path, 'must equal 1');
  }
  return 1;
}

const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function parseTimestamp(value: unknown, path: string): string {
  const parsed = parseBoundedString(value, path, 64, true);
  const match = RFC3339_PATTERN.exec(parsed);
  if (match === null) {
    fail(path, 'must be an RFC 3339 date-time');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(parsed))
  ) {
    fail(path, 'must be a valid RFC 3339 date-time');
  }

  return parsed;
}

function parseGrantIdList(
  value: unknown,
  path: string,
  namespace: 'workspace' | 'tool' | 'network' | 'credential' | 'action' | 'approval',
  maximumItems: number,
): string[] {
  const grants = parseStableIdList(value, path, maximumItems);
  for (const [index, grant] of grants.entries()) {
    if (!grant.startsWith(`${namespace}.`) || grant.length === namespace.length + 1) {
      fail(`${path}[${index}]`, `must be an opaque ${namespace} grant ID`);
    }
  }
  return grants;
}

function parseAuthority(value: unknown, path: string): DelegationAuthority {
  const record = parseRecord(value, path, [
    'workspaceGrantIds',
    'toolGrantIds',
    'networkGrantIds',
    'credentialGrantIds',
    'externalActionGrantIds',
  ]);
  return {
    workspaceGrantIds: parseGrantIdList(
      record.workspaceGrantIds,
      `${path}.workspaceGrantIds`,
      'workspace',
      16,
    ),
    toolGrantIds: parseGrantIdList(record.toolGrantIds, `${path}.toolGrantIds`, 'tool', 64),
    networkGrantIds: parseGrantIdList(
      record.networkGrantIds,
      `${path}.networkGrantIds`,
      'network',
      32,
    ),
    credentialGrantIds: parseGrantIdList(
      record.credentialGrantIds,
      `${path}.credentialGrantIds`,
      'credential',
      32,
    ),
    externalActionGrantIds: parseGrantIdList(
      record.externalActionGrantIds,
      `${path}.externalActionGrantIds`,
      'action',
      32,
    ),
  };
}

function parseBudget(value: unknown, path: string): DelegationBudget {
  const record = parseRecord(value, path, ['maxCostMicrodollars', 'maxTokens', 'maxDurationMs']);
  return {
    maxCostMicrodollars: parseIntegerInRange(
      record.maxCostMicrodollars,
      `${path}.maxCostMicrodollars`,
      0,
      MAX_CONTRACT_COST_MICRODOLLARS,
    ),
    maxTokens: parseIntegerInRange(
      record.maxTokens,
      `${path}.maxTokens`,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    maxDurationMs: parseIntegerInRange(
      record.maxDurationMs,
      `${path}.maxDurationMs`,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function parseWorkItem(value: unknown, path: string): DelegationWorkItem {
  const record = parseRecord(value, path, [
    'id',
    'title',
    'objective',
    'dependsOn',
    'parentWorkItemId',
    'requiredCapabilities',
    'authority',
    'budget',
    'attemptLimit',
    'handoffLimit',
  ]);
  const base = {
    id: parseId(record.id, `${path}.id`),
    title: parseBoundedString(record.title, `${path}.title`, MAX_TITLE_LENGTH),
    objective: parseBoundedString(record.objective, `${path}.objective`, MAX_OBJECTIVE_LENGTH),
    dependsOn: parseStringList(
      record.dependsOn,
      `${path}.dependsOn`,
      MAX_WORK_ITEMS,
      MAX_ID_LENGTH,
    ),
    requiredCapabilities: parseStableIdList(
      record.requiredCapabilities,
      `${path}.requiredCapabilities`,
      MAX_CAPABILITIES,
    ),
    authority: parseAuthority(record.authority, `${path}.authority`),
    budget: parseBudget(record.budget, `${path}.budget`),
    attemptLimit: parseIntegerInRange(record.attemptLimit, `${path}.attemptLimit`, 1, MAX_ATTEMPTS),
    handoffLimit: parseIntegerInRange(record.handoffLimit, `${path}.handoffLimit`, 0, MAX_HANDOFFS),
  } satisfies Omit<DelegationWorkItem, 'parentWorkItemId'>;

  if (record.parentWorkItemId === undefined) {
    return base;
  }
  return {
    ...base,
    parentWorkItemId: parseId(record.parentWorkItemId, `${path}.parentWorkItemId`),
  };
}

function assertAuthorityWithin(
  child: DelegationAuthority,
  parent: DelegationAuthority,
  path: string,
  requireStrictSubset = false,
): void {
  const exactDimensions = [
    ['workspaceGrantIds', child.workspaceGrantIds, parent.workspaceGrantIds],
    ['toolGrantIds', child.toolGrantIds, parent.toolGrantIds],
    ['networkGrantIds', child.networkGrantIds, parent.networkGrantIds],
    ['credentialGrantIds', child.credentialGrantIds, parent.credentialGrantIds],
    ['externalActionGrantIds', child.externalActionGrantIds, parent.externalActionGrantIds],
  ] as const;
  let hasNarrowerDimension = false;
  for (const [name, childValues, parentValues] of exactDimensions) {
    const allowed = new Set(parentValues);
    for (const childValue of childValues) {
      if (!allowed.has(childValue)) {
        fail(`${path}.${name}`, `${childValue} exceeds parent authority`);
      }
    }
    if (childValues.length < parentValues.length) {
      hasNarrowerDimension = true;
    }
  }
  if (requireStrictSubset && !hasNarrowerDimension) {
    fail(path, 'must be a strict subset of parent authority');
  }
}

function assertBudgetWithin(child: DelegationBudget, parent: DelegationBudget, path: string): void {
  if (child.maxCostMicrodollars > parent.maxCostMicrodollars) {
    fail(`${path}.maxCostMicrodollars`, 'exceeds parent budget');
  }
  if (child.maxTokens > parent.maxTokens) {
    fail(`${path}.maxTokens`, 'exceeds parent budget');
  }
  if (child.maxDurationMs > parent.maxDurationMs) {
    fail(`${path}.maxDurationMs`, 'exceeds parent budget');
  }
}

function assertAggregateBudgetWithin(
  children: readonly DelegationWorkItem[],
  parent: DelegationBudget,
  path: string,
): void {
  const totals = children.reduce(
    (sum, child) => ({
      maxCostMicrodollars: sum.maxCostMicrodollars + BigInt(child.budget.maxCostMicrodollars),
      maxTokens: sum.maxTokens + child.budget.maxTokens,
      maxDurationMs: sum.maxDurationMs + child.budget.maxDurationMs,
    }),
    { maxCostMicrodollars: 0n, maxTokens: 0, maxDurationMs: 0 },
  );
  if (totals.maxCostMicrodollars > BigInt(parent.maxCostMicrodollars)) {
    fail(`${path}.maxCostMicrodollars`, 'exceeds parent budget');
  }
  if (totals.maxTokens > parent.maxTokens) {
    fail(`${path}.maxTokens`, 'exceeds parent budget');
  }
  if (totals.maxDurationMs > parent.maxDurationMs) {
    fail(`${path}.maxDurationMs`, 'exceeds parent budget');
  }
}

function assertDependencyGraphIsValid(
  workItems: readonly DelegationWorkItem[],
  byId: ReadonlyMap<string, DelegationWorkItem>,
): void {
  for (const item of workItems) {
    for (const dependency of item.dependsOn) {
      if (!byId.has(dependency)) {
        fail(`delegationPlan.workItems.${item.id}.dependsOn`, `${dependency} does not exist`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      fail('delegationPlan.workItems', `dependency cycle includes ${id}`);
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependsOn) {
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const item of workItems) {
    visit(item.id);
  }
}

function assertDecompositionIsValid(
  workItems: readonly DelegationWorkItem[],
  byId: ReadonlyMap<string, DelegationWorkItem>,
): void {
  for (const item of workItems) {
    if (item.parentWorkItemId !== undefined && !byId.has(item.parentWorkItemId)) {
      fail(
        `delegationPlan.workItems.${item.id}.parentWorkItemId`,
        `${item.parentWorkItemId} does not exist`,
      );
    }
  }

  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (item: DelegationWorkItem): number => {
    const knownDepth = depths.get(item.id);
    if (knownDepth !== undefined) {
      return knownDepth;
    }
    if (visiting.has(item.id)) {
      fail('delegationPlan.workItems', `parent cycle includes ${item.id}`);
    }
    visiting.add(item.id);
    const depth =
      item.parentWorkItemId === undefined ? 0 : depthOf(byId.get(item.parentWorkItemId)!) + 1;
    visiting.delete(item.id);
    if (depth > 2) {
      fail(
        `delegationPlan.workItems.${item.id}.parentWorkItemId`,
        'decomposition may not exceed two child levels',
      );
    }
    depths.set(item.id, depth);
    return depth;
  };

  for (const item of workItems) {
    depthOf(item);
  }
}

function validatePlanConstraints(plan: DelegationPlan): void {
  const byId = new Map<string, DelegationWorkItem>();
  for (const item of plan.workItems) {
    if (byId.has(item.id)) {
      fail('delegationPlan.workItems', `duplicate work item ID ${item.id}`);
    }
    byId.set(item.id, item);
  }

  assertDependencyGraphIsValid(plan.workItems, byId);
  assertDecompositionIsValid(plan.workItems, byId);

  for (const item of plan.workItems) {
    assertAuthorityWithin(
      item.authority,
      plan.authority,
      `delegationPlan.workItems.${item.id}.authority`,
      true,
    );
    assertBudgetWithin(item.budget, plan.budget, `delegationPlan.workItems.${item.id}.budget`);

    if (item.parentWorkItemId !== undefined) {
      const parent = byId.get(item.parentWorkItemId)!;
      assertAuthorityWithin(
        item.authority,
        parent.authority,
        `delegationPlan.workItems.${item.id}.authority`,
        true,
      );
      assertBudgetWithin(item.budget, parent.budget, `delegationPlan.workItems.${item.id}.budget`);
    }
  }

  assertAggregateBudgetWithin(
    plan.workItems,
    plan.budget,
    'delegationPlan.workItems.aggregateBudget',
  );
  for (const parent of plan.workItems) {
    const children = plan.workItems.filter((item) => item.parentWorkItemId === parent.id);
    if (children.length > 0) {
      assertAggregateBudgetWithin(
        children,
        parent.budget,
        `delegationPlan.workItems.${parent.id}.childAggregateBudget`,
      );
    }
  }
}

export function parseDelegationIntent(input: unknown): DelegationIntent {
  const record = parseRecord(input, 'delegationIntent', [
    'schemaVersion',
    'id',
    'objective',
    'requestedBy',
    'requestedAt',
    'authority',
    'budget',
  ]);
  const requestedAt = parseTimestamp(record.requestedAt, 'delegationIntent.requestedAt');
  if (Date.parse(requestedAt) > Date.now() + MAX_CLOCK_SKEW_MS) {
    fail('delegationIntent.requestedAt', 'must not be future-dated');
  }

  const intent = deepFreeze({
    schemaVersion: parseSchemaVersion(record.schemaVersion, 'delegationIntent.schemaVersion'),
    id: parseId(record.id, 'delegationIntent.id'),
    objective: parseBoundedString(
      record.objective,
      'delegationIntent.objective',
      MAX_OBJECTIVE_LENGTH,
    ),
    requestedBy: parseId(record.requestedBy, 'delegationIntent.requestedBy'),
    requestedAt,
    authority: parseAuthority(record.authority, 'delegationIntent.authority'),
    budget: parseBudget(record.budget, 'delegationIntent.budget'),
  });
  validatedDelegationIntents.add(intent);
  return intent;
}

export function parseDelegationPlan(
  input: unknown,
  context: DelegationPlanValidationContext,
): DelegationPlan {
  const contextRecord = parseRecord(context, 'delegationPlanContext', ['intent']);
  const intent = contextRecord.intent;
  if (!isRecord(intent) || !validatedDelegationIntents.has(intent)) {
    fail('delegationPlanContext.intent', 'must be a validated server-loaded intent');
  }
  const authorizedIntent = intent as unknown as DelegationIntent;
  const nowEpochMs = Date.now();
  const record = parseRecord(input, 'delegationPlan', [
    'schemaVersion',
    'id',
    'intentId',
    'objective',
    'createdAt',
    'expiresAt',
    'authority',
    'budget',
    'maxConcurrency',
    'workItems',
  ]);
  const createdAt = parseTimestamp(record.createdAt, 'delegationPlan.createdAt');
  const expiresAt = parseTimestamp(record.expiresAt, 'delegationPlan.expiresAt');
  const createdAtMs = Date.parse(createdAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (expiresAtMs <= createdAtMs) {
    fail('delegationPlan.expiresAt', 'must be later than createdAt');
  }
  if (expiresAtMs - createdAtMs > MAX_PLAN_TTL_MS) {
    fail('delegationPlan.expiresAt', 'must be no more than four hours after createdAt');
  }
  if (expiresAtMs <= nowEpochMs) {
    fail('delegationPlan.expiresAt', 'must be later than the validation time');
  }
  if (createdAtMs > nowEpochMs + MAX_CLOCK_SKEW_MS) {
    fail('delegationPlan.createdAt', 'must not be future-dated');
  }

  const plan: DelegationPlan = {
    schemaVersion: parseSchemaVersion(record.schemaVersion, 'delegationPlan.schemaVersion'),
    id: parseId(record.id, 'delegationPlan.id'),
    intentId: parseId(record.intentId, 'delegationPlan.intentId'),
    objective: parseBoundedString(
      record.objective,
      'delegationPlan.objective',
      MAX_OBJECTIVE_LENGTH,
    ),
    createdAt,
    expiresAt,
    authority: parseAuthority(record.authority, 'delegationPlan.authority'),
    budget: parseBudget(record.budget, 'delegationPlan.budget'),
    maxConcurrency: parseIntegerInRange(
      record.maxConcurrency,
      'delegationPlan.maxConcurrency',
      1,
      MAX_CONCURRENCY,
    ),
    workItems: parseArray(record.workItems, 'delegationPlan.workItems', MAX_WORK_ITEMS, 1).map(
      (workItem, index) => parseWorkItem(workItem, `delegationPlan.workItems[${index}]`),
    ),
  };

  validatePlanConstraints(plan);
  if (plan.intentId !== authorizedIntent.id) {
    fail('delegationPlan.intentId', 'does not match the authorizing intent');
  }
  if (createdAtMs < Date.parse(authorizedIntent.requestedAt)) {
    fail('delegationPlan.createdAt', 'must not predate the authorizing intent');
  }
  assertAuthorityWithin(plan.authority, authorizedIntent.authority, 'delegationPlan.authority');
  assertBudgetWithin(plan.budget, authorizedIntent.budget, 'delegationPlan.budget');

  const authorizedPlan = deepFreeze(plan);
  validatedDelegationPlans.add(authorizedPlan);
  return authorizedPlan;
}

function parseRoutingCandidate(value: unknown, path: string): RoutingCandidate {
  const record = parseRecord(value, path, ['agentProfileId', 'modelProfileId', 'toolProfileId']);
  return deepFreeze({
    agentProfileId: parseProfileId(record.agentProfileId, `${path}.agentProfileId`),
    modelProfileId: parseProfileId(record.modelProfileId, `${path}.modelProfileId`),
    toolProfileId: parseProfileId(record.toolProfileId, `${path}.toolProfileId`),
  });
}

function routingCandidateKey(candidate: RoutingCandidate): string {
  return JSON.stringify([
    candidate.agentProfileId,
    candidate.modelProfileId,
    candidate.toolProfileId,
  ]);
}

function parsePlanFingerprint(value: unknown, path: string): string {
  const fingerprint = parseBoundedString(value, path, 71, true);
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
    fail(path, 'must be a lowercase SHA-256 fingerprint');
  }
  return fingerprint;
}

function parseRoutingCandidateEligibility(
  value: unknown,
  path: string,
): RoutingCandidateEligibility {
  const record = parseRecord(value, path, [
    'candidate',
    'requiredToolGrantIds',
    'requiredApprovalIds',
  ]);
  return {
    candidate: parseRoutingCandidate(record.candidate, `${path}.candidate`),
    requiredToolGrantIds: parseGrantIdList(
      record.requiredToolGrantIds,
      `${path}.requiredToolGrantIds`,
      'tool',
      32,
    ),
    requiredApprovalIds: parseGrantIdList(
      record.requiredApprovalIds,
      `${path}.requiredApprovalIds`,
      'approval',
      16,
    ),
  };
}

function computePlanFingerprint(plan: DelegationPlan): string {
  return `sha256:${sha256Hex(JSON.stringify(plan))}`;
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!;
      const previous2 = words[index - 2]!;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }

  return Array.from(state, (value) => value.toString(16).padStart(8, '0')).join('');
}

/**
 * Creates an opaque routing context from a validated plan and a registry
 * snapshot loaded by trusted server code. Caller-provided assignment payloads
 * must never be passed to this authority-establishing function.
 */
export function createRoutingAssignmentValidationContext(
  input: RoutingAssignmentValidationContextInput,
): RoutingAssignmentValidationContext {
  const record = parseRecord(input, 'routingAssignmentContext', [
    'plan',
    'planRevision',
    'registrySnapshotId',
    'eligibleCandidates',
  ]);
  const plan = record.plan;
  if (!isRecord(plan) || !validatedDelegationPlans.has(plan)) {
    fail('routingAssignmentContext.plan', 'must be a validated authorized plan');
  }
  const eligibleCandidates = parseArray(
    record.eligibleCandidates,
    'routingAssignmentContext.eligibleCandidates',
    32,
    1,
  ).map((candidate, index) =>
    parseRoutingCandidateEligibility(
      candidate,
      `routingAssignmentContext.eligibleCandidates[${index}]`,
    ),
  );
  const keys = eligibleCandidates.map((entry) => routingCandidateKey(entry.candidate));
  if (new Set(keys).size !== keys.length) {
    fail('routingAssignmentContext.eligibleCandidates', 'must not contain duplicate candidates');
  }

  const registrySnapshotId = parseStableId(
    record.registrySnapshotId,
    'routingAssignmentContext.registrySnapshotId',
  );
  if (!registrySnapshotId.startsWith('registry.')) {
    fail('routingAssignmentContext.registrySnapshotId', 'must be an opaque registry snapshot ID');
  }

  const context = deepFreeze({
    plan: plan as unknown as DelegationPlan,
    planRevision: parseIntegerInRange(
      record.planRevision,
      'routingAssignmentContext.planRevision',
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    planFingerprint: computePlanFingerprint(plan as unknown as DelegationPlan),
    registrySnapshotId,
    eligibleCandidates,
  }) as unknown as RoutingAssignmentValidationContext;
  validatedRoutingAssignmentContexts.add(context);
  return context;
}

function parseRoutingAssignmentContext(
  context: RoutingAssignmentValidationContext,
): RoutingAssignmentValidationContext {
  if (!isRecord(context) || !validatedRoutingAssignmentContexts.has(context)) {
    fail('routingAssignmentContext', 'must be an opaque server-produced registry context');
  }
  return context;
}

export function parseRoutingAssignment(
  input: unknown,
  validationContext: RoutingAssignmentValidationContext,
): RoutingAssignment {
  const context = parseRoutingAssignmentContext(validationContext);
  const record = parseRecord(input, 'routingAssignment', [
    'schemaVersion',
    'id',
    'planId',
    'planRevision',
    'planFingerprint',
    'registrySnapshotId',
    'workItemId',
    'expiresAt',
    'candidate',
    'selectionReasons',
    'alternatives',
    'expectedCostMicrodollars',
    'confidence',
    'requiredApprovals',
  ]);
  const candidate = parseRoutingCandidate(record.candidate, 'routingAssignment.candidate');
  const alternatives = parseArray(record.alternatives, 'routingAssignment.alternatives', 16).map(
    (alternative, index) =>
      parseRoutingCandidate(alternative, `routingAssignment.alternatives[${index}]`),
  );
  const candidateKeys = [candidate, ...alternatives].map(routingCandidateKey);
  if (new Set(candidateKeys).size !== candidateKeys.length) {
    fail('routingAssignment.alternatives', 'must not duplicate a routing candidate');
  }

  const planId = parseId(record.planId, 'routingAssignment.planId');
  if (planId !== context.plan.id) {
    fail('routingAssignment.planId', 'does not match the authorized plan');
  }
  const planRevision = parseIntegerInRange(
    record.planRevision,
    'routingAssignment.planRevision',
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (planRevision !== context.planRevision) {
    fail('routingAssignment.planRevision', 'does not match the authorized plan revision');
  }
  const planFingerprint = parsePlanFingerprint(
    record.planFingerprint,
    'routingAssignment.planFingerprint',
  );
  if (planFingerprint !== context.planFingerprint) {
    fail('routingAssignment.planFingerprint', 'does not match the authorized plan fingerprint');
  }
  const registrySnapshotId = parseStableId(
    record.registrySnapshotId,
    'routingAssignment.registrySnapshotId',
  );
  if (registrySnapshotId !== context.registrySnapshotId) {
    fail('routingAssignment.registrySnapshotId', 'does not match the eligible registry snapshot');
  }

  const workItemId = parseId(record.workItemId, 'routingAssignment.workItemId');
  const workItem = context.plan.workItems.find((item) => item.id === workItemId);
  if (workItem === undefined) {
    fail('routingAssignment.workItemId', 'does not name a work item in the authorized plan');
  }

  const nowEpochMs = Date.now();
  const expiresAt = parseTimestamp(record.expiresAt, 'routingAssignment.expiresAt');
  const expiresAtMs = Date.parse(expiresAt);
  if (Date.parse(context.plan.expiresAt) <= nowEpochMs) {
    fail('routingAssignmentContext.plan', 'has expired');
  }
  if (expiresAtMs <= nowEpochMs) {
    fail('routingAssignment.expiresAt', 'must be later than the validation time');
  }
  if (expiresAtMs > Date.parse(context.plan.expiresAt)) {
    fail('routingAssignment.expiresAt', 'must not outlive the authorized plan');
  }

  const eligibilityByKey = new Map(
    context.eligibleCandidates.map((entry) => [routingCandidateKey(entry.candidate), entry]),
  );
  for (const assignmentCandidate of [candidate, ...alternatives]) {
    const eligibility = eligibilityByKey.get(routingCandidateKey(assignmentCandidate));
    if (eligibility === undefined) {
      fail('routingAssignment.candidate', 'is not eligible in the registry snapshot');
    }
    const allowedToolGrants = new Set(workItem.authority.toolGrantIds);
    for (const requiredToolGrantId of eligibility.requiredToolGrantIds) {
      if (!allowedToolGrants.has(requiredToolGrantId)) {
        fail(
          'routingAssignment.candidate.toolProfileId',
          `${requiredToolGrantId} exceeds work-item authority`,
        );
      }
    }
  }

  const expectedCostMicrodollars = parseIntegerInRange(
    record.expectedCostMicrodollars,
    'routingAssignment.expectedCostMicrodollars',
    0,
    MAX_CONTRACT_COST_MICRODOLLARS,
  );
  if (expectedCostMicrodollars > workItem.budget.maxCostMicrodollars) {
    fail('routingAssignment.expectedCostMicrodollars', 'exceeds the work-item budget');
  }

  const requiredApprovals = parseGrantIdList(
    record.requiredApprovals,
    'routingAssignment.requiredApprovals',
    'approval',
    16,
  );
  const selectedEligibility = eligibilityByKey.get(routingCandidateKey(candidate))!;
  if (
    requiredApprovals.length !== selectedEligibility.requiredApprovalIds.length ||
    requiredApprovals.some(
      (approvalId) => !selectedEligibility.requiredApprovalIds.includes(approvalId),
    )
  ) {
    fail('routingAssignment.requiredApprovals', 'must exactly match approvals required by policy');
  }

  const confidence = parseFiniteNumber(record.confidence, 'routingAssignment.confidence');
  if (confidence < 0 || confidence > 1) {
    fail('routingAssignment.confidence', 'must be between zero and one');
  }

  return deepFreeze({
    schemaVersion: parseSchemaVersion(record.schemaVersion, 'routingAssignment.schemaVersion'),
    id: parseId(record.id, 'routingAssignment.id'),
    planId,
    planRevision,
    planFingerprint,
    registrySnapshotId,
    workItemId,
    expiresAt,
    candidate,
    selectionReasons: parseStringList(
      record.selectionReasons,
      'routingAssignment.selectionReasons',
      16,
      MAX_REASON_LENGTH,
      1,
    ),
    alternatives,
    expectedCostMicrodollars,
    confidence,
    requiredApprovals,
  });
}

function parseAgentAvailabilityProbe(value: unknown, path: string): AgentAvailabilityProbe {
  const record = parseRecord(value, path, ['kind', 'url', 'timeoutMs']);
  const kind = parseEnum(record.kind, `${path}.kind`, AGENT_AVAILABILITY_PROBE_KINDS);
  const rawUrl = parseBoundedString(record.url, `${path}.url`, 2_048, true);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${path}.url`, 'must be a valid HTTP or HTTPS URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    fail(`${path}.url`, 'must use HTTP or HTTPS');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    fail(`${path}.url`, 'must not contain credentials, a query, or a fragment');
  }

  return {
    kind,
    url: rawUrl,
    timeoutMs: parseIntegerInRange(
      record.timeoutMs,
      `${path}.timeoutMs`,
      1,
      MAX_AGENT_PROBE_TIMEOUT_MS,
    ),
  };
}

function parseAgentCapability(value: unknown, path: string): AgentCapabilityDeclaration {
  const record = parseRecord(value, path, [
    'capabilityId',
    'support',
    'declaredLevel',
    'requiredToolProfileIds',
    'maximumRisk',
  ]);
  const support: AgentCapabilitySupport = parseEnum(
    record.support,
    `${path}.support`,
    AGENT_CAPABILITY_SUPPORT,
  );
  const declaredLevel: AgentCapabilityLevel = parseEnum(
    record.declaredLevel,
    `${path}.declaredLevel`,
    AGENT_CAPABILITY_LEVELS,
  );
  const requiredToolProfileIds = parseStableIdList(
    record.requiredToolProfileIds,
    `${path}.requiredToolProfileIds`,
    MAX_AGENT_TOOL_PROFILES,
  );
  const maximumRisk: AgentCapabilityRisk = parseEnum(
    record.maximumRisk,
    `${path}.maximumRisk`,
    AGENT_CAPABILITY_RISKS,
  );

  if (support === 'UNSUPPORTED') {
    if (requiredToolProfileIds.length > 0) {
      fail(`${path}.requiredToolProfileIds`, 'must be empty when support is UNSUPPORTED');
    }
    if (declaredLevel !== 'BASIC') {
      fail(`${path}.declaredLevel`, 'must be BASIC when support is UNSUPPORTED');
    }
    if (maximumRisk !== 'LOW') {
      fail(`${path}.maximumRisk`, 'must be LOW when support is UNSUPPORTED');
    }
  }

  return {
    capabilityId: parseStableId(record.capabilityId, `${path}.capabilityId`),
    support,
    declaredLevel,
    requiredToolProfileIds,
    maximumRisk,
  };
}

export function parseAgentManifest(input: unknown): AgentManifest {
  const record = parseRecord(input, 'agentManifest', [
    'schemaVersion',
    'id',
    'displayName',
    'summary',
    'version',
    'runtimeLocation',
    'adapterId',
    'availabilityProbe',
    'launchModes',
    'capabilities',
    'bestFor',
    'doNotUseFor',
    'requiredApprovals',
    'supportedHandoffTypes',
    'lifecycleState',
  ]);
  const capabilities = parseArray(
    record.capabilities,
    'agentManifest.capabilities',
    MAX_AGENT_CAPABILITIES,
    1,
  ).map((capability, index) =>
    parseAgentCapability(capability, `agentManifest.capabilities[${index}]`),
  );
  const capabilityIds = capabilities.map((capability) => capability.capabilityId);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail('agentManifest.capabilities', 'must not contain duplicate capability IDs');
  }

  return deepFreeze({
    schemaVersion: parseSchemaVersion(record.schemaVersion, 'agentManifest.schemaVersion'),
    id: parseStableId(record.id, 'agentManifest.id'),
    displayName: parseBoundedString(
      record.displayName,
      'agentManifest.displayName',
      MAX_AGENT_DISPLAY_NAME_LENGTH,
      true,
    ),
    summary: parseBoundedString(
      record.summary,
      'agentManifest.summary',
      MAX_AGENT_SUMMARY_LENGTH,
      true,
    ),
    version: parseBoundedString(
      record.version,
      'agentManifest.version',
      MAX_AGENT_VERSION_LENGTH,
      true,
    ),
    runtimeLocation: parseEnum(
      record.runtimeLocation,
      'agentManifest.runtimeLocation',
      AGENT_RUNTIME_LOCATIONS,
    ) as AgentRuntimeLocation,
    adapterId: parseStableId(record.adapterId, 'agentManifest.adapterId'),
    availabilityProbe: parseAgentAvailabilityProbe(
      record.availabilityProbe,
      'agentManifest.availabilityProbe',
    ),
    launchModes: parseEnumList(
      record.launchModes,
      'agentManifest.launchModes',
      AGENT_LAUNCH_MODES,
      1,
    ) as AgentLaunchMode[],
    capabilities,
    bestFor: parseStringList(
      record.bestFor,
      'agentManifest.bestFor',
      MAX_AGENT_GUIDANCE_ENTRIES,
      MAX_AGENT_GUIDANCE_LENGTH,
      1,
    ),
    doNotUseFor: parseStringList(
      record.doNotUseFor,
      'agentManifest.doNotUseFor',
      MAX_AGENT_GUIDANCE_ENTRIES,
      MAX_AGENT_GUIDANCE_LENGTH,
      1,
    ),
    requiredApprovals: parseStableIdList(
      record.requiredApprovals,
      'agentManifest.requiredApprovals',
      16,
    ),
    supportedHandoffTypes: parseEnumList(
      record.supportedHandoffTypes,
      'agentManifest.supportedHandoffTypes',
      AGENT_HANDOFF_TYPES,
    ) as AgentHandoffType[],
    lifecycleState: parseEnum(
      record.lifecycleState,
      'agentManifest.lifecycleState',
      AGENT_LIFECYCLE_STATES,
    ) as AgentLifecycleState,
  });
}

export type {
  ApprovedPromotionApproval,
  BenchmarkEvidenceField,
  BenchmarkOutcomeField,
  BenchmarkRun,
  BenchmarkType,
  OpenRouterAuditionLimits,
  OpenRouterAuditionMode,
  OpenRouterAuditionRequest,
  PendingPromotionApproval,
  PromotionEligibilityContext,
  PromotionEligibilityDecision,
  PromotionEligibilityGate,
  PromotionEvidence,
  PromotionUserApproval,
  TrustedPromotionEvidence,
  TrustedPromotionUserApproval,
} from './types.js';

type OpenRouterAuditionRequestContract = import('./types.js').OpenRouterAuditionRequest;
type OpenRouterAuditionLimitsContract = import('./types.js').OpenRouterAuditionLimits;
type BenchmarkRunContract = import('./types.js').BenchmarkRun;
type BenchmarkTypeContract = import('./types.js').BenchmarkType;
type BenchmarkEvidenceFieldContract = import('./types.js').BenchmarkEvidenceField;
type BenchmarkOutcomeFieldContract = import('./types.js').BenchmarkOutcomeField;
type PromotionUserApprovalContract = import('./types.js').PromotionUserApproval;
type PromotionEvidenceContract = import('./types.js').PromotionEvidence;
type TrustedPromotionEvidenceContract = import('./types.js').TrustedPromotionEvidence;
type TrustedPromotionUserApprovalContract = import('./types.js').TrustedPromotionUserApproval;
type PromotionEligibilityContextContract = import('./types.js').PromotionEligibilityContext;
type PromotionEligibilityDecisionContract = import('./types.js').PromotionEligibilityDecision;
type PromotionEligibilityGateContract = import('./types.js').PromotionEligibilityGate;

const OPENROUTER_AUDITION_MODES = ['RAW_MODEL_AUDITION', 'SANDBOX_AGENT_AUDITION'] as const;
const MAX_OPENROUTER_PROMPT_LENGTH = 32_768;
const MAX_OPENROUTER_COST_MICRODOLLARS = 10_000_000;
const MAX_OPENROUTER_TOKENS = 1_000_000;
const MAX_OPENROUTER_DURATION_MS = 600_000;
const MAX_OPENROUTER_REQUEST_AGE_MS = 5 * 60 * 1_000;
const MAX_PROMOTION_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const BENCHMARK_TYPES = ['RAW_MODEL', 'AGENT_HARNESS', 'FULL_WORKFLOW'] as const;
const BENCHMARK_EVIDENCE_FIELDS = [
  'FIXTURE_SHA256',
  'PROMPT_HASH',
  'ENVIRONMENT_HASH',
  'ARTIFACT_REFS',
  'POLICY_VIOLATIONS',
] as const;
const BENCHMARK_OUTCOME_FIELDS = [
  'COMPLETION_STATUS',
  'QUALITY_SCORE',
  'COST_MICRODOLLARS',
  'TOKEN_USAGE',
  'LATENCY_MS',
  'CRITICAL_SAFETY_FAILURES',
] as const;
const MAX_BENCHMARK_CANDIDATES = 8;
const MAX_PROMOTION_EVIDENCE_COUNT = 1_000_000;

function parseBenchmarkRoutingCandidate(value: unknown, path: string): RoutingCandidate {
  const record = parseRecord(value, path, ['agentProfileId', 'modelProfileId', 'toolProfileId']);
  return {
    agentProfileId: parseProfileId(record.agentProfileId, `${path}.agentProfileId`),
    modelProfileId: parseProfileId(record.modelProfileId, `${path}.modelProfileId`),
    toolProfileId: parseProfileId(record.toolProfileId, `${path}.toolProfileId`),
  };
}

function benchmarkRoutingCandidateKey(candidate: RoutingCandidate): string {
  return JSON.stringify([
    candidate.agentProfileId,
    candidate.modelProfileId,
    candidate.toolProfileId,
  ]);
}

function parseOpenRouterAuditionLimits(
  value: unknown,
  path: string,
): OpenRouterAuditionLimitsContract {
  const record = parseRecord(value, path, ['maxCostMicrodollars', 'maxTokens', 'maxDurationMs']);
  return {
    maxCostMicrodollars: parseIntegerInRange(
      record.maxCostMicrodollars,
      `${path}.maxCostMicrodollars`,
      0,
      MAX_OPENROUTER_COST_MICRODOLLARS,
    ),
    maxTokens: parseIntegerInRange(record.maxTokens, `${path}.maxTokens`, 1, MAX_OPENROUTER_TOKENS),
    maxDurationMs: parseIntegerInRange(
      record.maxDurationMs,
      `${path}.maxDurationMs`,
      1,
      MAX_OPENROUTER_DURATION_MS,
    ),
  };
}

/**
 * Parses the caller-controlled audition envelope. The trusted host injects its
 * fixed provider origin and credential alias after this boundary; any such
 * caller-controlled fields are rejected as unknown.
 */
export function parseOpenRouterAuditionRequest(input: unknown): OpenRouterAuditionRequestContract {
  const record = parseRecord(input, 'openRouterAuditionRequest', [
    'schemaVersion',
    'id',
    'requestedBy',
    'requestedAt',
    'mode',
    'candidate',
    'prompt',
    'limits',
  ]);
  const mode = parseEnum(record.mode, 'openRouterAuditionRequest.mode', OPENROUTER_AUDITION_MODES);
  const candidate = parseBenchmarkRoutingCandidate(
    record.candidate,
    'openRouterAuditionRequest.candidate',
  );
  if (mode === 'RAW_MODEL_AUDITION' && candidate.toolProfileId !== 'no-tools@1') {
    fail(
      'openRouterAuditionRequest.candidate.toolProfileId',
      'must be no-tools@1 for a raw-model audition',
    );
  }
  const requestedAt = parseTimestamp(record.requestedAt, 'openRouterAuditionRequest.requestedAt');
  const requestAgeMs = Date.now() - Date.parse(requestedAt);
  if (requestAgeMs < -MAX_CLOCK_SKEW_MS) {
    fail('openRouterAuditionRequest.requestedAt', 'must not be future-dated');
  }
  if (requestAgeMs > MAX_OPENROUTER_REQUEST_AGE_MS) {
    fail('openRouterAuditionRequest.requestedAt', 'must be no more than five minutes old');
  }

  return deepFreeze({
    schemaVersion: parseSchemaVersion(
      record.schemaVersion,
      'openRouterAuditionRequest.schemaVersion',
    ),
    id: parseId(record.id, 'openRouterAuditionRequest.id'),
    requestedBy: parseId(record.requestedBy, 'openRouterAuditionRequest.requestedBy'),
    requestedAt,
    mode,
    candidate,
    prompt: parseBoundedString(
      record.prompt,
      'openRouterAuditionRequest.prompt',
      MAX_OPENROUTER_PROMPT_LENGTH,
    ),
    limits: parseOpenRouterAuditionLimits(record.limits, 'openRouterAuditionRequest.limits'),
  });
}

function parseBenchmarkCandidates(
  value: unknown,
  path: string,
  benchmarkType: BenchmarkTypeContract,
): RoutingCandidate[] {
  const candidates = parseArray(value, path, MAX_BENCHMARK_CANDIDATES, 1).map((candidate, index) =>
    parseBenchmarkRoutingCandidate(candidate, `${path}[${index}]`),
  );
  const candidateKeys = candidates.map(benchmarkRoutingCandidateKey);
  if (new Set(candidateKeys).size !== candidateKeys.length) {
    fail(path, 'must not contain duplicate routing candidates');
  }
  if (benchmarkType === 'RAW_MODEL') {
    const toolBearingCandidateIndex = candidates.findIndex(
      (candidate) => candidate.toolProfileId !== 'no-tools@1',
    );
    if (toolBearingCandidateIndex !== -1) {
      fail(
        `${path}[${toolBearingCandidateIndex}].toolProfileId`,
        'must be no-tools@1 for a raw-model benchmark',
      );
    }
  }
  return candidates;
}

function parseBenchmarkEvidenceFields(
  value: unknown,
  path: string,
): BenchmarkEvidenceFieldContract[] {
  const fields = parseEnumList(value, path, BENCHMARK_EVIDENCE_FIELDS, 1);
  for (const requiredField of BENCHMARK_EVIDENCE_FIELDS) {
    if (!fields.includes(requiredField)) {
      fail(path, `must include ${requiredField}`);
    }
  }
  return fields;
}

function parseBenchmarkOutcomeFields(
  value: unknown,
  path: string,
): BenchmarkOutcomeFieldContract[] {
  const fields = parseEnumList(value, path, BENCHMARK_OUTCOME_FIELDS, 1);
  for (const requiredField of BENCHMARK_OUTCOME_FIELDS) {
    if (!fields.includes(requiredField)) {
      fail(path, `must include ${requiredField}`);
    }
  }
  return fields;
}

export function parseBenchmarkRun(input: unknown): BenchmarkRunContract {
  const record = parseRecord(input, 'benchmarkRun', [
    'schemaVersion',
    'id',
    'createdAt',
    'benchmarkType',
    'fixtureId',
    'taskCategoryId',
    'repetitions',
    'candidates',
    'evidenceFields',
    'outcomeFields',
  ]);
  const benchmarkType = parseEnum(
    record.benchmarkType,
    'benchmarkRun.benchmarkType',
    BENCHMARK_TYPES,
  );
  const createdAt = parseTimestamp(record.createdAt, 'benchmarkRun.createdAt');
  if (Date.parse(createdAt) > Date.now() + MAX_CLOCK_SKEW_MS) {
    fail('benchmarkRun.createdAt', 'must not be future-dated');
  }

  return deepFreeze({
    schemaVersion: parseSchemaVersion(record.schemaVersion, 'benchmarkRun.schemaVersion'),
    id: parseId(record.id, 'benchmarkRun.id'),
    createdAt,
    benchmarkType,
    fixtureId: parseId(record.fixtureId, 'benchmarkRun.fixtureId'),
    taskCategoryId: parseId(record.taskCategoryId, 'benchmarkRun.taskCategoryId'),
    repetitions: parseIntegerInRange(record.repetitions, 'benchmarkRun.repetitions', 1, 3),
    candidates: parseBenchmarkCandidates(
      record.candidates,
      'benchmarkRun.candidates',
      benchmarkType,
    ),
    evidenceFields: parseBenchmarkEvidenceFields(
      record.evidenceFields,
      'benchmarkRun.evidenceFields',
    ),
    outcomeFields: parseBenchmarkOutcomeFields(record.outcomeFields, 'benchmarkRun.outcomeFields'),
  });
}

function parsePromotionUserApprovalRecord(
  value: unknown,
  path: string,
): PromotionUserApprovalContract {
  const statusRecord = parseRecord(value, path, [
    'status',
    'approvalId',
    'evidenceId',
    'candidate',
    'taskCategoryId',
    'approvedBy',
    'approvedAt',
  ]);
  if (statusRecord.status === 'PENDING') {
    const pendingRecord = parseRecord(value, path, ['status']);
    return { status: parseEnum(pendingRecord.status, `${path}.status`, ['PENDING'] as const) };
  }
  if (statusRecord.status !== 'APPROVED') {
    fail(`${path}.status`, 'must be one of PENDING, APPROVED');
  }

  const approvedAt = parseTimestamp(statusRecord.approvedAt, `${path}.approvedAt`);
  if (Date.parse(approvedAt) > Date.now() + MAX_CLOCK_SKEW_MS) {
    fail(`${path}.approvedAt`, 'must not be future-dated');
  }

  return {
    status: 'APPROVED',
    approvalId: parseId(statusRecord.approvalId, `${path}.approvalId`),
    evidenceId: parseId(statusRecord.evidenceId, `${path}.evidenceId`),
    candidate: parseBenchmarkRoutingCandidate(statusRecord.candidate, `${path}.candidate`),
    taskCategoryId: parseId(statusRecord.taskCategoryId, `${path}.taskCategoryId`),
    approvedBy: parseId(statusRecord.approvedBy, `${path}.approvedBy`),
    approvedAt,
  };
}

/**
 * Validates and brands immutable evidence loaded from the server's benchmark
 * store. Never call this function on a client-submitted promotion summary.
 */
export function parseTrustedPromotionEvidence(input: unknown): TrustedPromotionEvidenceContract {
  const record = parseRecord(input, 'promotionEvidence', [
    'schemaVersion',
    'id',
    'createdAt',
    'candidate',
    'taskCategoryId',
    'benchmarkRunIds',
    'distinctCaseCount',
    'minimumRepetitionsPerCase',
    'criticalSafetyFailureCount',
    'qualityGatePassed',
  ]);
  const createdAt = parseTimestamp(record.createdAt, 'promotionEvidence.createdAt');
  if (Date.parse(createdAt) > Date.now() + MAX_CLOCK_SKEW_MS) {
    fail('promotionEvidence.createdAt', 'must not be future-dated');
  }
  const evidence = deepFreeze({
    schemaVersion: parseSchemaVersion(record.schemaVersion, 'promotionEvidence.schemaVersion'),
    id: parseId(record.id, 'promotionEvidence.id'),
    createdAt,
    candidate: parseBenchmarkRoutingCandidate(record.candidate, 'promotionEvidence.candidate'),
    taskCategoryId: parseId(record.taskCategoryId, 'promotionEvidence.taskCategoryId'),
    benchmarkRunIds: parseStableIdList(
      record.benchmarkRunIds,
      'promotionEvidence.benchmarkRunIds',
      1_000,
      1,
    ),
    distinctCaseCount: parseIntegerInRange(
      record.distinctCaseCount,
      'promotionEvidence.distinctCaseCount',
      0,
      MAX_PROMOTION_EVIDENCE_COUNT,
    ),
    minimumRepetitionsPerCase: parseIntegerInRange(
      record.minimumRepetitionsPerCase,
      'promotionEvidence.minimumRepetitionsPerCase',
      0,
      3,
    ),
    criticalSafetyFailureCount: parseIntegerInRange(
      record.criticalSafetyFailureCount,
      'promotionEvidence.criticalSafetyFailureCount',
      0,
      MAX_PROMOTION_EVIDENCE_COUNT,
    ),
    qualityGatePassed: parseBoolean(
      record.qualityGatePassed,
      'promotionEvidence.qualityGatePassed',
    ),
  }) as unknown as TrustedPromotionEvidenceContract;
  trustedPromotionEvidenceRecords.add(evidence);
  return evidence;
}

/**
 * Validates and brands an approval loaded through the server's authenticated
 * approval store. Raw request bodies are not approval authority.
 */
export function parseTrustedPromotionUserApproval(
  input: unknown,
): TrustedPromotionUserApprovalContract {
  const approval = deepFreeze(
    parsePromotionUserApprovalRecord(input, 'promotionApproval'),
  ) as TrustedPromotionUserApprovalContract;
  trustedPromotionApprovalRecords.add(approval);
  return approval;
}

/**
 * Evaluates only opaque server-loaded evidence and approval records. Approval
 * is never inferred from benchmark quality, and it is bound to the exact
 * evidence ID, task category, and versioned routing candidate.
 */
export function evaluatePromotionEligibility(
  input: PromotionEligibilityContextContract,
): PromotionEligibilityDecisionContract {
  const context = parseRecord(input, 'promotionEligibilityContext', ['evidence', 'userApproval']);
  const evidence = context.evidence;
  if (!isRecord(evidence) || !trustedPromotionEvidenceRecords.has(evidence)) {
    fail(
      'promotionEligibilityContext.evidence',
      'must be immutable evidence loaded from the trusted benchmark store',
    );
  }
  const userApproval = context.userApproval;
  if (!isRecord(userApproval) || !trustedPromotionApprovalRecords.has(userApproval)) {
    fail(
      'promotionEligibilityContext.userApproval',
      'must be loaded from the authenticated approval store',
    );
  }
  const trustedEvidence = evidence as unknown as PromotionEvidenceContract;
  const trustedApproval = userApproval as unknown as PromotionUserApprovalContract;
  const failedGates: PromotionEligibilityGateContract[] = [];

  if (trustedEvidence.distinctCaseCount < 10) {
    failedGates.push('DISTINCT_CASE_COUNT');
  }
  if (trustedEvidence.minimumRepetitionsPerCase < 3) {
    failedGates.push('REPETITIONS_PER_CASE');
  }
  if (trustedEvidence.criticalSafetyFailureCount !== 0) {
    failedGates.push('CRITICAL_SAFETY_FAILURES');
  }
  const nowEpochMs = Date.now();
  if (nowEpochMs - Date.parse(trustedEvidence.createdAt) > MAX_PROMOTION_EVIDENCE_AGE_MS) {
    failedGates.push('EVIDENCE_RECENCY');
  }
  if (!trustedEvidence.qualityGatePassed) {
    failedGates.push('QUALITY_GATE');
  }
  if (trustedApproval.status !== 'APPROVED') {
    failedGates.push('USER_APPROVAL');
  } else {
    const versionBindingMatches =
      trustedApproval.evidenceId === trustedEvidence.id &&
      trustedApproval.taskCategoryId === trustedEvidence.taskCategoryId &&
      benchmarkRoutingCandidateKey(trustedApproval.candidate) ===
        benchmarkRoutingCandidateKey(trustedEvidence.candidate) &&
      Date.parse(trustedApproval.approvedAt) >= Date.parse(trustedEvidence.createdAt);
    if (!versionBindingMatches) {
      failedGates.push('VERSION_BINDING');
    }
    if (nowEpochMs - Date.parse(trustedApproval.approvedAt) > MAX_PROMOTION_EVIDENCE_AGE_MS) {
      failedGates.push('APPROVAL_RECENCY');
    }
  }

  return deepFreeze({
    eligible: failedGates.length === 0,
    failedGates,
  });
}
