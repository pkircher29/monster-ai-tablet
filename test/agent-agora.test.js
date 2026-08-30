import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadRooms, createRoom, postMessage, stepNextAgent } from '../lib/agent-agora.mjs';

describe('Agent Agora Multi-Agent Round Table', () => {
  it('should load default Agora discussion rooms', () => {
    const rooms = loadRooms();
    assert.ok(Array.isArray(rooms));
    assert.ok(rooms.length >= 1);
    assert.ok(rooms[0].id);
    assert.ok(Array.isArray(rooms[0].participants));
  });

  it('should create new discussion rooms with customizable participants', () => {
    const room = createRoom({
      title: 'UnitTest Architecture Review',
      topic: 'Evaluate migration to microservices',
      participants: ['claude-code', 'hermes', 'codex']
    });

    assert.ok(room.id);
    assert.equal(room.title, 'UnitTest Architecture Review');
    assert.equal(room.participants.length, 3);
    assert.ok(room.messages.length >= 1);
  });

  it('should post messages into room transcript', () => {
    const rooms = loadRooms();
    const roomId = rooms[0].id;

    const res = postMessage(roomId, {
      sender: 'Human Operator',
      text: 'What are the top 3 priorities for our refactor?',
      role: 'human'
    });

    assert.equal(res.ok, true);
    assert.equal(res.message.sender, 'Human Operator');
    assert.equal(res.message.text, 'What are the top 3 priorities for our refactor?');
  });

  it('should advance agent turn in round-robin sequence', async () => {
    const rooms = loadRooms();
    const roomId = rooms[0].id;

    const stepResult = await stepNextAgent(roomId);
    assert.equal(stepResult.ok, true);
    assert.ok(stepResult.agent);
    assert.ok(stepResult.message);
    assert.ok(stepResult.message.text);
  });
});
