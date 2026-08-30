import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import {
  HubApiError,
  type AgentStatusRequester,
  type AgentStatusSnapshot,
  type DelegationPreviewRequester,
  type DelegationPreviewSummary,
  type DelegationAssignment,
  type DelegationAssignmentRequester,
  type ToolReconRequester,
  type ToolReconSnapshot,
} from './api';

const SERVER_PREVIEW: DelegationPreviewSummary = {
  objective: 'Audit the tablet hub, fix the accessibility issues, and verify the release.',
  workItems: [
    { id: 'research', title: 'Research' },
    { id: 'implementation', title: 'Implementation' },
    { id: 'verification', title: 'Verification' },
    { id: 'review', title: 'Review' },
  ],
  assignments: [
    {
      workItemId: 'research',
      agentProfileId: 'hermes@0.20.5',
      selectionReasons: ['Expert capability', 'Current evidence', 'Within budget'],
      expectedCostMicrodollars: 20_000,
      confidence: 0.9,
      requiredApprovals: ['approval.local-review'],
    },
    {
      workItemId: 'implementation',
      agentProfileId: 'codex@0.150.1',
      selectionReasons: ['Expert capability', 'Current evidence', 'Within budget'],
      expectedCostMicrodollars: 30_000,
      confidence: 0.92,
      requiredApprovals: ['approval.local-review'],
    },
    {
      workItemId: 'verification',
      agentProfileId: 'codex@0.150.1',
      selectionReasons: ['Expert capability', 'Current evidence', 'Within budget'],
      expectedCostMicrodollars: 30_000,
      confidence: 0.91,
      requiredApprovals: ['approval.local-review'],
    },
    {
      workItemId: 'review',
      agentProfileId: 'claude-code@2.1.251',
      selectionReasons: ['Expert capability', 'Current evidence', 'Within budget'],
      expectedCostMicrodollars: 20_000,
      confidence: 0.94,
      requiredApprovals: ['approval.local-review'],
    },
  ],
  estimatedTotalCostMicrodollars: 100_000,
};

const LIVE_AGENT_STATUS: AgentStatusSnapshot = {
  schemaVersion: 1,
  mode: 'READ_ONLY',
  observedAt: '2026-08-30T12:00:00.000Z',
  agents: [
    { id: 'hermes', state: 'READY', statusCode: 'AVAILABLE', version: '0.20.5' },
    { id: 'codex', state: 'READY', statusCode: 'AUTHENTICATED', version: '0.150.1' },
    {
      id: 'claude-code',
      state: 'READY',
      statusCode: 'AUTHENTICATED',
      version: '2.1.251',
    },
    { id: 'openclaw', state: 'READY', statusCode: 'AVAILABLE', version: '2026.7.1-2' },
    {
      id: 'antigravity',
      state: 'UNSUPPORTED',
      statusCode: 'DESKTOP_ONLY',
      version: null,
    },
  ],
};

const TOOL_RECON: ToolReconSnapshot = {
  schemaVersion: 1,
  mode: 'READ_ONLY',
  source: 'AI_SPY',
  observedAt: '2026-08-30T09:00:00.000Z',
  catalogCount: 14,
  installedCount: 2,
  tools: [
    {
      id: 'claude-code',
      name: 'Claude Code',
      category: 'HARNESS',
      vendor: 'Anthropic',
      detection: 'BOTH',
    },
    {
      id: 'ollama',
      name: 'Ollama',
      category: 'LOCAL_MODEL',
      vendor: 'Ollama',
      detection: 'PROFILE',
    },
  ],
  restrictedCapabilities: [
    'COMMAND_EXECUTION_DISABLED',
    'KEY_MANAGEMENT_DISABLED',
    'NETWORK_SCAN_DISABLED',
  ],
};

