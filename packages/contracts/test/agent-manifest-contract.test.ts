import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAgentManifest } from '../src/index.ts';

function validManifest() {
  return {
    schemaVersion: 1,
    id: 'codex-windows',
    displayName: 'Codex',
    summary: 'Repository coding agent running on the trusted Windows host.',
    version: '0.150.1',
    runtimeLocation: 'WINDOWS_HOST',
    adapterId: 'codex-app-server',
    availabilityProbe: {
      kind: 'HTTP',
      url: 'http://127.0.0.1:9119/health',
      timeoutMs: 3_000,
    },
    launchModes: ['INTERACTIVE', 'REMOTE_CONTROL', 'DELEGATED'],
    capabilities: [
      {
        capabilityId: 'code.implementation',
        support: 'NATIVE',
        declaredLevel: 'EXPERT',
        requiredToolProfileIds: ['repository-write'],
        maximumRisk: 'HIGH',
      },
      {
        capabilityId: 'image.generation',
        support: 'UNSUPPORTED',
        declaredLevel: 'BASIC',
        requiredToolProfileIds: [],
        maximumRisk: 'LOW',
      },
    ],
    bestFor: [
      'Implementing bounded repository changes with tests.',
      'Debugging failures that require code and terminal access.',
    ],
    doNotUseFor: [
      'Always-on personal-assistant messaging.',
      'Unapproved deployment or purchasing actions.',
    ],
    requiredApprovals: ['external.side-effect'],
    supportedHandoffTypes: ['task', 'review', 'artifact'],
    lifecycleState: 'ACTIVE',
  };
}

type ManifestFixture = ReturnType<typeof validManifest>;

test('agent manifest v1 accepts a complete bounded manifest', () => {
  const input = validManifest();
  const parsed = parseAgentManifest(input);

  assert.deepEqual(parsed, input);
  assert.equal(parsed.id, 'codex-windows');
  assert.equal(parsed.displayName, 'Codex');
  assert.equal(parsed.version, '0.150.1');
  assert.equal(parsed.runtimeLocation, 'WINDOWS_HOST');
  assert.equal(parsed.adapterId, 'codex-app-server');
  assert.equal(parsed.availabilityProbe.kind, 'HTTP');
  assert.equal(parsed.capabilities[0]?.support, 'NATIVE');
  assert.equal(parsed.capabilities[1]?.support, 'UNSUPPORTED');
  assert.deepEqual(parsed.supportedHandoffTypes, ['task', 'review', 'artifact']);
  assert.equal(parsed.lifecycleState, 'ACTIVE');
});

