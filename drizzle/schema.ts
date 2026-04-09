import {
  boolean,
  float,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
  index,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Flashcards ───────────────────────────────────────────────────────────────

export const syncFlashcards = mysqlTable(
  "sync_flashcards",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    word: varchar("word", { length: 64 }).notNull(),
    cardType: mysqlEnum("cardType", ["zh_en", "en_zh"]).notNull(),
    // FSRS fields
    stability: float("stability").default(0),
    difficulty: float("difficulty").default(0),
    scheduledDays: int("scheduledDays").default(0),
    elapsedDays: int("elapsedDays").default(0),
    reps: int("reps").default(0),
    lapses: int("lapses").default(0),
    isLeech: boolean("isLeech").default(false),
    state: int("state").default(0), // 0=New,1=Learning,2=Review,3=Relearning
    dueDate: bigint("dueDate", { mode: "number" }), // UTC ms
    lastReviewed: bigint("lastReviewed", { mode: "number" }), // UTC ms
    // Metadata
    pinyin: varchar("pinyin", { length: 128 }),
    definition: text("definition"),
    hskBand: varchar("hskBand", { length: 32 }),
    storyId: int("storyId"),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("fc_user_word_type").on(t.userId, t.word, t.cardType)]
);

// ─── Completed Texts ──────────────────────────────────────────────────────────

export const syncCompletedTexts = mysqlTable(
  "sync_completed_texts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    storyId: int("storyId").notNull(),
    completedAt: bigint("completedAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("ct_user_story").on(t.userId, t.storyId)]
);

// ─── Word Mistakes ────────────────────────────────────────────────────────────

export const syncWordMistakes = mysqlTable(
  "sync_word_mistakes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    word: varchar("word", { length: 64 }).notNull(),
    count: int("count").default(1),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("wm_user_word").on(t.userId, t.word)]
);

// ─── Preferences ──────────────────────────────────────────────────────────────

export const syncPreferences = mysqlTable("sync_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  prefsJson: text("prefsJson").notNull(),
  updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
});

// ─── Segmentation Overrides ───────────────────────────────────────────────────

export const syncSegmentationOverrides = mysqlTable(
  "sync_segmentation_overrides",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    storyId: int("storyId").notNull(),
    overridesJson: text("overridesJson").notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("so_user_story").on(t.userId, t.storyId)]
);

// ─── Custom Decks ─────────────────────────────────────────────────────────────

export const decks = mysqlTable(
  "decks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("decks_user").on(t.userId)]
);

export const deckCards = mysqlTable(
  "deck_cards",
  {
    id: int("id").autoincrement().primaryKey(),
    deckId: int("deckId").notNull(),
    userId: int("userId").notNull(),
    word: varchar("word", { length: 64 }).notNull(),
    addedAt: bigint("addedAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("dc_deck_word").on(t.deckId, t.word)]
);

// ─── Story Decks ──────────────────────────────────────────────────────────────

export const storyDecks = mysqlTable(
  "story_decks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    storyId: int("storyId").notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("sd_user_story").on(t.userId, t.storyId)]
);

export const storyDeckWords = mysqlTable(
  "story_deck_words",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    storyId: int("storyId").notNull(),
    word: varchar("word", { length: 64 }).notNull(),
    addedAt: bigint("addedAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("sdw_user_story_word").on(t.userId, t.storyId, t.word)]
);

// ─── Vocab Ignored ────────────────────────────────────────────────────────────

export const syncVocabIgnored = mysqlTable(
  "sync_vocab_ignored",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    word: varchar("word", { length: 64 }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [index("vi_user_word").on(t.userId, t.word)]
);
