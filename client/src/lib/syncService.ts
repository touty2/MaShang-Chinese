import { trpc } from "@/lib/trpc";
import { getAllCards, updateCard, type FlashCard } from "./flashcardStore";
import { addWordToDeck, MAIN_DECK_ID, MY_VOCAB_ID } from "./deckStore";

export type SyncStatus = "idle" | "syncing" | "error" | "success";

let lastSyncTime = 0;
const SYNC_INTERVAL = 3 * 60 * 1000; // 3 minutes

export function getLastSyncTime() { return lastSyncTime; }
export function shouldSync(): boolean { return Date.now() - lastSyncTime > SYNC_INTERVAL; }

// ─── Merge helpers ────────────────────────────────────────────────────────────

function mergeCards(local: FlashCard[], server: FlashCard[]): FlashCard[] {
  const map = new Map<string, FlashCard>();
  for (const c of local) map.set(`${c.word}:${c.cardType}`, c);
  for (const c of server) {
    const key = `${c.word}:${c.cardType}`;
    const existing = map.get(key);
    if (!existing || c.updatedAt > existing.updatedAt) map.set(key, c);
  }
  return Array.from(map.values());
}

/** Read completed story IDs from localStorage */
function getLocalCompleted(): number[] {
  try { return JSON.parse(localStorage.getItem("mashang_completed") || "[]"); }
  catch { return []; }
}

/** Read vocab ignored words from localStorage */
function getLocalVocabIgnored(): string[] {
  try { return JSON.parse(localStorage.getItem("mashang_vocab_ignored") || "[]"); }
  catch { return []; }
}

/** Read segmentation overrides map from localStorage: { [storyId]: { [token]: newToken } } */
function getLocalSegOverrides(): Record<number, Record<string, string>> {
  try { return JSON.parse(localStorage.getItem("mashang_seg_overrides") || "{}"); }
  catch { return {}; }
}

// ─── Full sync (background, every 3 min) ─────────────────────────────────────

/**
 * Full bidirectional sync for all data types.
 * Push local → server, then pull server → local and merge.
 * Used for periodic background sync. NOT for login (use hydrateFromServer).
 */
export async function performSync(
  utils: ReturnType<typeof trpc.useUtils>,
  onStatus?: (s: SyncStatus) => void
): Promise<void> {
  onStatus?.("syncing");
  const now = Date.now();
  try {
    // ── 1. Flashcards ─────────────────────────────────────────────────────────
    const localCards = await getAllCards();
    if (localCards.length > 0) {
      await utils.client.sync.pushFlashcards.mutate(
        localCards.map((c) => ({
          word: c.word, cardType: c.cardType,
          stability: c.stability, difficulty: c.difficulty,
          scheduledDays: c.scheduledDays, elapsedDays: c.elapsedDays,
          reps: c.reps, lapses: c.lapses, isLeech: c.isLeech,
          state: c.state, dueDate: c.dueDate, lastReviewed: c.lastReviewed,
          pinyin: c.pinyin, definition: c.definition,
          hskBand: c.hskBand, storyId: c.storyId, updatedAt: c.updatedAt,
        }))
      );
    }
    const serverCards = await utils.client.sync.pullFlashcards.query();
    const merged = mergeCards(localCards, serverCards.map(serverCardToLocal));
    for (const card of merged) await updateCard(card);

    // ── 2. Completed stories ──────────────────────────────────────────────────
    try {
      const localCompleted = getLocalCompleted();
      if (localCompleted.length > 0) {
        await utils.client.sync.pushCompletedTexts.mutate(
          localCompleted.map((storyId) => ({ storyId, completedAt: now, updatedAt: now }))
        );
      }
      const serverCompleted = await utils.client.sync.pullCompletedTexts.query();
      if (serverCompleted.length > 0) {
        // Merge: union of local and server IDs
        const merged = Array.from(new Set([...localCompleted, ...serverCompleted.map((t) => t.storyId)]));
        localStorage.setItem("mashang_completed", JSON.stringify(merged));
      }
    } catch (e) {
      console.warn("[Sync] Completed texts sync failed:", e);
    }

    // ── 3. Vocab ignored ──────────────────────────────────────────────────────
    try {
      const localIgnored = getLocalVocabIgnored();
      if (localIgnored.length > 0) {
        await utils.client.sync.pushVocabIgnored.mutate(
          localIgnored.map((word) => ({ word, updatedAt: now }))
        );
      }
      const serverIgnored = await utils.client.sync.pullVocabIgnored.query();
      if (serverIgnored.length > 0) {
        const merged = Array.from(new Set([...localIgnored, ...serverIgnored.map((v) => v.word)]));
        localStorage.setItem("mashang_vocab_ignored", JSON.stringify(merged));
      }
    } catch (e) {
      console.warn("[Sync] Vocab ignored sync failed:", e);
    }

    // ── 4. Segmentation overrides ─────────────────────────────────────────────
    try {
      const localOverrides = getLocalSegOverrides();
      const localEntries = Object.entries(localOverrides);
      if (localEntries.length > 0) {
        await utils.client.sync.pushSegmentationOverrides.mutate(
          localEntries.map(([storyId, overrides]) => ({
            storyId: Number(storyId),
            overridesJson: JSON.stringify(overrides),
            updatedAt: now,
          }))
        );
      }
      const serverOverrides = await utils.client.sync.pullSegmentationOverrides.query();
      if (serverOverrides.length > 0) {
        // Merge: server wins on conflict (server is source of truth for overrides)
        const mergedMap: Record<number, Record<string, string>> = { ...localOverrides };
        for (const row of serverOverrides) {
          try {
            mergedMap[row.storyId] = JSON.parse(row.overridesJson || "{}");
          } catch { /* skip malformed */ }
        }
        localStorage.setItem("mashang_seg_overrides", JSON.stringify(mergedMap));
      }
    } catch (e) {
      console.warn("[Sync] Segmentation overrides sync failed:", e);
    }

    // ── 5. Story deck words (Main Deck membership) ────────────────────────────
    try {
      const { getWordsInDeck } = await import("./deckStore");
      const localDeckWords = await getWordsInDeck(MAIN_DECK_ID);
      if (localDeckWords.length > 0) {
        await utils.client.sync.pushStoryDeckWords.mutate(
          localDeckWords.map((word: string) => ({ storyId: 0, word, addedAt: now, updatedAt: now }))
        );
      }
      const serverDeckWords = await utils.client.sync.pullStoryDeckWords.query();
      for (const item of serverDeckWords) {
        if (item.storyId === 0) await addWordToDeck(MAIN_DECK_ID, item.word);
      }
    } catch (e) {
      console.warn("[Sync] Deck words sync failed:", e);
    }

    // ── 6. My Words deck membership (storyId: -1 sentinel) ───────────────────
    try {
      const { getWordsInDeck } = await import("./deckStore");
      const myVocabWords = await getWordsInDeck(MY_VOCAB_ID);
      if (myVocabWords.length > 0) {
        await utils.client.sync.pushStoryDeckWords.mutate(
          myVocabWords.map((word: string) => ({ storyId: -1, word, addedAt: now, updatedAt: now }))
        );
      }
      const serverAllDeckWords = await utils.client.sync.pullStoryDeckWords.query();
      for (const item of serverAllDeckWords) {
        if (item.storyId === -1) await addWordToDeck(MY_VOCAB_ID, item.word);
      }
    } catch (e) {
      console.warn("[Sync] My Words sync failed:", e);
    }

    lastSyncTime = now;
    onStatus?.("success");
  } catch (err) {
    console.error("[Sync] Error:", err);
    onStatus?.("error");
  }
}

