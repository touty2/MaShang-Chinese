/**
 * sessionStore.ts
 *
 * Persists the active flashcard review session to IndexedDB so that
 * refreshes, browser restarts, and re-logins all resume exactly where
 * the user left off.
 *
 * Key design decisions
 * ────────────────────
 * • One session record per calendar day (local date string "YYYY-MM-DD").
 * • The session is identified by a stable `sessionKey` that encodes the
 *   date + the sorted set of selected deck IDs.  If the user changes deck
 *   selection, a fresh session starts automatically.
 * • The queue is stored as an ordered array of card keys
 *   `{ word, cardType }`.  The actual FlashCard data is NOT duplicated here;
 *   it is always read fresh from flashcardStore so FSRS updates are reflected.
 * • `reviewedKeys` is a Set of serialised keys for cards already rated in
 *   this session.  On restore the queue is rebuilt as
 *   (originalQueue minus reviewedKeys), preserving original order.
 * • A completed session (`isDone = true`) stays done until the next calendar
 *   day, at which point `loadSession` returns null (no session to restore).
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

// ─── IndexedDB plumbing ───────────────────────────────────────────────────────

const DB_NAME = "mashang_session";
const DB_VERSION = 1;
const STORE = "sessions";

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = (e.target as IDBOpenDBRequest).result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "sessionKey" });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function getDB(): Promise<IDBDatabase> {
  if (!_db) _db = await openDB();
  return _db;
}

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
export async function loadSession(deckIds: string[], userId?: string): Promise<PersistedSession | null> {
  try {
    const db = await getDB();
    const key = makeSessionKey(deckIds, userId);
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as (PersistedSession & { sessionKey: string }) | undefined;
        if (!rec) { resolve(null); return; }
        // Expire if the date has rolled over
        if (rec.date !== todayStr()) { resolve(null); return; }
        resolve(rec);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Save (upsert) the current session state.
 */
export async function saveSession(deckIds: string[], session: PersistedSession, userId?: string): Promise<void> {
  try {
    const db = await getDB();
    const key = makeSessionKey(deckIds, userId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const rec = { ...session, sessionKey: key, updatedAt: Date.now() };
      const req = tx.objectStore(STORE).put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[sessionStore] saveSession failed:", err);
  }
}

/**
 * Delete the session for the given deck selection (e.g. on manual reset).
 */
export async function clearSession(deckIds: string[], userId?: string): Promise<void> {
  try {
    const db = await getDB();
    const key = makeSessionKey(deckIds, userId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[sessionStore] clearSession failed:", err);
  }
}

/**
 * Purge all sessions from previous days (housekeeping, called on app start).
 */
export async function pruneOldSessions(): Promise<void> {
  try {
    const db = await getDB();
    const today = todayStr();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null;
        if (!cursor) { resolve(); return; }
        const rec = cursor.value as PersistedSession;
        if (rec.date !== today) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Non-critical — ignore
  }
}
