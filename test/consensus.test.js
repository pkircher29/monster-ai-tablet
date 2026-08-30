import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConsensus, generateSuggestedFollowups } from '../lib/consensus.mjs';

describe('Radio Multi-Turn Consensus & Follow-ups', () => {
  it('should generate smart contextual suggested follow-up questions', () => {
    const suggestions = generateSuggestedFollowups('Which model is best for refactoring large codebases?', []);
    assert.ok(Array.isArray(suggestions));
    assert.ok(suggestions.length >= 3);
    assert.ok(typeof suggestions[0] === 'string');
  });

  it('should execute a broadcast question across fleet engines', async () => {
    const res = await runConsensus('Evaluate migrating from CommonJS to ES Modules', {
      engines: ['claude', 'hermes', 'codex']
    });

    assert.equal(res.ok, true);
    assert.ok(res.run);
    assert.ok(res.run.id);
    assert.equal(res.run.turns.length, 1);
    assert.ok(res.run.turns[0].answers.length >= 3);
    assert.ok(res.run.turns[0].suggestedFollowups.length >= 3);
  });

  it('should append multi-turn follow-up questions to the same consensus thread', async () => {
    // 1. Initial question
    const res1 = await runConsensus('Should we use Redis or SQLite for session storage?', {
      engines: ['hermes', 'codex']
    });
    const runId = res1.run.id;

    // 2. Follow-up question
    const res2 = await runConsensus('What are the memory and concurrency benchmarks for both?', {
      engines: ['hermes', 'codex'],
      parentRunId: runId,
      priorContext: res1.run.originalQuestion
    });

    assert.equal(res2.ok, true);
    assert.equal(res2.run.id, runId);
    assert.equal(res2.run.turns.length, 2);
    assert.equal(res2.run.turns[1].turnIndex, 2);
    assert.equal(res2.run.turns[1].question, 'What are the memory and concurrency benchmarks for both?');
  });
});
