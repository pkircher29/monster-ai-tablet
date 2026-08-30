import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import {
  HubApiError,
  requestAgentStatus,
  requestDelegationPreview,
  type AgentRuntimeStatus,
  type AgentId,
  type AgentStatusCode,
  type AgentStatusRequester,
  type AgentStatusSnapshot,
  type DelegationPreviewRequester,
  type DelegationPreviewSummary,
} from './api';

type ConnectionState = 'online' | 'offline';
type AgentState = 'ready' | 'degraded' | 'offline' | 'unsupported';

interface AppProps {
  readonly connectionState?: ConnectionState;
  readonly previewRequester?: DelegationPreviewRequester;
  readonly agentStatusRequester?: AgentStatusRequester;
}

interface AgentManifestView {
  readonly id: AgentId;
  readonly name: string;
  readonly state: AgentState;
  readonly stateLabel: string;
  readonly runtime: string;
  readonly version: string;
  readonly bestFor: readonly [string, string];
  readonly doNotUseFor: string;
  readonly evidence: string;
  readonly actionLabel: string;
  readonly actionAvailable: boolean;
  readonly statusNote: string;
}

interface RouteStep {
  readonly id: string;
  readonly phase: string;
  readonly agent: string;
  readonly reason: string;
  readonly confidence: string;
  readonly reservedCost: string;
}

const AGENT_MANIFESTS: readonly AgentManifestView[] = [
  {
    id: 'hermes',
    name: 'Hermes',
    state: 'degraded',
    stateLabel: 'Degraded',
    runtime: 'Windows host',
    version: '0.20.5',
    bestFor: ['Planning and synthesis', 'Long-running agent work'],
    doNotUseFor: 'Unreviewed external actions or purchases',
    evidence: 'No hub benchmark recorded yet',
    actionLabel: 'Reconnect Hermes host',
    actionAvailable: false,
    statusNote: 'Host adapter is not connected in this preview.',
  },
  {
    id: 'codex',
    name: 'Codex',
    state: 'offline',
    stateLabel: 'Offline',
    runtime: 'Windows host',
    version: '0.150.1',
    bestFor: ['Repository implementation', 'Tests and code review'],
    doNotUseFor: 'Open-ended personal assistance without a code target',
    evidence: 'No hub benchmark recorded yet',
    actionLabel: 'Reconnect Codex host',
    actionAvailable: false,
    statusNote: 'Remote-control adapter is not connected.',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    state: 'offline',
    stateLabel: 'Offline',
    runtime: 'Windows host',
    version: '2.1.251',
    bestFor: ['Large-codebase analysis', 'Architecture and documentation'],
    doNotUseFor: 'Native execution inside Android Termux',
    evidence: 'No hub benchmark recorded yet',
    actionLabel: 'Reconnect Claude Code host',
    actionAvailable: false,
    statusNote: 'Remote-control adapter is not connected.',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    state: 'ready',
    stateLabel: 'Ready',
    runtime: 'Windows gateway',
    version: '2026.7.1-2',
    bestFor: ['Tablet companion actions', 'Bounded device handoffs'],
    doNotUseFor: 'Camera, contacts, or messages without explicit approval',
    evidence: 'Gateway and bounded tablet pairing previously verified',
    actionLabel: 'OpenClaw connected',
    actionAvailable: false,
    statusNote: 'Live gateway status is checked when the trusted host is online.',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    state: 'unsupported',
    stateLabel: 'Unsupported here',
    runtime: 'Windows desktop only',
    version: '2.9.1',
    bestFor: ['Visual IDE sessions', 'Supervised desktop workflows'],
    doNotUseFor: 'Direct Android execution',
    evidence: 'Android runtime unavailable; not benchmarked',
    actionLabel: 'View Antigravity limitation',
    actionAvailable: true,
    statusNote: 'Use the desktop application until a supported remote path exists.',
  },
];

const ROUTE_STEPS: readonly RouteStep[] = [
  {
    id: 'sample-research',
    phase: 'Research',
    agent: 'Hermes',
    reason: 'Planning and synthesis fit',
    confidence: '78%',
    reservedCost: '$0.04',
  },
  {
    id: 'sample-implementation',
    phase: 'Implement',
    agent: 'Codex',
    reason: 'Repository change fit',
    confidence: '84%',
    reservedCost: '$0.16',
  },
  {
    id: 'sample-verification',
    phase: 'Verify',
    agent: 'Claude Code',
    reason: 'Independent review fit',
    confidence: '80%',
    reservedCost: '$0.08',
  },
];

