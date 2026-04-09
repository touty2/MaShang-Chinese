import {
  createEmptyCard,
  FSRS,
  generatorParameters,
  Rating,
  State,
  type Card,
} from "ts-fsrs";

export type CardType = "zh_en" | "en_zh";

export interface FlashCard {
  word: string;
  cardType: CardType;
  pinyin: string;
  definition: string;
  hskBand: string;
  storyId?: number;
  // FSRS fields
  stability: number;
  difficulty: number;
  scheduledDays: number;
  elapsedDays: number;
  reps: number;
  lapses: number;
  isLeech: boolean;
  state: number;
  dueDate: number;       // UTC ms
  lastReviewed: number;  // UTC ms
  updatedAt: number;
}

const DB_NAME = "mashang_cards";
const DB_VERSION = 1;
const STORE = "flashcards";

let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = (e.target as IDBOpenDBRequest).result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: ["word", "cardType"] });
        store.createIndex("dueDate", "dueDate");
        store.createIndex("state", "state");
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

function txGet<T>(d: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function txPut(d: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txDelete(d: IDBDatabase, storeName: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txGetAll<T>(d: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// ─── FSRS helpers ─────────────────────────────────────────────────────────────

function cardToFSRS(card: FlashCard): Card {
  return {
    due: new Date(card.dueDate || Date.now()),
    stability: card.stability || 0,
    difficulty: card.difficulty || 0,
    elapsed_days: card.elapsedDays || 0,
    scheduled_days: card.scheduledDays || 0,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    state: (card.state || 0) as State,
    last_review: card.lastReviewed ? new Date(card.lastReviewed) : undefined,
    learning_steps: 0,
  };
}

function fsrsToCard(fsrsCard: Card, existing: FlashCard): FlashCard {
  return {
    ...existing,
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    scheduledDays: fsrsCard.scheduled_days,
    elapsedDays: fsrsCard.elapsed_days,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    state: fsrsCard.state as number,
    dueDate: fsrsCard.due.getTime(),
    lastReviewed: fsrsCard.last_review?.getTime() ?? Date.now(),
    updatedAt: Date.now(),
  };
}

export function getIntervalLabel(card: FlashCard, rating: Rating, retention = 90): string {
  // retention is stored as 0-100 (e.g. 90 = 90%); FSRS expects a value in (0, 1]
  const clampedRetention = Math.min(Math.max(retention / 100, 0.01), 1.0);
  const params = generatorParameters({ request_retention: clampedRetention });
  const f = new FSRS(params);
  const fsrsCard = cardToFSRS(card);
  const now = new Date();
  const result = f.repeat(fsrsCard, now);
  const scheduled = (result as unknown as Record<number, { card: Card }>)[rating as number]?.card;
  if (!scheduled) return "?";
  const days = scheduled.scheduled_days;
  if (days === 0) return "<1d";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function addWord(
  word: string,
  pinyin: string,
  definition: string,
  hskBand: string,
  storyId?: number
): Promise<void> {
  const d = await getDB();
  const now = Date.now();
  const emptyCard = createEmptyCard();

  for (const cardType of ["zh_en", "en_zh"] as CardType[]) {
    const existing = await txGet<FlashCard>(d, STORE, [word, cardType]);
    if (!existing) {
      const card: FlashCard = {
        word,
        cardType,
        pinyin,
        definition,
        hskBand,
        storyId,
        stability: emptyCard.stability,
        difficulty: emptyCard.difficulty,
        scheduledDays: emptyCard.scheduled_days,
        elapsedDays: emptyCard.elapsed_days,
        reps: emptyCard.reps,
        lapses: emptyCard.lapses,
        isLeech: false,
        state: emptyCard.state as number,
        dueDate: emptyCard.due.getTime(),
        lastReviewed: 0,
        updatedAt: now,
      };
      await txPut(d, STORE, card);
    }
  }
}

export async function removeWord(word: string): Promise<void> {
  const d = await getDB();
  await txDelete(d, STORE, [word, "zh_en"]);
  await txDelete(d, STORE, [word, "en_zh"]);
}

export async function hasWord(word: string): Promise<boolean> {
  const d = await getDB();
  const card = await txGet<FlashCard>(d, STORE, [word, "zh_en"]);
  return !!card;
}

export async function getAllCards(): Promise<FlashCard[]> {
  const d = await getDB();
  return txGetAll<FlashCard>(d, STORE);
}

export async function getDueCards(
  direction: "zh_en" | "en_zh" | "mixed",
  cap?: number
): Promise<FlashCard[]> {
  const all = await getAllCards();
  const now = Date.now();
  let due = all.filter((c) => {
    if (direction !== "mixed" && c.cardType !== direction) return false;
    return c.dueDate <= now;
  });
  // Sort: new cards first, then by due date
  due.sort((a, b) => {
    if (a.state === 0 && b.state !== 0) return -1;
    if (b.state === 0 && a.state !== 0) return 1;
    return a.dueDate - b.dueDate;
  });
  if (cap && cap > 0) due = due.slice(0, cap);
  return due;
}

export async function rateCard(
  card: FlashCard,
  rating: Rating,
  retention = 90,
  maxInterval = 365
): Promise<FlashCard> {
  // retention is stored as 0-100 (e.g. 90 = 90%); FSRS expects a value in (0, 1]
  const clampedRetention = Math.min(Math.max(retention / 100, 0.01), 1.0);
  const params = generatorParameters({
    request_retention: clampedRetention,
    maximum_interval: maxInterval,
  });
  const f = new FSRS(params);
  const fsrsCard = cardToFSRS(card);
  const now = new Date();
  const result = f.repeat(fsrsCard, now);
  const newFsrsCard = (result as unknown as Record<number, { card: Card }>)[rating as number]!.card;
  const LEECH_THRESHOLD = 8;
  const updated: FlashCard = {
    ...fsrsToCard(newFsrsCard, card),
    isLeech: newFsrsCard.lapses >= LEECH_THRESHOLD,
  };
  const d = await getDB();
  await txPut(d, STORE, updated);
  return updated;
}

export async function updateCard(card: FlashCard): Promise<void> {
  const d = await getDB();
  await txPut(d, STORE, card);
}

export async function clearAllCards(): Promise<void> {
  const d = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function resetDueDates(): Promise<void> {
  const all = await getAllCards();
  const d = await getDB();
  const now = Date.now();
  for (const card of all) {
    const reset: FlashCard = {
      ...card,
      dueDate: now,
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      elapsedDays: 0,
      reps: 0,
      lapses: 0,
      isLeech: false,
      state: 0,
      lastReviewed: 0,
      updatedAt: now,
    };
    await txPut(d, STORE, reset);
  }
}

export { Rating, State };