test('agent manifest v1 rejects unknown fields at every public record boundary', async (t) => {
  await t.test('top-level fields', () => {
    const input = validManifest();
    Object.assign(input, { arbitraryMetadata: true });

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('availability probe fields', () => {
    const input = validManifest();
    Object.assign(input.availabilityProbe, { intervalMs: 1_000 });

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('capability fields', () => {
    const input = validManifest();
    Object.assign(input.capabilities[0]!, { routingScore: 100 });

    assert.throws(() => parseAgentManifest(input));
  });
});

test('availability probes cannot carry arbitrary executable content', async (t) => {
  await t.test('command fields are rejected', () => {
    const input = validManifest();
    Object.assign(input.availabilityProbe, { command: 'powershell -File probe.ps1' });

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('script fields are rejected', () => {
    const input = validManifest();
    Object.assign(input.availabilityProbe, { script: 'fetch("https://example.invalid")' });

    assert.throws(() => parseAgentManifest(input));
  });
});

test('agent manifest v1 rejects duplicate set-like declarations', async (t) => {
  const cases: Array<{
    name: string;
    mutate: (input: ManifestFixture) => void;
  }> = [
    {
      name: 'launch modes',
      mutate: (input) => {
        input.launchModes.push(input.launchModes[0]!);
      },
    },
    {
      name: 'capability IDs',
      mutate: (input) => {
        input.capabilities.push({ ...input.capabilities[0]! });
      },
    },
    {
      name: 'required tool profile IDs',
      mutate: (input) => {
        input.capabilities[0]!.requiredToolProfileIds.push('repository-write');
      },
    },
    {
      name: 'best-for guidance',
      mutate: (input) => {
        input.bestFor.push(input.bestFor[0]!);
      },
    },
    {
      name: 'do-not-use-for guidance',
      mutate: (input) => {
        input.doNotUseFor.push(input.doNotUseFor[0]!);
      },
    },
    {
      name: 'required approvals',
      mutate: (input) => {
        input.requiredApprovals.push(input.requiredApprovals[0]!);
      },
    },
    {
      name: 'supported handoff types',
      mutate: (input) => {
        input.supportedHandoffTypes.push(input.supportedHandoffTypes[0]!);
      },
    },
  ];

  for (const duplicateCase of cases) {
    await t.test(duplicateCase.name, () => {
      const input = validManifest();
      duplicateCase.mutate(input);

      assert.throws(() => parseAgentManifest(input));
    });
  }
});

test('agent manifest v1 requires useful best-for and do-not-use-for guidance', async (t) => {
  await t.test('best-for guidance cannot be empty', () => {
    const input = validManifest();
    input.bestFor = [];

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('do-not-use-for guidance cannot be empty', () => {
    const input = validManifest();
    input.doNotUseFor = [];

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('guidance entries cannot be blank', () => {
    const input = validManifest();
    input.bestFor = ['   '];

    assert.throws(() => parseAgentManifest(input));
  });
});

test('agent manifest v1 rejects oversized arrays', async (t) => {
  await t.test('more than 32 capabilities', () => {
    const input = validManifest();
    input.capabilities = Array.from({ length: 33 }, (_, index) => ({
      capabilityId: `capability.${index + 1}`,
      support: 'NATIVE',
      declaredLevel: 'BASIC',
      requiredToolProfileIds: [],
      maximumRisk: 'LOW',
    }));

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('more than 16 guidance entries', () => {
    const input = validManifest();
    input.bestFor = Array.from({ length: 17 }, (_, index) => `Bounded use ${index + 1}.`);

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('more than 16 required tool profiles per capability', () => {
    const input = validManifest();
    input.capabilities[0]!.requiredToolProfileIds = Array.from(
      { length: 17 },
      (_, index) => `tool-profile-${index + 1}`,
    );

    assert.throws(() => parseAgentManifest(input));
  });
});

test('agent manifest v1 rejects oversized strings', async (t) => {
  const cases: Array<{
    name: string;
    mutate: (input: ManifestFixture) => void;
  }> = [
    {
      name: 'display names longer than 128 characters',
      mutate: (input) => {
        input.displayName = 'x'.repeat(129);
      },
    },
    {
      name: 'summaries longer than 1024 characters',
      mutate: (input) => {
        input.summary = 'x'.repeat(1_025);
      },
    },
    {
      name: 'versions longer than 64 characters',
      mutate: (input) => {
        input.version = 'v'.repeat(65);
      },
    },
    {
      name: 'guidance entries longer than 512 characters',
      mutate: (input) => {
        input.bestFor = ['x'.repeat(513)];
      },
    },
  ];

  for (const oversizedCase of cases) {
    await t.test(oversizedCase.name, () => {
      const input = validManifest();
      oversizedCase.mutate(input);

      assert.throws(() => parseAgentManifest(input));
    });
  }
});

test('availability probe timeout is capped at ten seconds', () => {
  const input = validManifest();
  input.availabilityProbe.timeoutMs = 10_001;

  assert.throws(() => parseAgentManifest(input));
});

test('agent manifest v1 rejects unknown versions and enum values', async (t) => {
  const cases: Array<{
    name: string;
    mutate: (input: ManifestFixture) => void;
  }> = [
    {
      name: 'schema version',
      mutate: (input) => {
        input.schemaVersion = 2;
      },
    },
    {
      name: 'runtime location',
      mutate: (input) => {
        input.runtimeLocation = 'LINUX_HOST';
      },
    },
    {
      name: 'availability probe kind',
      mutate: (input) => {
        input.availabilityProbe.kind = 'SHELL';
      },
    },
    {
      name: 'launch mode',
      mutate: (input) => {
        input.launchModes = ['SHELL'];
      },
    },
    {
      name: 'capability support',
      mutate: (input) => {
        input.capabilities[0]!.support = 'PARTIAL';
      },
    },
    {
      name: 'declared capability level',
      mutate: (input) => {
        input.capabilities[0]!.declaredLevel = 'MASTER';
      },
    },
    {
      name: 'maximum capability risk',
      mutate: (input) => {
        input.capabilities[0]!.maximumRisk = 'CRITICAL';
      },
    },
    {
      name: 'lifecycle state',
      mutate: (input) => {
        input.lifecycleState = 'READY';
      },
    },
  ];

  for (const enumCase of cases) {
    await t.test(enumCase.name, () => {
      const input = validManifest();
      enumCase.mutate(input);

      assert.throws(() => parseAgentManifest(input));
    });
  }
});

test('agent manifest v1 rejects malformed stable identifiers', async (t) => {
  const cases: Array<{
    name: string;
    mutate: (input: ManifestFixture) => void;
  }> = [
    {
      name: 'manifest ID',
      mutate: (input) => {
        input.id = 'Codex Windows';
      },
    },
    {
      name: 'adapter ID',
      mutate: (input) => {
        input.adapterId = '../codex-adapter';
      },
    },
    {
      name: 'capability ID',
      mutate: (input) => {
        input.capabilities[0]!.capabilityId = 'code implementation';
      },
    },
    {
      name: 'tool profile ID',
      mutate: (input) => {
        input.capabilities[0]!.requiredToolProfileIds = ['repository/write'];
      },
    },
  ];

  for (const idCase of cases) {
    await t.test(idCase.name, () => {
      const input = validManifest();
      idCase.mutate(input);

      assert.throws(() => parseAgentManifest(input));
    });
  }
});

test('unsupported capabilities cannot advertise active execution metadata', async (t) => {
  await t.test('required tool profiles', () => {
    const input = validManifest();
    input.capabilities[1]!.requiredToolProfileIds = ['image-tools'];

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('strong or expert declared levels', () => {
    const input = validManifest();
    input.capabilities[1]!.declaredLevel = 'STRONG';

    assert.throws(() => parseAgentManifest(input));
  });

  await t.test('medium or high maximum risk', () => {
    const input = validManifest();
    input.capabilities[1]!.maximumRisk = 'HIGH';

    assert.throws(() => parseAgentManifest(input));
  });
});