const AGENT_NAMES: Readonly<Record<string, string>> = {
  hermes: 'Hermes',
  codex: 'Codex',
  'claude-code': 'Claude Code',
  openclaw: 'OpenClaw',
  antigravity: 'Antigravity',
};

const STATUS_NOTES: Readonly<Record<AgentStatusCode, string>> = {
  AVAILABLE: 'Installed and responding on trusted host.',
  AUTHENTICATED: 'Installed and authenticated on trusted host.',
  CONNECTED: 'Connected to trusted host.',
  DESKTOP_ONLY: 'Supervised Windows desktop tool; no safe headless adapter is available.',
  UNAVAILABLE: 'Not detected on trusted host.',
  PROBE_TIMEOUT: 'Status check timed out safely.',
  PROBE_FAILED: 'Status check failed closed.',
};

function applyLiveAgentStatus(
  manifest: AgentManifestView,
  status: AgentRuntimeStatus | undefined,
): AgentManifestView {
  if (status === undefined) return manifest;
  const state = status.state.toLowerCase() as AgentState;
  const stateLabel =
    status.state === 'UNSUPPORTED'
      ? 'Desktop only'
      : status.state[0] + status.state.slice(1).toLowerCase();
  return {
    ...manifest,
    state,
    stateLabel,
    version: status.version ?? 'Not detected',
    evidence: `Trusted host check: ${status.statusCode.toLowerCase().replaceAll('_', ' ')}.`,
    actionLabel:
      status.id === 'antigravity'
        ? 'View Antigravity limitation'
        : `${manifest.name} status verified`,
    actionAvailable: status.id === 'antigravity',
    statusNote: STATUS_NOTES[status.statusCode],
  };
}

function formatMicrodollars(value: number): string {
  return `$${(value / 1_000_000).toFixed(2)}`;
}

function displayAgentName(profileId: string): string {
  const separator = profileId.lastIndexOf('@');
  const id = separator > 0 ? profileId.slice(0, separator) : profileId;
  return AGENT_NAMES[id] ?? id;
}

function routeStepsFor(preview: DelegationPreviewSummary | null): readonly RouteStep[] {
  if (preview === null) return ROUTE_STEPS;
  const assignmentByWorkItem = new Map(
    preview.assignments.map((assignment) => [assignment.workItemId, assignment]),
  );
  return preview.workItems.map((workItem) => {
    const assignment = assignmentByWorkItem.get(workItem.id);
    if (assignment === undefined) {
      throw new Error('Validated preview is missing a work-item assignment.');
    }
    return {
      id: workItem.id,
      phase: workItem.title,
      agent: displayAgentName(assignment.agentProfileId),
      reason: assignment.selectionReasons[0] ?? 'Eligible bounded route',
      confidence: `${Math.round(assignment.confidence * 100)}%`,
      reservedCost: formatMicrodollars(assignment.expectedCostMicrodollars),
    };
  });
}

function readBrowserConnectionState(): ConnectionState {
  return globalThis.navigator.onLine ? 'online' : 'offline';
}

function useConnectionState(forcedState: ConnectionState | undefined): ConnectionState {
  const [browserState, setBrowserState] = useState<ConnectionState>(readBrowserConnectionState);

  useEffect(() => {
    if (forcedState !== undefined) {
      return undefined;
    }

    const markOnline = () => {
      setBrowserState('online');
    };
    const markOffline = () => {
      setBrowserState('offline');
    };

    globalThis.addEventListener('online', markOnline);
    globalThis.addEventListener('offline', markOffline);

    return () => {
      globalThis.removeEventListener('online', markOnline);
      globalThis.removeEventListener('offline', markOffline);
    };
  }, [forcedState]);

  return forcedState ?? browserState;
}

function StatusMark({ state }: Readonly<{ state: AgentState }>) {
  const symbol = state === 'unsupported' ? '×' : '';

  return (
    <span className={`status-mark status-mark--${state}`} aria-hidden="true">
      {symbol}
    </span>
  );
}

