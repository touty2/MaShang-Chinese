# MaShang Chinese — TODO

## Database
- [x] Restore full schema: syncFlashcards, syncCompletedTexts, syncWordMistakes, syncPreferences, syncSegmentationOverrides, decks, deckCards, storyDecks, storyDeckWords, syncVocabIgnored
- [x] Run DB migrations via webdev_execute_sql

## Server
- [x] Restore server/db.ts with all query helpers
- [x] Restore server/segmentationService.ts (jieba)
- [x] Restore server/storage.ts
- [x] Restore server/routers/auth.ts
- [x] Restore server/routers/sync.ts
- [x] Restore server/routers/stories.ts
- [x] Restore server/routers.ts (wire all routers)
- [x] Restore server/mashang.test.ts

## Shared
- [x] Restore shared/const.ts
- [x] Restore shared/types.ts

## Client — Core
- [x] Restore client/src/index.css (theme + fonts)
- [x] Restore client/src/main.tsx
- [x] Restore client/src/App.tsx (routes + DashboardLayout)
- [x] Restore client/src/const.ts

## Client — Contexts
- [x] Restore AuthContext.tsx
- [x] Restore SettingsContext.tsx
- [x] Restore ThemeContext.tsx

## Client — Hooks
- [x] Restore useComposition.ts
- [x] Restore useMobile.tsx
- [x] Restore usePersistFn.ts

## Client — Lib
- [x] Restore lib/dictionary.ts
- [x] Restore lib/flashcardStore.ts
- [x] Restore lib/deckStore.ts
- [x] Restore lib/stories.ts
- [x] Restore lib/syncService.ts
- [x] Restore lib/trpc.ts

## Client — Pages
- [x] Restore pages/AuthPage.tsx
- [x] Restore pages/Home.tsx
- [x] Restore pages/Dashboard.tsx
- [x] Restore pages/StoryPage.tsx
- [x] Restore pages/Vocab.tsx
- [x] Restore pages/Deck.tsx
- [x] Restore pages/Sessions.tsx
- [x] Restore pages/Settings.tsx
- [x] Restore pages/NotFound.tsx

## Client — Components
- [x] Restore AppLayout component (sidebar navigation)
- [x] Restore all UI components (shadcn/ui)

## Dependencies
- [x] Install @node-rs/jieba, bcryptjs, ts-fsrs, and other extras
- [x] Apply wouter patch

## Quality
- [x] Verify dev server builds without TypeScript errors
- [x] Run vitest tests (28 tests passing)

## Bug Fixes
- [x] Word popup portal fix (createPortal to document.body to escape overflow-hidden container)
- [x] DB migration: all 11 tables created with TiDB-compatible syntax
- [x] Custom email/password auth context (overrides Manus OAuth SDK)

## Persistent Flashcard Session (Bug Fix)
- [x] Implement date-keyed session store in IndexedDB (sessionStore.ts)
- [x] On Deck page mount: restore today's session queue, current card index, and per-card reviewed status
- [x] After each card review: auto-save session state to IndexedDB
- [x] Completed session stays on "All done" screen until next day's cards arrive
- [x] Session state survives browser restarts and re-logins

## Flashcard Bug Fixes (Round 2)
- [x] Fix card flip transition: next card's back face briefly visible during flip animation
- [x] Fix pinyin display: convert numeric tones (e.g. xue2 xi2) to diacritic marks (xué xí)

## Vocab Page Bug Fix
- [x] Fix "My Words" tab: words added to deck disappear from tab — now reads directly from MY_VOCAB_ID deck in IndexedDB

## Future Enhancements
- [ ] Pinyin display toggle (show/hide pinyin above characters in story reader)
- [ ] Story deck auto-generation from story vocabulary
- [x] Sessions page: story browser with HSK tabs, search, completion tracking
