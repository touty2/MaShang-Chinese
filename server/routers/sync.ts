import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { verifySessionCookie } from "./auth";
import { publicProcedure, router } from "../_core/trpc";
import {
  syncFlashcards,
  syncCompletedTexts,
  syncWordMistakes,
  syncPreferences,
  syncSegmentationOverrides,
  decks,
  deckCards,
  storyDecks,
  storyDeckWords,
  syncVocabIgnored,
  users,
} from "../../drizzle/schema";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireUser(ctx: { req: { headers?: Record<string, string | string[] | undefined> } }) {
  const cookieHeader = ctx.req.headers?.cookie as string | undefined;
  const userId = await verifySessionCookie(cookieHeader);
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

// ─── Flashcard schema ─────────────────────────────────────────────────────────

const flashcardSchema = z.object({
  word: z.string(),
  cardType: z.enum(["zh_en", "en_zh"]),
  stability: z.number().optional(),
  difficulty: z.number().optional(),
  scheduledDays: z.number().int().optional(),
  elapsedDays: z.number().int().optional(),
  reps: z.number().int().optional(),
  lapses: z.number().int().optional(),
  isLeech: z.boolean().optional(),
  state: z.number().int().optional(),
  dueDate: z.number().optional(),
  lastReviewed: z.number().optional(),
  pinyin: z.string().optional(),
  definition: z.string().optional(),
  hskBand: z.string().optional(),
  storyId: z.number().int().optional(),
  updatedAt: z.number(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

export const syncRouter = router({
  // ── Flashcards ──────────────────────────────────────────────────────────────
  pushFlashcards: publicProcedure
    .input(z.array(flashcardSchema))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      for (const card of input) {
        await db
          .insert(syncFlashcards)
          .values({ userId, ...card })
          .onDuplicateKeyUpdate({ set: { ...card, userId } });
      }
      return { success: true };
    }),

  pullFlashcards: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(syncFlashcards).where(eq(syncFlashcards.userId, userId));
  }),

  deleteFlashcard: publicProcedure
    .input(z.object({ word: z.string(), cardType: z.enum(["zh_en", "en_zh"]) }))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .delete(syncFlashcards)
        .where(
          and(
            eq(syncFlashcards.userId, userId),
            eq(syncFlashcards.word, input.word),
            eq(syncFlashcards.cardType, input.cardType)
          )
        );
      return { success: true };
    }),

  // ── Completed Texts ─────────────────────────────────────────────────────────
  pushCompletedTexts: publicProcedure
    .input(z.array(z.object({ storyId: z.number().int(), completedAt: z.number(), updatedAt: z.number() })))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      for (const item of input) {
        await db
          .insert(syncCompletedTexts)
          .values({ userId, ...item })
          .onDuplicateKeyUpdate({ set: { completedAt: item.completedAt, updatedAt: item.updatedAt } });
      }
      return { success: true };
    }),

  pullCompletedTexts: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(syncCompletedTexts).where(eq(syncCompletedTexts.userId, userId));
  }),

  // ── Word Mistakes ───────────────────────────────────────────────────────────
  pushWordMistakes: publicProcedure
    .input(z.array(z.object({ word: z.string(), count: z.number().int(), updatedAt: z.number() })))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      for (const item of input) {
        await db
          .insert(syncWordMistakes)
          .values({ userId, ...item })
          .onDuplicateKeyUpdate({ set: { count: item.count, updatedAt: item.updatedAt } });
      }
      return { success: true };
    }),

  pullWordMistakes: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(syncWordMistakes).where(eq(syncWordMistakes.userId, userId));
  }),

  // ── Preferences ─────────────────────────────────────────────────────────────
  pushPreferences: publicProcedure
    .input(z.object({ prefsJson: z.string(), updatedAt: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .insert(syncPreferences)
        .values({ userId, prefsJson: input.prefsJson, updatedAt: input.updatedAt })
        .onDuplicateKeyUpdate({ set: { prefsJson: input.prefsJson, updatedAt: input.updatedAt } });
      return { success: true };
    }),

  pullPreferences: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const result = await db.select().from(syncPreferences).where(eq(syncPreferences.userId, userId)).limit(1);
    return result[0] ?? null;
  }),

  // ── Segmentation Overrides ──────────────────────────────────────────────────
  pushSegmentationOverrides: publicProcedure
    .input(z.array(z.object({ storyId: z.number().int(), overridesJson: z.string(), updatedAt: z.number() })))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      for (const item of input) {
        await db
          .insert(syncSegmentationOverrides)
          .values({ userId, ...item })
          .onDuplicateKeyUpdate({ set: { overridesJson: item.overridesJson, updatedAt: item.updatedAt } });
      }
      return { success: true };
    }),

  pullSegmentationOverrides: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(syncSegmentationOverrides).where(eq(syncSegmentationOverrides.userId, userId));
  }),

  // ── Custom Decks ─────────────────────────────────────────────────────────────
  pushDecks: publicProcedure
    .input(
      z.array(
        z.object({
          clientId: z.string(), // temp ID from client
          name: z.string(),
          createdAt: z.number(),
          updatedAt: z.number(),
        })
      )
    )
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const results: { clientId: string; serverId: number }[] = [];
      for (const d of input) {
        const res = await db.insert(decks).values({ userId, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt });
        results.push({ clientId: d.clientId, serverId: (res[0] as { insertId: number }).insertId });
      }
      return results;
    }),

  pullDecks: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const allDecks = await db.select().from(decks).where(eq(decks.userId, userId));
    const allCards = await db.select().from(deckCards).where(eq(deckCards.userId, userId));
    return { decks: allDecks, deckCards: allCards };
  }),

  updateDeck: publicProcedure
    .input(z.object({ id: z.number().int(), name: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(decks)
        .set({ name: input.name, updatedAt: Date.now() })
        .where(and(eq(decks.id, input.id), eq(decks.userId, userId)));
      return { success: true };
    }),

  deleteDeck: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(deckCards).where(and(eq(deckCards.deckId, input.id), eq(deckCards.userId, userId)));
      await db.delete(decks).where(and(eq(decks.id, input.id), eq(decks.userId, userId)));
      return { success: true };
    }),

  addWordToDeck: publicProcedure
    .input(z.object({ deckId: z.number().int(), word: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const now = Date.now();
      await db
        .insert(deckCards)
        .values({ deckId: input.deckId, userId, word: input.word, addedAt: now, updatedAt: now })
        .onDuplicateKeyUpdate({ set: { updatedAt: now } });
      return { success: true };
    }),

  removeWordFromDeck: publicProcedure
    .input(z.object({ deckId: z.number().int(), word: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .delete(deckCards)
        .where(
          and(
            eq(deckCards.deckId, input.deckId),
            eq(deckCards.userId, userId),
            eq(deckCards.word, input.word)
          )
        );
      return { success: true };
    }),

  // ── Story Decks ──────────────────────────────────────────────────────────────
  pushStoryDeckWords: publicProcedure
    .input(
      z.array(
        z.object({
          storyId: z.number().int(),
          word: z.string(),
          addedAt: z.number(),
          updatedAt: z.number(),
        })
      )
    )
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      for (const item of input) {
        await db
          .insert(storyDeckWords)
          .values({ userId, ...item })
          .onDuplicateKeyUpdate({ set: { updatedAt: item.updatedAt } });
      }
      return { success: true };
    }),

  pullStoryDeckWords: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(storyDeckWords).where(eq(storyDeckWords.userId, userId));
  }),

  // ── Vocab Ignored ────────────────────────────────────────────────────────────
  pushVocabIgnored: publicProcedure
    .input(z.array(z.object({ word: z.string(), updatedAt: z.number() })))
    .mutation(async ({ input, ctx }) => {
      const userId = await requireUser(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      for (const item of input) {
        await db
          .insert(syncVocabIgnored)
          .values({ userId, ...item })
          .onDuplicateKeyUpdate({ set: { updatedAt: item.updatedAt } });
      }
      return { success: true };
    }),

  pullVocabIgnored: publicProcedure.query(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(syncVocabIgnored).where(eq(syncVocabIgnored.userId, userId));
  }),

  // ── Reset All Data ───────────────────────────────────────────────────────────
  resetAllData: publicProcedure.mutation(async ({ ctx }) => {
    const userId = await requireUser(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Delete all user data in order
    await db.delete(syncFlashcards).where(eq(syncFlashcards.userId, userId));
    await db.delete(syncCompletedTexts).where(eq(syncCompletedTexts.userId, userId));
    await db.delete(syncWordMistakes).where(eq(syncWordMistakes.userId, userId));
    await db.delete(syncPreferences).where(eq(syncPreferences.userId, userId));
    await db.delete(syncSegmentationOverrides).where(eq(syncSegmentationOverrides.userId, userId));
    await db.delete(storyDeckWords).where(eq(storyDeckWords.userId, userId));
    await db.delete(storyDecks).where(eq(storyDecks.userId, userId));
    await db.delete(deckCards).where(eq(deckCards.userId, userId));
    await db.delete(decks).where(eq(decks.userId, userId));
    await db.delete(syncVocabIgnored).where(eq(syncVocabIgnored.userId, userId));
    await db.delete(users).where(eq(users.id, userId));

    // Clear session cookie
    ctx.res.clearCookie("mashang_session", { path: "/", maxAge: -1 });
    return { success: true };
  }),
});