function AgentCard({
  agent,
  onViewLimitation,
}: Readonly<{
  agent: AgentManifestView;
  onViewLimitation: () => void;
}>) {
  const statusNoteId = `${agent.id}-status-note`;

  return (
    <article className="agent-card" data-agent-id={agent.id}>
      <div className="agent-card__header">
        <div>
          <p className="module-label">Agent module</p>
          <h3>{agent.name}</h3>
        </div>
        <p className={`agent-status agent-status--${agent.state}`}>
          <StatusMark state={agent.state} />
          <span>{agent.stateLabel}</span>
        </p>
      </div>

      <dl className="runtime-strip">
        <div>
          <dt>Runtime</dt>
          <dd>{agent.runtime}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{agent.version}</dd>
        </div>
      </dl>

      <div className="guidance-block">
        <h4>Best for</h4>
        <ul>
          {agent.bestFor.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>

      <div className="guidance-block guidance-block--warning">
        <h4>Do not use for</h4>
        <p>{agent.doNotUseFor}</p>
      </div>

      <div className="evidence-block">
        <p className="module-label">Measured evidence</p>
        <p>{agent.evidence}</p>
      </div>

      <div className="agent-card__action">
        <button
          className={agent.actionAvailable ? 'button button--quiet' : 'button button--disabled'}
          type="button"
          disabled={!agent.actionAvailable}
          aria-describedby={statusNoteId}
          onClick={agent.id === 'antigravity' ? onViewLimitation : undefined}
        >
          {agent.actionLabel}
        </button>
        <p id={statusNoteId} className="action-note">
          {agent.statusNote}
        </p>
      </div>
    </article>
  );
}

function DelegationRail({ preview }: Readonly<{ preview: DelegationPreviewSummary | null }>) {
  const hasPlan = preview !== null;
  const routeSteps = routeStepsFor(preview);

  return (
    <section className="rail-module" aria-labelledby="delegation-title">
      <div className="section-heading section-heading--rail">
        <div>
          <p className="module-label">Route preview</p>
          <h2 id="delegation-title">Delegation rail</h2>
        </div>
        <p className="rail-mode">{hasPlan ? 'Proposed route' : 'Sample route'}</p>
      </div>

      <div className={`delegation-route ${hasPlan ? 'delegation-route--ready' : ''}`}>
        <div className="route-source">
          <span className="route-source__jack" aria-hidden="true" />
          <div>
            <p className="module-label">Input</p>
            <p>{hasPlan ? 'Your objective' : 'Awaiting objective'}</p>
          </div>
        </div>

        <ol className="route-steps">
          {routeSteps.map((step, index) => (
            <li className="route-step" key={step.id}>
              {index === 1 ? (
                <span className="approval-gate">
                  <span aria-hidden="true">Hold</span>
                  <span className="sr-only">Human approval gate before implementation</span>
                </span>
              ) : null}
              <article>
                <div className="route-step__topline">
                  <p className="route-step__phase">{step.phase}</p>
                  <p className="route-step__state">Proposed</p>
                </div>
                <h3>{step.agent}</h3>
                <p className="route-step__reason">{step.reason}</p>
                <dl>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{step.confidence}</dd>
                  </div>
                  <div>
                    <dt>Reserved</dt>
                    <dd>{step.reservedCost}</dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ol>
      </div>
      <p className="rail-caption">
        The amber gate interrupts the route before any implementation can begin.
      </p>
    </section>
  );
}

function LimitationDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = globalThis.document.activeElement;
    const keepFocusInDialog = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog !== null && event.target instanceof Node && !dialog.contains(event.target)) {
        closeButtonRef.current?.focus();
      }
    };

    closeButtonRef.current?.focus();
    globalThis.document.addEventListener('focusin', keepFocusInDialog);

    return () => {
      globalThis.document.removeEventListener('focusin', keepFocusInDialog);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, []);

  const trapDialogKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      closeButtonRef.current?.focus();
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="limitation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="limitation-title"
        aria-describedby="limitation-description"
        onKeyDown={trapDialogKeyboard}
      >
        <p className="module-label">Runtime boundary</p>
        <h2 id="limitation-title">Antigravity limitation</h2>
        <p className="dialog-callout">Desktop-only runtime</p>
        <p id="limitation-description">
          Antigravity does not have a supported Android runtime. Keep credentials and execution on
          the trusted Windows host; this tablet can expose a supervised remote path later.
        </p>
        <button
          ref={closeButtonRef}
          className="button button--primary"
          type="button"
          onClick={onClose}
        >
          Close limitation
        </button>
      </div>
    </div>
  );
}