// ─── Login hydration (pull only) ─────────────────────────────────────────────

/**
 * Hydrate all local stores from server — used after login or account switch.
 * Local stores must already be cleared before calling this.
 * Only pulls from server; does NOT push local data (which was just cleared).
 */
export async function hydrateFromServer(
  utils: ReturnType<typeof trpc.useUtils>,
  onStatus?: (s: SyncStatus) => void
): Promise<void> {
  onStatus?.("syncing");
  try {
    // ── Flashcards ────────────────────────────────────────────────────────────
    const serverCards = await utils.client.sync.pullFlashcards.query();
    for (const card of serverCards) {
      await updateCard(serverCardToLocal(card));
    }

    // ── Completed texts → localStorage ───────────────────────────────────────
    try {
      const completedTexts = await utils.client.sync.pullCompletedTexts.query();
      if (completedTexts.length > 0) {
        const ids = completedTexts.map((t) => t.storyId);
        localStorage.setItem("mashang_completed", JSON.stringify(ids));
      }
    } catch { /* Non-fatal */ }

       // ── Story deck words → Main Deck + My Words ──────────────────────────────
    try {
      const storyDeckWords = await utils.client.sync.pullStoryDeckWords.query();
      for (const item of storyDeckWords) {
        if (item.storyId === 0) await addWordToDeck(MAIN_DECK_ID, item.word);
        else if (item.storyId === -1) await addWordToDeck(MY_VOCAB_ID, item.word);
      }
    } catch { /* Non-fatal */ }

    // ── Vocab ignored → localStorage ─────────────────────────────────────────
    try {
      const vocabIgnored = await utils.client.sync.pullVocabIgnored.query();
      if (vocabIgnored.length > 0) {
        const words = vocabIgnored.map((v) => v.word);
        localStorage.setItem("mashang_vocab_ignored", JSON.stringify(words));
      }
    } catch { /* Non-fatal */ }

    // ── Segmentation overrides → localStorage ────────────────────────────────
    try {
      const segOverrides = await utils.client.sync.pullSegmentationOverrides.query();
      if (segOverrides.length > 0) {
        const map: Record<number, Record<string, string>> = {};
        for (const row of segOverrides) {
          try {
            map[row.storyId] = JSON.parse(row.overridesJson || "{}");
          } catch { /* skip malformed */ }
        }
        localStorage.setItem("mashang_seg_overrides", JSON.stringify(map));
      }
    } catch { /* Non-fatal */ }

    lastSyncTime = Date.now();
    onStatus?.("success");
  } catch (err) {
    console.error("[Sync] Hydrate error:", err);
    onStatus?.("error");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serverCardToLocal(c: {
  word: string; cardType: string; pinyin?: string | null; definition?: string | null;
  hskBand?: string | null; storyId?: number | null; stability?: number | null;
  difficulty?: number | null; scheduledDays?: number | null; elapsedDays?: number | null;
  reps?: number | null; lapses?: number | null; isLeech?: boolean | null;
  state?: number | null; dueDate?: number | null; lastReviewed?: number | null; updatedAt: number;
}): FlashCard {
  return {
    word: c.word,
    cardType: c.cardType as "zh_en" | "en_zh",
    pinyin: c.pinyin ?? "",
    definition: c.definition ?? "",
    hskBand: c.hskBand ?? "",
    storyId: c.storyId ?? undefined,
    stability: c.stability ?? 0,
    difficulty: c.difficulty ?? 0,
    scheduledDays: c.scheduledDays ?? 0,
    elapsedDays: c.elapsedDays ?? 0,
    reps: c.reps ?? 0,
    lapses: c.lapses ?? 0,
    isLeech: c.isLeech ?? false,
    state: c.state ?? 0,
    dueDate: c.dueDate ?? Date.now(),
    lastReviewed: c.lastReviewed ?? 0,
    updatedAt: c.updatedAt,
  };
}
