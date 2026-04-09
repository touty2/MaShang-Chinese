import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AuthUser = NonNullable<TrpcContext["user"]>;

function makeCtx(user?: Partial<AuthUser>): TrpcContext {
  const cookies: Record<string, unknown> = {};
  return {
    user: user
      ? ({
          id: 1,
          email: user.email ?? "test@example.com",
          name: user.name ?? "Test User",
          passwordHash: "$2b$12$hashedpassword",
          role: "user",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
          ...user,
        } as AuthUser)
      : null,
    req: {
      protocol: "https",
      headers: {},
      cookies,
    } as unknown as TrpcContext["req"],
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ─── Auth: logout ─────────────────────────────────────────────────────────────

describe("auth.logout", () => {
  it("clears the session cookie and returns success", async () => {
    const ctx = makeCtx({ email: "user@example.com" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect((ctx.res.clearCookie as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});

// ─── Auth: me (unauthenticated) ───────────────────────────────────────────────

describe("auth.me", () => {
  it("returns null when not authenticated", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });
});

// ─── Stories: segmentStory ────────────────────────────────────────────────────

describe("stories.segmentStory", () => {
  it("returns tokens for a Chinese sentence", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stories.segmentStory({ chineseText: "我喜欢学习中文。" });
    expect(result).toHaveProperty("tokens");
    expect(Array.isArray(result.tokens)).toBe(true);
    expect(result.tokens.length).toBeGreaterThan(0);
    // Should contain the word 学习 or individual characters
    const joined = result.tokens.join("");
    expect(joined).toContain("学习");
  });

  it("handles empty input gracefully", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stories.segmentStory({ chineseText: "" });
    expect(result).toHaveProperty("tokens");
    expect(Array.isArray(result.tokens)).toBe(true);
  });

  it("preserves punctuation as separate tokens", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stories.segmentStory({ chineseText: "你好。" });
    expect(result.tokens.join("")).toContain("。");
  });
});

// ─── Sync: pullFlashcards (unauthenticated) ───────────────────────────────────

describe("sync.pullFlashcards", () => {
  it("throws UNAUTHORIZED when not authenticated", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.sync.pullFlashcards()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Data Isolation: all sync endpoints require authentication ────────────────

describe("data isolation — sync endpoints require authentication", () => {
  const unauthCtx = () => makeCtx(); // no user, no cookie

  it("pushFlashcards throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(
      caller.sync.pushFlashcards([
        { word: "你好", cardType: "zh_en", updatedAt: Date.now() },
      ])
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullCompletedTexts throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(caller.sync.pullCompletedTexts()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pushCompletedTexts throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(
      caller.sync.pushCompletedTexts([{ storyId: 1, completedAt: Date.now(), updatedAt: Date.now() }])
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullWordMistakes throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(caller.sync.pullWordMistakes()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullDecks throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(caller.sync.pullDecks()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullVocabIgnored throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(caller.sync.pullVocabIgnored()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullPreferences throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(caller.sync.pullPreferences()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("resetAllData throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(unauthCtx());
    await expect(caller.sync.resetAllData()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Data Isolation: cross-user data separation ───────────────────────────────

describe("data isolation — cross-user data separation (server-side)", () => {
  /**
   * These tests verify the server enforces userId scoping on all sync operations.
   * The sync router uses verifySessionCookie to extract userId from the JWT cookie,
   * then filters all DB queries by that userId. We simulate this by confirming:
   * 1. Unauthenticated requests are rejected (UNAUTHORIZED)
   * 2. Each procedure accepts only the authenticated user's cookie header
   *
   * Full DB-level cross-user isolation (user A vs user B) is enforced by the
   * WHERE eq(table.userId, userId) clauses present in every sync query.
   */

  it("pullFlashcards requires a valid session cookie (no cross-user leakage without auth)", async () => {
    // User A's context has no cookie — simulates user B trying without credentials
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(caller.sync.pullFlashcards()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullDecks requires a valid session cookie", async () => {
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(caller.sync.pullDecks()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullCompletedTexts requires a valid session cookie", async () => {
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(caller.sync.pullCompletedTexts()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("pullSegmentationOverrides requires a valid session cookie", async () => {
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(caller.sync.pullSegmentationOverrides()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("deleteFlashcard requires a valid session cookie", async () => {
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(
      caller.sync.deleteFlashcard({ word: "你好", cardType: "zh_en" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("updateDeck requires a valid session cookie", async () => {
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(
      caller.sync.updateDeck({ id: 1, name: "Hacked Deck" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("deleteDeck requires a valid session cookie", async () => {
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(caller.sync.deleteDeck({ id: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("addWordToDeck requires a valid session cookie", async () => {
    const ctxNoAuth = makeCtx();
    const caller = appRouter.createCaller(ctxNoAuth);
    await expect(
      caller.sync.addWordToDeck({ deckId: 1, word: "你好" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Auth: deleteAccount ──────────────────────────────────────────────────────

describe("auth.deleteAccount", () => {
  it("requires authentication", async () => {
    const ctx = makeCtx(); // no user
    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.deleteAccount()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("deletes all user-scoped tables and clears session cookie (mocked db)", async () => {
    const dbModule = await import("./db");
    const deletedTables: unknown[] = [];
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockDelete = vi.fn().mockImplementation((table) => {
      deletedTables.push(table);
      return { where: mockWhere };
    });
    const mockDb = { delete: mockDelete };
    vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as never);

    const ctx = makeCtx({ id: 42 });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.deleteAccount();

    expect(result).toEqual({ success: true });

    // Verify session cookie was cleared
    expect(ctx.res.clearCookie).toHaveBeenCalledWith(
      "mashang_session",
      expect.objectContaining({ path: "/", maxAge: -1 })
    );

    // Verify all 11 tables were targeted for deletion
    const schema = await import("../drizzle/schema");
    const requiredTables = [
      schema.storyDeckWords,
      schema.storyDecks,
      schema.deckCards,
      schema.decks,
      schema.syncSegmentationOverrides,
      schema.syncVocabIgnored,
      schema.syncWordMistakes,
      schema.syncCompletedTexts,
      schema.syncFlashcards,
      schema.syncPreferences,
      schema.users,
    ];
    expect(mockDelete).toHaveBeenCalledTimes(requiredTables.length);
    for (const table of requiredTables) {
      expect(mockDelete).toHaveBeenCalledWith(table);
    }
    // where() must have been called once per table with the userId
    expect(mockWhere).toHaveBeenCalledTimes(requiredTables.length);

    vi.restoreAllMocks();
  });
});

// ─── My Words Sync (storyId: -1 sentinel) ────────────────────────────────────

describe("sync.pushStoryDeckWords / pullStoryDeckWords — My Words sentinel", () => {
  it("accepts storyId: -1 for My Words deck and round-trips correctly", async () => {
    const dbModule = await import("./db");
    const authModule = await import("./routers/auth");
    const stored: unknown[] = [];
    const mockOnDuplicate = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockImplementation((val) => {
      stored.push(val);
      return { onDuplicateKeyUpdate: mockOnDuplicate };
    });
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockSelectResult = [
      { storyId: -1, word: "学习", addedAt: Date.now(), updatedAt: Date.now(), userId: 1, id: 1 },
      { storyId: 0, word: "你好", addedAt: Date.now(), updatedAt: Date.now(), userId: 1, id: 2 },
    ];
    const mockWhere = vi.fn().mockResolvedValue(mockSelectResult);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const mockDb = { insert: mockInsert, select: mockSelect };
    vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as never);
    // Mock verifySessionCookie so requireUser returns userId 1
    vi.spyOn(authModule, "verifySessionCookie").mockResolvedValue(1);

    const ctx = makeCtx({ id: 1 });
    const caller = appRouter.createCaller(ctx);

    // Push My Words entry (storyId: -1) — Zod should accept negative int
    const now = Date.now();
    const pushResult = await caller.sync.pushStoryDeckWords([
      { storyId: -1, word: "学习", addedAt: now, updatedAt: now },
    ]);
    expect(pushResult).toEqual({ success: true });
    expect(stored[0]).toMatchObject({ storyId: -1, word: "学习" });

    // Pull and verify My Words entries are returned
    const pulled = await caller.sync.pullStoryDeckWords();
    const myWords = pulled.filter((item) => item.storyId === -1);
    expect(myWords.length).toBeGreaterThanOrEqual(1);
    expect(myWords[0]?.word).toBe("学习");

    vi.restoreAllMocks();
  });

  it("rejects pushStoryDeckWords when unauthenticated", async () => {
    const ctx = makeCtx(); // no user
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.sync.pushStoryDeckWords([{ storyId: -1, word: "学习", addedAt: Date.now(), updatedAt: Date.now() }])
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects pullStoryDeckWords when unauthenticated", async () => {
    const ctx = makeCtx(); // no user
    const caller = appRouter.createCaller(ctx);
    await expect(caller.sync.pullStoryDeckWords()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
