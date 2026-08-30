import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 8 * 60 * 60_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_ATTEMPTS = 5;
const SESSION_COOKIE = 'monster_hub_session';

export interface HubAuthSession {
  readonly id: string;
  readonly expiresAt: number;
}

export interface HubLoginResult {
  readonly kind: 'AUTHENTICATED' | 'INVALID' | 'RATE_LIMITED';
  readonly session?: HubAuthSession;
}

export interface HubAuth {
  login(password: string, clientKey: string): HubLoginResult;
  authenticate(cookieHeader: string | undefined): HubAuthSession | null;
  logout(cookieHeader: string | undefined): void;
  sessionCookie(session: HubAuthSession, secure: boolean): string;
  clearCookie(secure: boolean): string;
}

export interface HubAuthOptions {
  readonly password: string;
  readonly clock?: () => number;
  readonly random?: (size: number) => Buffer;
}

interface AttemptWindow {
  count: number;
  startedAt: number;
}

function cookieValue(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined || cookieHeader.length > 4_096) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, value] = part.trim().split('=', 2);
    if (name === SESSION_COOKIE && value !== undefined && /^[a-f0-9]{64}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function assertPassword(password: string): void {
  if (
    password.length < 14 ||
    password.length > 256 ||
    [...password].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new TypeError('Monster Hub admin password must be 14 to 256 safe characters');
  }
}

export function createHubAuth(options: HubAuthOptions): HubAuth {
  assertPassword(options.password);
  const clock = options.clock ?? Date.now;
  const random = options.random ?? randomBytes;
  const salt = random(16);
  const expected = scryptSync(options.password, salt, 32);
  const sessions = new Map<string, HubAuthSession>();
  const attempts = new Map<string, AttemptWindow>();

  const prune = (now: number): void => {
    for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
    for (const [client, window] of attempts) {
      if (window.startedAt + LOGIN_WINDOW_MS <= now) attempts.delete(client);
    }
  };

  return {
    login(password, clientKey) {
      const now = clock();
      prune(now);
      const current = attempts.get(clientKey);
      if (current !== undefined && current.count >= MAX_LOGIN_ATTEMPTS) {
        return { kind: 'RATE_LIMITED' };
      }
      const candidate = scryptSync(password.slice(0, 256), salt, 32);
      if (!timingSafeEqual(expected, candidate)) {
        if (current === undefined) attempts.set(clientKey, { count: 1, startedAt: now });
        else current.count += 1;
        return { kind: 'INVALID' };
      }
      attempts.delete(clientKey);
      const id = random(32).toString('hex');
      const session = Object.freeze({ id, expiresAt: now + SESSION_TTL_MS });
      sessions.set(id, session);
      return { kind: 'AUTHENTICATED', session };
    },
    authenticate(cookieHeader) {
      const now = clock();
      prune(now);
      const id = cookieValue(cookieHeader);
      return id === null ? null : (sessions.get(id) ?? null);
    },
    logout(cookieHeader) {
      const id = cookieValue(cookieHeader);
      if (id !== null) sessions.delete(id);
    },
    sessionCookie(session, secure) {
      return `${SESSION_COOKIE}=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}${secure ? '; Secure' : ''}`;
    },
    clearCookie(secure) {
      return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
    },
  };
}
