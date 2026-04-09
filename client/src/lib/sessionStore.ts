/**
 * sessionStore.ts — localStorage-based session persistence
 *
 * Why localStorage instead of IndexedDB?
 * On every login, AuthContext calls clearAllCards() (IndexedDB) before
 * hydrateFromServer() completes.  If the session was stored in IndexedDB it
 * would be wiped on every login, losing the mid-session queue.
 *
 * localStorage is NOT cleared by clearAllCards() or clearAllDecks(), so
 * sessions survive the login/hydration cycle.  Sessions are keyed by
 * userId + date so they are user-scoped and auto-expire after one day.
 *
 * Keys use the prefix "mashang_sess_" to avoid collisions with other
 * localStorage entries.
 */

import type { CardType } from "./flashcardStore";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CardKey {
  word: string;
  cardType: CardType;
}

export interface PersistedSession {
  /** "YYYY-MM-DD" local date */
  date: string;
  /** sorted deck IDs joined with "," */
  deckKey: string;
  /** full ordered queue as it was when the session started */
  originalQueue: CardKey[];
  /** serialised keys of cards already rated ("word|cardType") */
  reviewedKeys: string[];
  /** number of cards rated so far */
  reviewed: number;
  /** true when the session has been completed */
  isDone: boolean;
  /** unix ms of last write */
  updatedAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const KEY_PREFIX = "mashang_sess_";

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Local date string "YYYY-MM-DD" */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Stable session key: date + user + sorted deck IDs */
export function makeSessionKey(deckIds: string[], userId?: string): string {
  const userPart = userId ? `${userId}::` : "";
  return `${todayStr()}::${userPart}${[...deckIds].sort().join(",")}`;
}

export function serializeKey(k: CardKey): string {
  return `${k.word}|${k.cardType}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load today's session for the given deck selection.
 * Returns null if no session exists for today or if the date has rolled over.
 */
export async function loadSession(
  deckIds: string[],
  userId?: string
): Promise<PersistedSession | null> {
  try {
    const key = KEY_PREFIX + makeSessionKey(deckIds, userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw) as PersistedSession;
    // Expire if the date has rolled over
    if (rec.date !== todayStr()) {
      localStorage.removeItem(key);
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

/**
 * Save (upsert) the current session state.
 */
export async function saveSession(
  deckIds: string[],
  session: PersistedSession,
  userId?: string
): Promise<void> {
  try {
    const key = KEY_PREFIX + makeSessionKey(deckIds, userId);
    const rec: PersistedSession = { ...session, updatedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(rec));
  } catch (err) {
    console.warn("[sessionStore] saveSession failed:", err);
  }
}

/**
 * Delete the session for the given deck selection (e.g. on manual reset).
 */
export async function clearSession(
  deckIds: string[],
  userId?: string
): Promise<void> {
  try {
    const key = KEY_PREFIX + makeSessionKey(deckIds, userId);
    localStorage.removeItem(key);
  } catch (err) {
    console.warn("[sessionStore] clearSession failed:", err);
  }
}

/**
 * Clear all sessions for a specific user (call on logout so the next user
 * doesn't see a previous user's session).
 */
export async function clearUserSessions(userId: string): Promise<void> {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX) && k.includes(userId)) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch (err) {
    console.warn("[sessionStore] clearUserSessions failed:", err);
  }
}

/**
 * Purge all sessions from previous days (housekeeping, called on app start).
 */
export async function pruneOldSessions(): Promise<void> {
  try {
    const today = todayStr();
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEY_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const rec = JSON.parse(raw) as PersistedSession;
        if (rec.date !== today) toRemove.push(k);
      } catch {
        toRemove.push(k!);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    // Non-critical — ignore
  }
}