const QUEUED_ASSIGNMENT: DelegationAssignment = {
  schemaVersion: 1,
  mode: 'ASSIGNED',
  assignmentId: 'assignment.11111111-1111-4111-8111-111111111111',
  queuedAt: '2026-08-30T12:00:00.000Z',
  objective: SERVER_PREVIEW.objective,
  items: SERVER_PREVIEW.assignments.map((item) => ({
    workItemId: item.workItemId,
    title: SERVER_PREVIEW.workItems.find((workItem) => workItem.id === item.workItemId)!.title,
    agentProfileId: item.agentProfileId,
    state: 'QUEUED' as const,
  })),
  commandExecution: 'DISABLED',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controlledRequester(promise: Promise<DelegationPreviewSummary>) {
  const observed: { signal?: AbortSignal } = {};
  const requester = vi.fn(
    (
      _request: Parameters<DelegationPreviewRequester>[0],
      options?: { readonly signal?: AbortSignal },
    ) => {
      if (options?.signal !== undefined) {
        observed.signal = options.signal;
      }
      return promise;
    },
  ) as unknown as DelegationPreviewRequester;
  return { requester, observed };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Monster Agent Hub tablet shell', () => {
  it('shows the merged AI-Spy inventory as read-only reconnaissance', async () => {
    const reconRequester = vi.fn<ToolReconRequester>().mockResolvedValue(TOOL_RECON);
    render(<App connectionState="online" reconRequester={reconRequester} />);

    const recon = await screen.findByRole('region', { name: 'AI-Spy reconnaissance' });
    expect(within(recon).getByText('2 of 14 detected')).toBeInTheDocument();
    expect(within(recon).getByText('Claude Code')).toBeInTheDocument();
    expect(within(recon).getByText('Ollama')).toBeInTheDocument();
    expect(within(recon).getByText('Harness')).toBeInTheDocument();
    expect(within(recon).getByText('Local model')).toBeInTheDocument();
    expect(within(recon).getByText(/require a separate one-use approval/)).toBeInTheDocument();
    expect(within(recon).getByRole('link', { name: 'Open full AI-Spy console' })).toHaveAttribute(
      'href',
      '/ai-spy/',
    );
    expect(within(recon).queryByRole('button')).not.toBeInTheDocument();
    expect(reconRequester).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('replaces declared availability with the trusted host status without exposing diagnostics', async () => {
    const statusRequester = vi.fn<AgentStatusRequester>().mockResolvedValue(LIVE_AGENT_STATUS);
    render(<App connectionState="online" agentStatusRequester={statusRequester} />);

    const rack = screen.getByRole('region', { name: 'Agent rack' });
    const codexCard = within(rack)
      .getByRole('heading', { level: 3, name: 'Codex' })
      .closest('article') as HTMLElement;
    expect(await within(codexCard).findByText('Ready')).toBeInTheDocument();
    expect(
      within(codexCard).getByText('Installed and authenticated on trusted host.'),
    ).toBeInTheDocument();
    expect(within(codexCard).getByText('0.150.1')).toBeInTheDocument();
    expect(screen.getByText('Agents verified')).toBeInTheDocument();
    expect(screen.getByText('Host status verified · no execution')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('private@example.test');
    expect(statusRequester).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('presents the dispatch landmarks and all five manifest-shaped agent modules', () => {
    render(<App connectionState="offline" />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Monster Agent Hub' }),
    ).toBeInTheDocument();

    const rack = screen.getByRole('region', { name: 'Agent rack' });
    for (const name of ['Hermes', 'Codex', 'Claude Code', 'OpenClaw', 'Antigravity']) {
      const heading = within(rack).getByRole('heading', { level: 3, name });
      const card = heading.closest('article');

      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText('Best for')).toBeInTheDocument();
      expect(within(card as HTMLElement).getByText('Do not use for')).toBeInTheDocument();
      expect(within(card as HTMLElement).getByText('Measured evidence')).toBeInTheDocument();
    }

    const openClawCard = within(rack)
      .getByRole('heading', { level: 3, name: 'OpenClaw' })
      .closest('article');
    expect(openClawCard).not.toBeNull();
    expect(within(openClawCard as HTMLElement).getByText('Ready')).toBeInTheDocument();
    expect(
      within(openClawCard as HTMLElement).getByText(
        'Live gateway status is checked when the trusted host is online.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenClaw connected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'View Antigravity limitation' })).toBeEnabled();
  });

  it('turns an objective into a review-only delegation preview without starting work', async () => {
    const user = userEvent.setup();
    const previewRequester = vi.fn().mockResolvedValue(SERVER_PREVIEW);
    render(<App connectionState="online" previewRequester={previewRequester} />);

    await user.type(
      screen.getByLabelText('Objective'),
      'Audit the tablet hub, fix the accessibility issues, and verify the release.',
    );
    await user.click(screen.getByRole('button', { name: 'Plan work' }));

    const preview = screen.getByRole('region', { name: 'Plan preview' });
    expect(within(preview).getByText('Plan preview ready')).toBeInTheDocument();
    expect(
      within(preview).getByText(
        'Audit the tablet hub, fix the accessibility issues, and verify the release.',
      ),
    ).toBeInTheDocument();
    expect(within(preview).getByText('No work started')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign work' })).toBeEnabled();
    expect(screen.getByText('4 work items')).toBeInTheDocument();
    expect(screen.getByText('$0.10 of $0.40')).toBeInTheDocument();

    expect(previewRequester).toHaveBeenCalledWith(
      {
        objective: 'Audit the tablet hub, fix the accessibility issues, and verify the release.',
        workspace: 'monster-agent-hub',
        budgetCapMicrodollars: 400_000,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.queryByRole('option', { name: '$1.00' })).not.toBeInTheDocument();
    const rail = screen.getByRole('region', { name: 'Delegation rail' });
    expect(within(rail).getAllByRole('listitem')).toHaveLength(4);
    expect(
      within(rail)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Hermes', 'Codex', 'Codex', 'Claude Code']);
  });

  it('queues the reviewed work when the operator explicitly assigns it', async () => {
    const user = userEvent.setup();
    const previewRequester = vi.fn().mockResolvedValue(SERVER_PREVIEW);
    const assignmentRequester = vi
      .fn<DelegationAssignmentRequester>()
      .mockResolvedValue(QUEUED_ASSIGNMENT);
    render(
      <App
        connectionState="online"
        previewRequester={previewRequester}
        assignmentRequester={assignmentRequester}
      />,
    );

    await user.type(screen.getByLabelText('Objective'), SERVER_PREVIEW.objective);
    await user.click(screen.getByRole('button', { name: 'Plan work' }));
    await user.click(screen.getByRole('button', { name: 'Assign work' }));

    expect(await screen.findByRole('button', { name: 'Work assigned' })).toBeDisabled();
    expect(screen.getByText('4 queued')).toBeInTheDocument();
    expect(screen.getByText('Assignment queued')).toBeInTheDocument();
    expect(screen.getByText(/4 work items are queued/)).toBeInTheDocument();
    expect(assignmentRequester).toHaveBeenCalledWith({
      objective: SERVER_PREVIEW.objective,
      workspace: 'monster-agent-hub',
      budgetCapMicrodollars: 400_000,
    });
  });

  it('aborts and ignores an in-flight preview when the objective changes', async () => {
    const user = userEvent.setup();
    const pending = deferred<DelegationPreviewSummary>();
    const { requester, observed } = controlledRequester(pending.promise);
    render(<App connectionState="online" previewRequester={requester} />);

    const objective = screen.getByLabelText('Objective');
    await user.type(objective, SERVER_PREVIEW.objective);
    await user.click(screen.getByRole('button', { name: 'Plan work' }));
    await user.type(objective, ' Use the revised scope.');

    expect(observed.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(SERVER_PREVIEW));
    expect(screen.queryByText('Plan preview ready')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan work' })).toBeEnabled();
  });

  it('aborts and ignores an in-flight preview when connectivity is lost', async () => {
    const user = userEvent.setup();
    const pending = deferred<DelegationPreviewSummary>();
    const { requester, observed } = controlledRequester(pending.promise);
    const { rerender } = render(<App connectionState="online" previewRequester={requester} />);

    await user.type(screen.getByLabelText('Objective'), SERVER_PREVIEW.objective);
    await user.click(screen.getByRole('button', { name: 'Plan work' }));
    rerender(<App connectionState="offline" previewRequester={requester} />);

    expect(observed.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(SERVER_PREVIEW));
    expect(screen.queryByText('Plan preview ready')).not.toBeInTheDocument();
    expect(screen.getByText('Offline catalog')).toBeInTheDocument();
  });

  it('aborts an in-flight preview when the app unmounts', async () => {
    const user = userEvent.setup();
    const pending = deferred<DelegationPreviewSummary>();
    const { requester, observed } = controlledRequester(pending.promise);
    const { unmount } = render(<App connectionState="online" previewRequester={requester} />);

    await user.type(screen.getByLabelText('Objective'), SERVER_PREVIEW.objective);
    await user.click(screen.getByRole('button', { name: 'Plan work' }));
    unmount();

    expect(observed.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(SERVER_PREVIEW));
  });

  it('allows only the latest overlapping request to update the preview', async () => {
    const user = userEvent.setup();
    const first = deferred<DelegationPreviewSummary>();
    const second = deferred<DelegationPreviewSummary>();
    const signals: AbortSignal[] = [];
    let requestCount = 0;
    const requester = vi.fn(
      (
        _request: Parameters<DelegationPreviewRequester>[0],
        options?: { readonly signal?: AbortSignal },
      ) => {
        requestCount += 1;
        if (options?.signal !== undefined) signals.push(options.signal);
        return requestCount === 1 ? first.promise : second.promise;
      },
    ) as unknown as DelegationPreviewRequester;
    const latestPreview = {
      ...SERVER_PREVIEW,
      workItems: SERVER_PREVIEW.workItems.map((workItem, index) =>
        index === 0 ? { ...workItem, title: 'Latest bounded research' } : workItem,
      ),
    };
    render(<App connectionState="online" previewRequester={requester} />);

    const objective = screen.getByLabelText('Objective');
    await user.type(objective, SERVER_PREVIEW.objective);
    const form = objective.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await act(async () => second.resolve(latestPreview));
    expect(screen.getByText('Plan preview ready')).toBeInTheDocument();
    expect(screen.getByText('Latest bounded research')).toBeInTheDocument();

    await act(async () => first.resolve(SERVER_PREVIEW));
    expect(signals[0]?.aborted).toBe(true);
    expect(screen.getByText('Latest bounded research')).toBeInTheDocument();
  });

  it('reports a safe host error without presenting a stale preview', async () => {
    const user = userEvent.setup();
    const previewRequester = vi
      .fn()
      .mockRejectedValue(new HubApiError('HOST_UNAVAILABLE', 'The trusted host is unavailable.'));
    render(<App connectionState="online" previewRequester={previewRequester} />);

    const objective = screen.getByLabelText('Objective');
    await user.type(objective, 'Review the tablet hub.');
    await user.click(screen.getByRole('button', { name: 'Plan work' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The trusted host is unavailable.');
    expect(objective).not.toHaveAttribute('aria-invalid', 'true');
    expect(objective).toHaveAttribute('aria-describedby', 'objective-hint');
    expect(screen.queryByText('Plan preview ready')).not.toBeInTheDocument();
    expect(screen.getByText('Sample route')).toBeInTheDocument();

    await user.type(objective, ' Keep the revised request local.');
    expect(screen.getByRole('alert')).toHaveTextContent('The trusted host is unavailable.');
  });

  it('keeps an empty objective unchanged and explains the safe next action', async () => {
    const user = userEvent.setup();
    render(<App connectionState="online" />);

    await user.click(screen.getByRole('button', { name: 'Plan work' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Describe the outcome first. Nothing was planned or started.',
    );
    expect(screen.getByLabelText('Objective')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Objective')).toHaveAttribute(
      'aria-describedby',
      'objective-error',
    );
    expect(screen.queryByText('Plan preview ready')).not.toBeInTheDocument();
  });

  it('announces live browser connectivity transitions', () => {
    const online = vi.spyOn(globalThis.navigator, 'onLine', 'get').mockReturnValue(true);
    render(<App />);

    const status = screen.getByRole('status', { name: 'Connectivity status' });
    expect(status).toHaveTextContent('Network online. Trusted-host previews are available.');

    online.mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });

    expect(status).toHaveTextContent(
      'Network offline. Catalog guidance remains available, but previews are locked.',
    );
  });

  it('makes offline execution controls unavailable while preserving readable guidance', () => {
    render(<App connectionState="offline" />);

    expect(screen.getByText('Offline catalog')).toBeInTheDocument();
    expect(
      screen.getByText('Launches and approvals stay locked until the trusted host reconnects.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign work' })).toBeDisabled();
    expect(screen.getByText('Catalog and guidance remain available.')).toBeInTheDocument();
  });

  it('traps focus in the Antigravity limitation sheet and restores its opener', async () => {
    const user = userEvent.setup();
    render(<App connectionState="offline" />);

    const opener = screen.getByRole('button', { name: 'View Antigravity limitation' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Antigravity limitation' });
    const close = within(dialog).getByRole('button', { name: 'Close limitation' });
    expect(dialog).toHaveTextContent('Desktop-only runtime');
    expect(close).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();

    screen.getByRole('button', { name: 'Plan work' }).focus();
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Antigravity limitation' }),
    ).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('has no automatically detectable WCAG A or AA violations', async () => {
    const { container } = render(<App connectionState="offline" />);
    const result = await axe.run(container, {
      rules: {
        // jsdom cannot calculate rendered colors; browser verification covers contrast.
        'color-contrast': { enabled: false },
      },
      runOnly: ['wcag2a', 'wcag2aa'],
    });

    expect(result.violations).toEqual([]);
  });
});