export function App({
  connectionState: forcedConnectionState,
  previewRequester = requestDelegationPreview,
  agentStatusRequester = requestAgentStatus,
}: AppProps) {
  const connectionState = useConnectionState(forcedConnectionState);
  const [objective, setObjective] = useState('');
  const [preview, setPreview] = useState<DelegationPreviewSummary | null>(null);
  const [previewBudgetCap, setPreviewBudgetCap] = useState<number | null>(null);
  const [objectiveValidationError, setObjectiveValidationError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [showLimitation, setShowLimitation] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatusSnapshot | null>(null);
  const [agentStatusState, setAgentStatusState] = useState<
    'awaiting' | 'checking' | 'verified' | 'unavailable'
  >('awaiting');
  const activePreviewRequestRef = useRef<AbortController | null>(null);
  const previewRequestGenerationRef = useRef(0);
  const isOffline = connectionState === 'offline';
  const liveStatusById = new Map(agentStatus?.agents.map((status) => [status.id, status]) ?? []);
  const displayedAgents = AGENT_MANIFESTS.map((manifest) =>
    applyLiveAgentStatus(manifest, liveStatusById.get(manifest.id)),
  );

  const invalidatePreviewRequest = useCallback(() => {
    previewRequestGenerationRef.current += 1;
    activePreviewRequestRef.current?.abort();
    activePreviewRequestRef.current = null;
  }, []);

  useEffect(
    () => () => {
      invalidatePreviewRequest();
    },
    [invalidatePreviewRequest],
  );

  useEffect(() => {
    if (!isOffline) return;

    invalidatePreviewRequest();
    setIsPlanning(false);
    setPreview(null);
    setPreviewBudgetCap(null);
  }, [invalidatePreviewRequest, isOffline]);

  useEffect(() => {
    if (isOffline) {
      setAgentStatus(null);
      setAgentStatusState('awaiting');
      return undefined;
    }

    const controller = new AbortController();
    setAgentStatusState('checking');
    void agentStatusRequester({ signal: controller.signal }).then(
      (snapshot) => {
        if (controller.signal.aborted) return;
        setAgentStatus(snapshot);
        setAgentStatusState('verified');
      },
      () => {
        if (controller.signal.aborted) return;
        setAgentStatus(null);
        setAgentStatusState('unavailable');
      },
    );
    return () => controller.abort();
  }, [agentStatusRequester, isOffline]);

  const handlePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedObjective = objective.trim();

    if (trimmedObjective.length === 0) {
      invalidatePreviewRequest();
      setIsPlanning(false);
      setObjectiveValidationError('Describe the outcome first. Nothing was planned or started.');
      setRequestError(null);
      setPreview(null);
      setPreviewBudgetCap(null);
      return;
    }

    if (isOffline) {
      invalidatePreviewRequest();
      setIsPlanning(false);
      setObjectiveValidationError(null);
      setRequestError('Reconnect to the trusted host before requesting a route preview.');
      setPreview(null);
      setPreviewBudgetCap(null);
      return;
    }

    const form = new FormData(event.currentTarget);
    const workspace = String(form.get('workspace') ?? '');
    const budgetCapMicrodollars = Number(form.get('budget'));
    invalidatePreviewRequest();
    const requestGeneration = previewRequestGenerationRef.current;
    const requestController = new AbortController();
    activePreviewRequestRef.current = requestController;

    setObjectiveValidationError(null);
    setRequestError(null);
    setPreview(null);
    setPreviewBudgetCap(null);
    setIsPlanning(true);
    try {
      const nextPreview = await previewRequester(
        {
          objective: trimmedObjective,
          workspace,
          budgetCapMicrodollars,
        },
        { signal: requestController.signal },
      );
      if (
        requestController.signal.aborted ||
        previewRequestGenerationRef.current !== requestGeneration
      ) {
        return;
      }
      setPreview(nextPreview);
      setPreviewBudgetCap(budgetCapMicrodollars);
    } catch (error) {
      if (
        requestController.signal.aborted ||
        previewRequestGenerationRef.current !== requestGeneration
      ) {
        return;
      }
      setRequestError(
        error instanceof HubApiError
          ? error.message
          : 'The trusted host could not create a safe route preview.',
      );
    } finally {
      if (
        !requestController.signal.aborted &&
        previewRequestGenerationRef.current === requestGeneration
      ) {
        activePreviewRequestRef.current = null;
        setIsPlanning(false);
      }
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to objective
      </a>
      <p
        className="sr-only"
        role="status"
        aria-label="Connectivity status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isOffline
          ? 'Network offline. Catalog guidance remains available, but previews are locked.'
          : 'Network online. Trusted-host previews are available.'}
      </p>

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <p className="brand-kicker">Personal dispatch board</p>
            <h1>Monster Agent Hub</h1>
          </div>
        </div>

        <div className="health-summary" aria-label="System health summary">
          <div className="health-item">
            <span className="status-mark status-mark--ready" aria-hidden="true" />
            <span>
              <strong>Tablet shell</strong>
              <small>Ready</small>
            </span>
          </div>
          <div className="health-item">
            <StatusMark state={isOffline ? 'offline' : 'ready'} />
            <span>
              <strong>Network</strong>
              <small>{isOffline ? 'Offline' : 'Online'}</small>
            </span>
          </div>
          <div className="health-item">
            <StatusMark
              state={isOffline ? 'offline' : agentStatusState === 'verified' ? 'ready' : 'degraded'}
            />
            <span>
              <strong>Host link</strong>
              <small>
                {isOffline
                  ? 'Offline'
                  : agentStatusState === 'verified'
                    ? 'Agents verified'
                    : agentStatusState === 'unavailable'
                      ? 'Status unavailable'
                      : 'Checking agents'}
              </small>
            </span>
          </div>
        </div>
      </header>

      {isOffline ? (
        <aside className="offline-banner" aria-labelledby="offline-title">
          <div>
            <p id="offline-title">Offline catalog</p>
            <p>Launches and approvals stay locked until the trusted host reconnects.</p>
          </div>
          <span className="offline-banner__mode">Read only</span>
        </aside>
      ) : null}

      <main id="main-content">
        <section className="composer-module" aria-labelledby="composer-title">
          <div className="composer-intro">
            <p className="module-label">Objective input · preview only</p>
            <h2 id="composer-title">What should the crew accomplish?</h2>
            <p>Describe the outcome. Planning proposes assignments; it never launches an agent.</p>
          </div>

          <form className="objective-form" noValidate aria-busy={isPlanning} onSubmit={handlePlan}>
            <label className="objective-field" htmlFor="objective">
              <span>Objective</span>
              <textarea
                id="objective"
                name="objective"
                rows={3}
                value={objective}
                aria-invalid={objectiveValidationError !== null}
                aria-describedby={
                  objectiveValidationError === null ? 'objective-hint' : 'objective-error'
                }
                aria-required="true"
                placeholder="Example: review the tablet hub, repair the weak spots, and verify the release"
                onChange={(event) => {
                  setObjective(event.currentTarget.value);
                  invalidatePreviewRequest();
                  setIsPlanning(false);
                  setPreview(null);
                  setPreviewBudgetCap(null);
                  if (objectiveValidationError !== null) {
                    setObjectiveValidationError(null);
                  }
                }}
              />
            </label>
            <p id="objective-hint" className="field-hint">
              No credentials, shell commands, or hidden instructions are accepted here.
            </p>
            {objectiveValidationError === null ? null : (
              <p id="objective-error" className="form-error" role="alert">
                {objectiveValidationError}
              </p>
            )}
            {requestError === null ? null : (
              <p className="form-error" role="alert">
                {requestError}
              </p>
            )}

            <div className="planning-controls">
              <label htmlFor="workspace">
                <span>Workspace</span>
                <select id="workspace" name="workspace" defaultValue="monster-agent-hub">
                  <option value="monster-agent-hub">Monster Agent Hub</option>
                </select>
              </label>
              <label htmlFor="budget">
                <span>Budget cap</span>
                <select id="budget" name="budget" defaultValue="400000">
                  <option value="250000">$0.25</option>
                  <option value="400000">$0.40</option>
                </select>
              </label>
              <button
                className="button button--plan"
                type="submit"
                disabled={isOffline || isPlanning}
              >
                <span>{isPlanning ? 'Planning…' : 'Plan work'}</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>

          {preview === null ? null : (
            <section className="plan-preview" aria-label="Plan preview" aria-live="polite">
              <div>
                <p className="plan-preview__status">Plan preview ready</p>
                <p className="plan-preview__objective">{preview.objective}</p>
              </div>
              <dl>
                <div>
                  <dt>Scope</dt>
                  <dd>{preview.workItems.length} work items</dd>
                </div>
                <div>
                  <dt>Reserved</dt>
                  <dd>
                    {formatMicrodollars(preview.estimatedTotalCostMicrodollars)} of{' '}
                    {formatMicrodollars(previewBudgetCap ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Execution</dt>
                  <dd>No work started</dd>
                </div>
              </dl>
            </section>
          )}
        </section>

        <DelegationRail preview={preview} />

        <div className="workbench-grid">
          <section className="agent-rack" aria-labelledby="agent-rack-title">
            <div className="section-heading">
              <div>
                <p className="module-label">Declared fit + measured evidence</p>
                <h2 id="agent-rack-title">Agent rack</h2>
              </div>
              <p className="rack-count">5 profiles</p>
            </div>

            <div className="agent-grid">
              {displayedAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onViewLimitation={() => {
                    setShowLimitation(true);
                  }}
                />
              ))}
            </div>
          </section>

          <aside className="live-work" aria-labelledby="live-work-title">
            <div className="section-heading">
              <div>
                <p className="module-label">Decision queue</p>
                <h2 id="live-work-title">Approvals / live work</h2>
              </div>
            </div>

            <section className="decision-card" aria-labelledby="decision-title">
              <p className="decision-card__flag">Human gate</p>
              <h3 id="decision-title">
                {preview === null ? 'No plan awaiting approval' : 'Review plan preview'}
              </h3>
              <p>
                {preview === null
                  ? 'Create a preview to see authority and cost before anything can run.'
                  : `Preview cost: ${formatMicrodollars(preview.estimatedTotalCostMicrodollars)}. No execution authority has been granted.`}
              </p>
              <button className="button button--approval" type="button" disabled>
                Approve and run
              </button>
              <p className="action-note">
                Execution is deliberately unavailable in this preview-only milestone.
              </p>
            </section>

            <section className="live-state" aria-labelledby="live-state-title">
              <div className="live-state__header">
                <h3 id="live-state-title">Live state</h3>
                <span className="state-counter">0 active</span>
              </div>
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden="true">
                  ∥
                </span>
                <div>
                  <p>No live tasks</p>
                  <p>
                    {isOffline
                      ? 'Catalog and guidance remain available.'
                      : 'No external actions have been authorized.'}
                  </p>
                </div>
              </div>
            </section>

            <div className="stop-panel">
              <div>
                <p>Emergency control</p>
                <span>Stops an active run and all descendants.</span>
              </div>
              <button className="button button--stop" type="button" disabled>
                Stop all
              </button>
            </div>
          </aside>
        </div>
      </main>

      <footer>
        <div>
          <p className="module-label">Evidence log</p>
          <p>No outcomes recorded. Preview activity remains on this tablet.</p>
        </div>
        <p className="footer-mode">
          <span
            className={`status-mark status-mark--${preview !== null || agentStatusState === 'verified' ? 'ready' : 'degraded'}`}
            aria-hidden="true"
          />
          {preview !== null
            ? 'Host-validated preview · no execution'
            : agentStatusState === 'verified'
              ? 'Host status verified · no execution'
              : 'Preview shell · awaiting host'}
        </p>
      </footer>

      {showLimitation ? (
        <LimitationDialog
          onClose={() => {
            setShowLimitation(false);
          }}
        />
      ) : null}
    </div>
  );
}
