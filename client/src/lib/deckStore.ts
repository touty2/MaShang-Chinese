/**
 * Local deck management using IndexedDB.
 * Deck SRS progress is shared per word — decks only filter which cards appear in review.
 * Syncs to cloud via sync.pushDecks / sync.pullDecks.
 */

const DB_NAME = "mashang_decks";
const DB_VERSION = 1;
const DECKS_STORE = "decks";
const MEMBERS_STORE = "deck_members";

export interface LocalDeck {
  id: string;          // nanoid
  name: string;
  createdAt: number;
  updatedAt: number;
  isSystem: boolean;   // true for Main Deck / My Vocab
}

export interface DeckMember {
  deckId: string;
  word: string;
  addedAt: number;
}

// Built-in deck IDs
export const MAIN_DECK_ID = "__main__";
export const MY_VOCAB_ID = "__myvocab__";

export const SYSTEM_DECKS: LocalDeck[] = [
  { id: MAIN_DECK_ID, name: "Main Deck", createdAt: 0, updatedAt: 0, isSystem: true },
  { id: MY_VOCAB_ID,  name: "My Vocab",  createdAt: 0, updatedAt: 0, isSystem: true },
];

let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = (e.target as IDBOpenDBRequest).result;
      if (!d.objectStoreNames.contains(DECKS_STORE)) {
        d.createObjectStore(DECKS_STORE, { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains(MEMBERS_STORE)) {
        const ms = d.createObjectStore(MEMBERS_STORE, { keyPath: ["deckId", "word"] });
        ms.createIndex("byDeck", "deckId");
        ms.createIndex("byWord", "word");
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function getDB(): Promise<IDBDatabase> {
  if (!db) db = await openDB();
  return db;
}

function idbGet<T>(d: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(d: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(d: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(d: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function idbGetByIndex<T>(d: IDBDatabase, store: string, index: string, key: IDBValidKey): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readonly");
    const req = tx.objectStore(store).index(index).getAll(key);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// ─── Deck CRUD ────────────────────────────────────────────────────────────────

export async function getAllDecks(): Promise<LocalDeck[]> {
  const d = await getDB();
  const custom = await idbGetAll<LocalDeck>(d, DECKS_STORE);
  return [...SYSTEM_DECKS, ...custom];
}

export async function createDeck(name: string): Promise<LocalDeck> {
  const d = await getDB();
  const deck: LocalDeck = {
    id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isSystem: false,
  };
  await idbPut(d, DECKS_STORE, deck);
  return deck;
}

export async function renameDeck(id: string, name: string): Promise<void> {
  const d = await getDB();
  const existing = await idbGet<LocalDeck>(d, DECKS_STORE, id);
  if (!existing || existing.isSystem) return;
  await idbPut(d, DECKS_STORE, { ...existing, name: name.trim(), updatedAt: Date.now() });
}

export async function deleteDeck(id: string): Promise<void> {
  const d = await getDB();
  const existing = await idbGet<LocalDeck>(d, DECKS_STORE, id);
  if (!existing || existing.isSystem) return;
  // Remove all members first
  const members = await idbGetByIndex<DeckMember>(d, MEMBERS_STORE, "byDeck", id);
  for (const m of members) {
    await idbDelete(d, MEMBERS_STORE, [m.deckId, m.word]);
  }
  await idbDelete(d, DECKS_STORE, id);
}

// ─── Deck membership ─────────────────────────────────────────────────────────

export async function addWordToDeck(deckId: string, word: string): Promise<void> {
  const d = await getDB();
  const member: DeckMember = { deckId, word, addedAt: Date.now() };
  await idbPut(d, MEMBERS_STORE, member);
}

export async function removeWordFromDeck(deckId: string, word: string): Promise<void> {
  const d = await getDB();
  await idbDelete(d, MEMBERS_STORE, [deckId, word]);
}

export async function getWordsInDeck(deckId: string): Promise<string[]> {
  const d = await getDB();
  const members = await idbGetByIndex<DeckMember>(d, MEMBERS_STORE, "byDeck", deckId);
  return members.map((m) => m.word);
}

export async function getDecksForWord(word: string): Promise<string[]> {
  const d = await getDB();
  const members = await idbGetByIndex<DeckMember>(d, MEMBERS_STORE, "byWord", word);
  return members.map((m) => m.deckId);
}

export async function isWordInDeck(deckId: string, word: string): Promise<boolean> {
  const d = await getDB();
  const m = await idbGet<DeckMember>(d, MEMBERS_STORE, [deckId, word]);
  return !!m;
}

/** Get all members across all decks */
export async function getAllDeckMembers(): Promise<DeckMember[]> {
  const d = await getDB();
  return idbGetAll<DeckMember>(d, MEMBERS_STORE);
}

/** Get count of words in each deck */
export async function getDeckCounts(): Promise<Record<string, number>> {
  const d = await getDB();
  const members = await idbGetAll<DeckMember>(d, MEMBERS_STORE);
  const counts: Record<string, number> = {};
  for (const m of members) {
    counts[m.deckId] = (counts[m.deckId] ?? 0) + 1;
  }
  return counts;
}

/** Clear all deck data (used in reset) */
export async function clearAllDecks(): Promise<void> {
  const d = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction([DECKS_STORE, MEMBERS_STORE], "readwrite");
    tx.objectStore(DECKS_STORE).clear();
    tx.objectStore(MEMBERS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
