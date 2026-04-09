// Full CEDICT (121k entries) — general lookup dictionary
const CEDICT_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663317949134/gyZHNejwRaX99q6q2mE9js/cedict_clean_e7d83707.json";
// Story-specific vocab + polyphonic corrections — v3
const CORRECTIONS_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663317949134/gyZHNejwRaX99q6q2mE9js/cedict_cleaned_a39d7bf4.json";
const DB_NAME = "mashang_dict";
const DB_VERSION = 3; // bumped: added polyphonic corrections overlay
const STORE_NAME = "cedict";
const META_STORE = "meta";

export interface DictEntry {
  pinyin: string;
  pinyinDisplay: string;
  definitions: string[];
}

let db: IDBDatabase | null = null;
let loadingPromise: Promise<void> | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = (e.target as IDBOpenDBRequest).result;
      // On upgrade, drop and recreate both stores to load fresh data
      if (d.objectStoreNames.contains(STORE_NAME)) {
        d.deleteObjectStore(STORE_NAME);
      }
      if (d.objectStoreNames.contains(META_STORE)) {
        d.deleteObjectStore(META_STORE);
      }
      d.createObjectStore(STORE_NAME);
      d.createObjectStore(META_STORE);
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

function idbGet(store: IDBDatabase, storeName: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = store.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Convert tone-marked pinyin (e.g. "jǐnzhāng") to numeric pinyin key
 * used internally in the CEDICT store (e.g. "jin3 zhang1").
 * We store pinyinDisplay as the tone-marked form for display.
 */
function toNumericPinyin(display: string): string {
  // Simple passthrough — the store uses pinyinDisplay for lookups anyway
  return display;
}

export async function loadDictionary(onProgress?: (pct: number) => void): Promise<void> {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    db = await openDB();
    // Check if already loaded
    const loaded = await idbGet(db, META_STORE, "loaded");
    if (loaded === true) {
      onProgress?.(100);
      return;
    }
    // Fetch full CEDICT
    onProgress?.(5);
    const [cedictResp, correctionsResp] = await Promise.all([
      fetch(CEDICT_URL),
      fetch(CORRECTIONS_URL),
    ]);
    onProgress?.(40);
    const cedict = await cedictResp.json() as Record<string, DictEntry>;
    const corrections = await correctionsResp.json() as {
      version: string;
      polyphonic_corrections: Record<string, string>;
      entries: Array<{ word: string; pinyin: string; definition: string; readings: string[] }>;
    };
    onProgress?.(70);

    // Apply polyphonic corrections: for each character in the corrections map,
    // update the pinyinDisplay in the CEDICT entry to use the corrected primary reading.
    const poly = corrections.polyphonic_corrections ?? {};
    for (const [char, correctPinyin] of Object.entries(poly)) {
      if (cedict[char]) {
        cedict[char] = {
          ...cedict[char],
          pinyinDisplay: correctPinyin,
          pinyin: correctPinyin,
        };
      } else {
        // Add entry if not present
        cedict[char] = {
          pinyin: correctPinyin,
          pinyinDisplay: correctPinyin,
          definitions: [],
        };
      }
    }

    // Apply story vocab entries: add/override with story-specific definitions
    for (const entry of (corrections.entries ?? [])) {
      cedict[entry.word] = {
        pinyin: entry.pinyin,
        pinyinDisplay: entry.pinyin,
        definitions: [entry.definition],
      };
    }

    // Store all entries in one transaction
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([STORE_NAME, META_STORE], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const metaStore = tx.objectStore(META_STORE);
      for (const [key, val] of Object.entries(cedict)) {
        store.put(val, key);
      }
      metaStore.put(true, "loaded");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    onProgress?.(100);
  })();
  return loadingPromise;
}

/**
 * Filter definitions to remove remaining junk and cap at maxDefs.
 */
function filterDefs(defs: string[], maxDefs = 4): string[] {
  const JUNK = /^(CL:|pr\.|abbr\.|variant of|old variant|see |also written|used in |surname |one of the \d+)/i;
  return defs
    .filter((d) => d.length > 1 && !JUNK.test(d))
    .slice(0, maxDefs);
}

export async function lookupWord(word: string): Promise<DictEntry | null> {
  if (!db) return null;

  // Direct lookup
  const entry = await idbGet(db, STORE_NAME, word) as DictEntry | undefined;
  if (entry) {
    return {
      ...entry,
      definitions: filterDefs(entry.definitions),
    };
  }

  // Fallback for multi-char words not in dict: try character-by-character
  // Only do this for 2-char words; longer fallbacks are usually noise
  if (word.length === 2) {
    const chars = word.split("");
    const entries: DictEntry[] = [];
    for (const ch of chars) {
      const e = await idbGet(db, STORE_NAME, ch) as DictEntry | undefined;
      if (e) entries.push(e);
    }
    if (entries.length === 2) {
      return {
        pinyin: entries.map((e) => e.pinyin).join(" "),
        pinyinDisplay: entries.map((e) => e.pinyinDisplay).join(" "),
        // For char-by-char fallback, show 1 def per char max
        definitions: entries.flatMap((e) => filterDefs(e.definitions, 1)),
      };
    }
  }

  // For single chars with no entry, return null
  return null;
}

export function isDictionaryLoaded(): boolean {
  return db !== null;
}
