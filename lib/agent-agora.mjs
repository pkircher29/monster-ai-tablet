import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chatOnce, chatTargets } from './chat.mjs';

const HOME = homedir();
const AGORA_DIR = join(HOME, '.ai-spy', 'agora');

function ensureDir(p) {
  if (!existsSync(p)) {
    try { mkdirSync(p, { recursive: true }); } catch {}
  }
}

function getRoomsFile() {
  ensureDir(AGORA_DIR);
  return join(AGORA_DIR, 'rooms.json');
}

export function loadRooms() {
  const f = getRoomsFile();
  if (!existsSync(f)) {
    const defaults = [
      {
        id: 'general-agora',
        title: 'Central Agora — Agent Round Table',
        topic: 'Cross-agent skill sharing, autonomous workflow orchestration, and system reliability.',
        mode: 'round-robin',
        participants: ['claude-code', 'hermes', 'codex', 'ollama'],
        createdAt: new Date().toISOString(),
        messages: [
          {
            id: 'm1',
            sender: 'system',
            text: 'Welcome to the Agent Agora. Agents converse, critique each other, share skills, and solve problems together.',
            timestamp: new Date().toISOString()
          }
        ]
      }
    ];
    try { writeFileSync(f, JSON.stringify(defaults, null, 2), 'utf8'); } catch {}
    return defaults;
  }
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return []; }
}

export function saveRooms(rooms) {
  const f = getRoomsFile();
  writeFileSync(f, JSON.stringify(rooms, null, 2), 'utf8');
}

export function getRoom(roomId) {
  const rooms = loadRooms();
  return rooms.find(r => r.id === roomId) || null;
}

export function createRoom({ title, topic, mode = 'round-robin', participants = [] }) {
  const rooms = loadRooms();
  const id = 'room-' + Date.now().toString(36);
  const newRoom = {
    id,
    title: title || 'Agent Round Table',
    topic: topic || 'General Discussion',
    mode,
    participants: participants.length ? participants : ['claude-code', 'hermes'],
    createdAt: new Date().toISOString(),
    messages: [
      {
        id: 'm-' + Date.now(),
        sender: 'system',
        text: `Round Table opened on topic: "${topic}". Participants: ${participants.join(', ')}`,
        timestamp: new Date().toISOString()
      }
    ]
  };
  rooms.unshift(newRoom);
  saveRooms(rooms);
  return newRoom;
}

export function postMessage(roomId, { sender, text, role = 'agent' }) {
  const rooms = loadRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) return { ok: false, error: 'Room not found' };

  const msg = {
    id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    sender,
    text,
    role,
    timestamp: new Date().toISOString()
  };

  room.messages.push(msg);
  saveRooms(rooms);
  return { ok: true, message: msg };
}

// Generate the next agent turn in the agora
export async function stepNextAgent(roomId, requestedAgent = null) {
  const rooms = loadRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) return { ok: false, error: 'Room not found' };

  let nextAgent = requestedAgent;
  if (!nextAgent) {
    // Pick next in participant round-robin sequence
    const agentMsgs = room.messages.filter(m => m.role === 'agent' && m.sender !== 'system');
    const lastSender = agentMsgs.length ? agentMsgs[agentMsgs.length - 1].sender : null;
    const idx = room.participants.indexOf(lastSender);
    nextAgent = room.participants[(idx + 1) % room.participants.length] || room.participants[0];
  }

  // Format context history for the agent
  const recentHistory = room.messages.slice(-6).map(m => `[${m.sender}]: ${m.text}`).join('\n\n');
  const prompt = `You are participating in the Agent Agora — a round table discussion with other AI agents.
Topic: "${room.topic}"

Recent Conversation History:
${recentHistory}

Please respond as ${nextAgent}. Provide your technical perspective, critique or build upon the previous agent's points concisely (1-3 paragraphs), and suggest concrete next steps:`;

  const chatResult = await chatOnce({ agentId: nextAgent, prompt });
  const replyText = chatResult.reply || `[${nextAgent} contributed thoughts on ${room.topic}]`;

  const msg = {
    id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    sender: nextAgent,
    text: replyText,
    role: 'agent',
    model: chatResult.model || nextAgent,
    timestamp: new Date().toISOString()
  };

  room.messages.push(msg);
  saveRooms(rooms);
  return { ok: true, message: msg, agent: nextAgent };
}
