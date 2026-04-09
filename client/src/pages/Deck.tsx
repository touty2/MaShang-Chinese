import { useEffect, useState, useCallback, useRef } from "react";
import {
  Layers, Plus, Trash2, Edit2, Check, X,
  Volume2, ChevronDown, ChevronUp, Loader2, BookOpen, RotateCcw, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  getAllCards, rateCard, removeWord,
  getIntervalLabel, Rating, State, type FlashCard
} from "@/lib/flashcardStore";
import {
  getAllDecks, createDeck, renameDeck, deleteDeck,
  getWordsInDeck, getDeckCounts, type LocalDeck,
  MAIN_DECK_ID, MY_VOCAB_ID
} from "@/lib/deckStore";
import { useSettings } from "@/contexts/SettingsContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { addWord } from "@/lib/flashcardStore";
import { addWordToDeck } from "@/lib/deckStore";
import { loadDictionary, lookupWord } from "@/lib/dictionary";
import { numericToTone } from "@/lib/pinyin";
import {
  loadSession, saveSession, clearSession, pruneOldSessions,
  makeSessionKey, serializeKey, type CardKey, type PersistedSession
} from "@/lib/sessionStore";
import { trpc } from "@/lib/trpc";

// ─── Review Session ───────────────────────────────────────────────────────────

/**
 * ReviewSession now accepts an optional `initialSession` that lets it resume
 * a previously persisted session.  After every card rating it calls
 * `onSaveSession` so the parent can persist the updated state.
 */
function ReviewSession({
  cards,
  allCards,
  settings,
  deckIds,
  initialSession,
  onDone,
  onSaveSession,
}: {
  /** Due cards for a fresh session */
  cards: FlashCard[];
  /** All cards (for restoring a persisted session queue) */
  allCards: FlashCard[];
  settings: ReturnType<typeof useSettings>["settings"];
  deckIds: string[];
  initialSession: PersistedSession | null;
  onDone: (reviewed: number) => void;
  onSaveSession: (session: PersistedSession) => void;
}) {
  // tRPC utils for fire-and-forget server push after each card rating
  const utils = trpc.useUtils();

  // ── Build the queue ────────────────────────────────────────────────────────
  // If we have a persisted session, restore the queue from it (preserving
  // original order, minus already-reviewed cards).  Otherwise shuffle fresh.
  const buildQueue = useCallback((): FlashCard[] => {
    if (initialSession && initialSession.originalQueue.length > 0) {
      const reviewedSet = new Set(initialSession.reviewedKeys);
      // Use allCards (not just due cards) so we can look up any card in the original queue,
      // including cards whose dueDate was updated after being reviewed in this session.
      const cardMap = new Map(allCards.map((c) => [serializeKey(c), c]));
      return initialSession.originalQueue
        .filter((k) => !reviewedSet.has(serializeKey(k)))
        .map((k) => cardMap.get(serializeKey(k)))
        .filter((c): c is FlashCard => c !== undefined);
    }
    // Fresh shuffle with anti-adjacency pass
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < shuffled.length - 1; i++) {
      if (shuffled[i].word === shuffled[i + 1].word) {
        const swapIdx = shuffled.findIndex((c, k) => k > i + 1 && c.word !== shuffled[i].word);
        if (swapIdx !== -1) {
          [shuffled[i + 1], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[i + 1]];
        }
      }
    }
    return shuffled;
  }, []); // intentionally stable — only runs once on mount

  // Build original queue for persistence (full ordered list before any reviews)
  const originalQueueRef = useRef<CardKey[]>(
    initialSession?.originalQueue ??
    (() => {
      // We need the same shuffle order — compute it once here
      const shuffled = [...cards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (let i = 0; i < shuffled.length - 1; i++) {
        if (shuffled[i].word === shuffled[i + 1].word) {
          const swapIdx = shuffled.findIndex((c, k) => k > i + 1 && c.word !== shuffled[i].word);
          if (swapIdx !== -1) {
            [shuffled[i + 1], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[i + 1]];
          }
        }
      }
      return shuffled.map((c) => ({ word: c.word, cardType: c.cardType }));
    })()
  );

  const initialQueueRef = useRef<FlashCard[]>(buildQueue());
  const [queue, setQueue] = useState<FlashCard[]>(initialQueueRef.current);
  const [current, setCurrent] = useState<FlashCard | null>(initialQueueRef.current[0] ?? null);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(initialSession?.reviewed ?? 0);
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(
    new Set(initialSession?.reviewedKeys ?? [])
  );
  const [sessionDone, setSessionDone] = useState(
    // Restore done state: if session was completed AND no new cards have appeared
    () => (initialSession?.isDone ?? false) && initialQueueRef.current.length === 0
  );
  const [largeFontMode, setLargeFontMode] = useState(false);
  // pendingNext holds the next card to show AFTER the flip-back animation completes,
  // preventing the next card's back face from being briefly visible during the transition.
  const pendingNextRef = useRef<FlashCard | null>(null);
  const flipAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "zh-CN";
    utt.rate = settings.ttsSpeed;
    window.speechSynthesis.speak(utt);
  }, [settings.ttsSpeed]);

  const handleFlip = useCallback(() => {
    setFlipped((prev) => {
      const next = !prev;
      if (next && settings.playAudioOnFlip && current) {
        speak(current.word);
      }
      return next;
    });
  }, [current, settings.playAudioOnFlip, speak]);

  const handleRate = useCallback(async (rating: Rating) => {
    if (!current) return;
    const updatedCard = await rateCard(current, rating, settings.desiredRetention, settings.maxInterval);
    // Fire-and-forget: push the updated card to the server so progress persists
    // across logins. Do NOT await — we don't want to block the UI.
    utils.client.sync.pushFlashcards.mutate([{
      word: updatedCard.word,
      cardType: updatedCard.cardType,
      stability: updatedCard.stability,
      difficulty: updatedCard.difficulty,
      scheduledDays: updatedCard.scheduledDays,
      elapsedDays: updatedCard.elapsedDays,
      reps: updatedCard.reps,
      lapses: updatedCard.lapses,
      isLeech: updatedCard.isLeech,
      state: updatedCard.state,
      dueDate: updatedCard.dueDate,
      lastReviewed: updatedCard.lastReviewed,
      pinyin: updatedCard.pinyin,
      definition: updatedCard.definition,
      hskBand: updatedCard.hskBand,
      storyId: updatedCard.storyId,
      updatedAt: updatedCard.updatedAt,
    }]).catch((err) => {
      console.warn("[Deck] Failed to push card to server (will sync later):", err);
    });
    const newReviewed = reviewed + 1;
    const newReviewedKey = serializeKey(current);
    const newReviewedKeys = new Set(Array.from(reviewedKeys).concat(newReviewedKey));
    setReviewed(newReviewed);
    setReviewedKeys(newReviewedKeys);

    const remaining = queue.slice(1);
    const isDone = remaining.length === 0;

    // Persist after every rating
    const updatedSession: PersistedSession = {
      date: new Date().toLocaleDateString("sv"), // "YYYY-MM-DD"
      deckKey: [...deckIds].sort().join(","),
      originalQueue: originalQueueRef.current,
      reviewedKeys: Array.from(newReviewedKeys),
      reviewed: newReviewed,
      isDone,
      updatedAt: Date.now(),
    };
    onSaveSession(updatedSession);

    if (isDone) {
      setSessionDone(true);
      onDone(newReviewed);
    } else {
      setQueue(remaining);
      // Stage the next card — flip back first, then swap content after animation
      pendingNextRef.current = remaining[0];
      setFlipped(false);
      // Clear any previous timer
      if (flipAnimTimerRef.current) clearTimeout(flipAnimTimerRef.current);
      // Swap card content after the CSS transition (0.5s) completes
      flipAnimTimerRef.current = setTimeout(() => {
        setCurrent(pendingNextRef.current);
        pendingNextRef.current = null;
      }, 520); // slightly longer than the 0.5s CSS transition
    }
  }, [current, queue, reviewed, reviewedKeys, deckIds, settings, onDone, onSaveSession]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); handleFlip(); }
      if (flipped) {
        if (e.key === "1") handleRate(Rating.Again);
        if (e.key === "2") handleRate(Rating.Hard);
        if (e.key === "3") handleRate(Rating.Good);
        if (e.key === "4") handleRate(Rating.Easy);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flipped, handleFlip, handleRate]);

  if (sessionDone || !current) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Session complete!</h2>
        <p className="text-muted-foreground text-sm">Reviewed {reviewed} card{reviewed !== 1 ? "s" : ""}</p>
        <Button onClick={() => onDone(reviewed)}>Back to deck</Button>
      </div>
    );
  }

  const progress = Math.round((reviewed / (reviewed + queue.length)) * 100);
  const isFront = current.cardType === "zh_en";

  const intervals = flipped ? {
    again: getIntervalLabel(current, Rating.Again, settings.desiredRetention),
    hard:  getIntervalLabel(current, Rating.Hard,  settings.desiredRetention),
    good:  getIntervalLabel(current, Rating.Good,  settings.desiredRetention),
    easy:  getIntervalLabel(current, Rating.Easy,  settings.desiredRetention),
  } : null;

  const charSize = largeFontMode ? "text-8xl" : "text-7xl";
  const defSize  = largeFontMode ? "text-xl"  : "text-lg";

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{reviewed} / {reviewed + queue.length}</span>
          <span>{queue.length} left</span>
        </div>
        <Progress value={progress} className="h-1" />
      </div>

      {/* Card — click anywhere to flip (3D flip animation) */}
      <div
        className="card-scene w-full cursor-pointer select-none"
        style={{ minHeight: 280 }}
        onClick={handleFlip}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); handleFlip(); } }}
        aria-label={flipped ? "Flip card back" : "Flip card to reveal answer"}
      >
        <div className={cn("card-inner", flipped && "flipped")} style={{ minHeight: 280 }}>

          {/* ── FRONT face ── */}
          <div className="card-face rounded-2xl bg-white dark:bg-card border border-border shadow-sm min-h-[280px] flex flex-col items-center justify-center px-8 py-12 gap-6">
            {isFront ? (
              <span className={cn("font-bold text-foreground leading-none tracking-tight", charSize)}>
                {current.word}
              </span>
            ) : (
              <p className="text-2xl text-center text-foreground font-medium max-w-sm leading-snug">
                {current.definition}
              </p>
            )}
            <p className="text-xs tracking-widest uppercase text-muted-foreground/60 font-medium">
              TAP CARD TO REVEAL
            </p>
          </div>

          {/* ── BACK face ── */}
          <div className="card-face back rounded-2xl bg-white dark:bg-card border border-border shadow-sm min-h-[280px] flex flex-col">
            <div className="flex flex-col items-center justify-center px-8 pt-10 pb-6 gap-2 border-b border-border/50">
              <span className={cn("font-bold text-foreground leading-none tracking-tight", charSize)}>
                {current.word}
              </span>
              <p className="text-primary text-lg font-medium tracking-wide">{numericToTone(current.pinyin)}</p>
            </div>
            <div className="px-8 py-5 overflow-y-auto max-h-48">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">DEFINITION</p>
              <p className={cn("text-foreground", defSize)}>{current.definition}</p>
            </div>
          </div>

        </div>
      </div>

      {/* Controls row: speaker + font size */}
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); speak(current.word); }}
          className="p-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
          title="Pronounce"
        >
          <Volume2 className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => setLargeFontMode((v) => !v)}
          className="p-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
          title={largeFontMode ? "Smaller font" : "Larger font"}
        >
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
        </button>
        <span className="text-xs text-muted-foreground ml-auto">{settings.ttsSpeed}×</span>
      </div>

      {/* Rating buttons — only shown after flip */}
      {flipped && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { rating: Rating.Again, label: "Again", icon: <RotateCcw className="w-5 h-5" />, bg: "bg-red-50 dark:bg-red-950/40",    text: "text-red-500",    border: "border-red-200 dark:border-red-800",    hover: "hover:bg-red-100 dark:hover:bg-red-900/50" },
            { rating: Rating.Good,  label: "Good",  icon: <Check className="w-5 h-5" />,      bg: "bg-green-50 dark:bg-green-950/40", text: "text-green-600",  border: "border-green-200 dark:border-green-800",  hover: "hover:bg-green-100 dark:hover:bg-green-900/50" },
            { rating: Rating.Hard,  label: "Hard",  icon: null,                                bg: "bg-yellow-50 dark:bg-yellow-950/40",text: "text-yellow-600", border: "border-yellow-200 dark:border-yellow-800", hover: "hover:bg-yellow-100 dark:hover:bg-yellow-900/50" },
            { rating: Rating.Easy,  label: "Easy",  icon: null,                                bg: "bg-sky-50 dark:bg-sky-950/40",     text: "text-sky-500",   border: "border-sky-200 dark:border-sky-800",     hover: "hover:bg-sky-100 dark:hover:bg-sky-900/50" },
          ].map(({ rating, label, icon, bg, text, border, hover }) => (
            <button
              key={rating}
              onClick={() => handleRate(rating)}
              className={cn(
                "flex flex-col items-center justify-center py-4 px-3 rounded-xl border font-semibold transition-colors",
                bg, text, border, hover
              )}
            >
              {icon && <span className="mb-1">{icon}</span>}
              <span className="text-base">{label}</span>
              <span className="text-xs font-normal opacity-70 mt-0.5">
                {intervals?.[label.toLowerCase() as keyof typeof intervals]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Placeholder to keep layout stable before flip */}
      {!flipped && <div className="h-4" />}
    </div>
  );
}

// ─── Deck Toggle Panel ────────────────────────────────────────────────────────

function DeckTogglePanel({
  decks,
  counts,
  selectedDeckIds,
  onToggle,
  onCreateDeck,
  onRenameDeck,
  onDeleteDeck,
}: {
  decks: LocalDeck[];
  counts: Record<string, number>;
  selectedDeckIds: Set<string>;
  onToggle: (id: string) => void;
  onCreateDeck: (name: string) => void;
  onRenameDeck: (id: string, name: string) => void;
  onDeleteDeck: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<LocalDeck | null>(null);

  const systemDecks = decks.filter((d) => d.id === MAIN_DECK_ID || d.id === MY_VOCAB_ID);
  const customDecks = decks.filter((d) => d.id !== MAIN_DECK_ID && d.id !== MY_VOCAB_ID);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="text-sm font-medium text-foreground">
          Decks ({selectedDeckIds.size} selected)
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="p-3 space-y-1 border-t border-border">
          {/* System decks */}
          {systemDecks.map((deck) => (
            <label key={deck.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/40 cursor-pointer">
              <Checkbox
                checked={selectedDeckIds.has(deck.id)}
                onCheckedChange={() => onToggle(deck.id)}
              />
              <span className="text-sm text-foreground flex-1">{deck.name}</span>
              <Badge variant="secondary" className="text-xs">{counts[deck.id] ?? 0}</Badge>
            </label>
          ))}

          {/* Custom decks */}
          {customDecks.map((deck) => (
            <div key={deck.id} className="flex items-center gap-1 group">
              <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/40 cursor-pointer flex-1">
                <Checkbox
                  checked={selectedDeckIds.has(deck.id)}
                  onCheckedChange={() => onToggle(deck.id)}
                />
                <span className="text-sm text-foreground flex-1">{deck.name}</span>
                <Badge variant="secondary" className="text-xs">{counts[deck.id] ?? 0}</Badge>
              </label>
              <button
                onClick={() => setRenaming({ id: deck.id, name: deck.name })}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
              >
                <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => setDeleting(deck)}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {/* Create new deck */}
          {creating ? (
            <div className="flex gap-2 mt-2 px-2">
              <Input
                autoFocus
                placeholder="Deck name…"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newDeckName.trim()) {
                    onCreateDeck(newDeckName.trim());
                    setNewDeckName("");
                    setCreating(false);
                  }
                  if (e.key === "Escape") { setCreating(false); setNewDeckName(""); }
                }}
                className="h-8 text-sm"
              />
              <Button size="sm" className="h-8 px-3" onClick={() => {
                if (newDeckName.trim()) {
                  onCreateDeck(newDeckName.trim());
                  setNewDeckName("");
                  setCreating(false);
                }
              }}>Add</Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setCreating(false); setNewDeckName(""); }}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-lg w-full transition-colors mt-1"
            >
              <Plus className="w-3.5 h-3.5" /> New deck
            </button>
          )}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(o) => { if (!o) setRenaming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename deck</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renaming?.name ?? ""}
            onChange={(e) => setRenaming((r) => r ? { ...r, name: e.target.value } : r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renaming?.name.trim()) {
                onRenameDeck(renaming.id, renaming.name.trim());
                setRenaming(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button onClick={() => {
              if (renaming?.name.trim()) {
                onRenameDeck(renaming.id, renaming.name.trim());
                setRenaming(null);
              }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the deck and its word list. The flashcards themselves are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleting) { onDeleteDeck(deleting.id); setDeleting(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Deck Page ───────────────────────────────────────────────────────────

export default function Deck() {
  const { settings } = useSettings();
  const { user } = useAuth();
  const userId = user?.email ?? undefined;
  const [allCards, setAllCards] = useState<FlashCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [decks, setDecks] = useState<LocalDeck[]>([]);
  const [deckCounts, setDeckCounts] = useState<Record<string, number>>({});
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set([MAIN_DECK_ID, MY_VOCAB_ID]));
  const [deckWordSets, setDeckWordSets] = useState<Record<string, Set<string>>>({});

  // ── Persistent session state ───────────────────────────────────────────────
  const [persistedSession, setPersistedSession] = useState<PersistedSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // ── Add Word dialog state ──────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [newPinyin, setNewPinyin] = useState("");
  const [newDef, setNewDef] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const addLookupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddWordChange = useCallback(async (value: string) => {
    setNewWord(value);
    setLookupNotFound(false);
    if (!value.trim()) {
      setNewPinyin("");
      setNewDef("");
      if (addLookupTimeout.current) clearTimeout(addLookupTimeout.current);
      return;
    }
    if (addLookupTimeout.current) clearTimeout(addLookupTimeout.current);
    addLookupTimeout.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        await loadDictionary();
        const entry = await lookupWord(value.trim());
        if (entry) {
          setNewPinyin(numericToTone(entry.pinyinDisplay || entry.pinyin));
          setNewDef(entry.definitions.slice(0, 3).join("; "));
          setLookupNotFound(false);
        } else {
          setNewPinyin("");
          setNewDef("");
          setLookupNotFound(true);
        }
      } finally {
        setLookingUp(false);
      }
    }, 350);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [cards, allDecks, counts] = await Promise.all([
      getAllCards(),
      getAllDecks(),
      getDeckCounts(),
    ]);
    setAllCards(cards);
    setDecks(allDecks);
    setDeckCounts(counts);

    const sets: Record<string, Set<string>> = {};
    for (const deck of allDecks) {
      const words = await getWordsInDeck(deck.id);
      sets[deck.id] = new Set(words);
    }
    setDeckWordSets(sets);
    setLoading(false);
  }, []);

  // On mount: prune old sessions and load today's session for the current deck selection
  useEffect(() => {
    pruneOldSessions();
    loadAll();
  }, [loadAll]);

  // Load persisted session whenever deck selection changes
  useEffect(() => {
    if (loading) return;
    const deckIds = Array.from(selectedDeckIds);
    loadSession(deckIds, userId).then((session) => {
      setPersistedSession(session);
      setSessionLoaded(true);
    });
  }, [selectedDeckIds, loading]);

  const handleAddWordSubmit = useCallback(async () => {
    if (!newWord.trim()) return;
    await addWord(newWord.trim(), newPinyin.trim(), newDef.trim(), "Custom");
    await addWordToDeck(MY_VOCAB_ID, newWord.trim());
    await loadAll();
    setAddOpen(false);
    setNewWord(""); setNewPinyin(""); setNewDef("");
    toast.success(`Added "${newWord.trim()}" to My Words`);
  }, [newWord, newPinyin, newDef, loadAll]);

  // Cards to review = cards whose word is in ANY selected deck
  const filteredDueCards = (() => {
    if (selectedDeckIds.size === 0) return [];
    const now = Date.now();
    const mainSelected = selectedDeckIds.has(MAIN_DECK_ID);
    const allowedWords = new Set<string>();

    if (mainSelected) {
      Array.from(deckWordSets[MAIN_DECK_ID] ?? []).forEach((w) => allowedWords.add(w));
    }
    Array.from(selectedDeckIds).forEach((id) => {
      if (id === MAIN_DECK_ID) return;
      Array.from(deckWordSets[id] ?? []).forEach((w) => allowedWords.add(w));
    });

    const direction = settings.cardDirection ?? "zh_en";
    let due = allCards.filter((c) => {
      if (!allowedWords.has(c.word)) return false;
      if (direction !== "mixed" && c.cardType !== direction) return false;
      return c.dueDate <= now;
    });
    due.sort((a, b) => {
      if (a.state === 0 && b.state !== 0) return -1;
      if (b.state === 0 && a.state !== 0) return 1;
      return a.dueDate - b.dueDate;
    });
    if (direction === "mixed") {
      const zhEn = due.filter((c) => c.cardType === "zh_en");
      const enZh = due.filter((c) => c.cardType === "en_zh");
      const interleaved: typeof due = [];
      const maxLen = Math.max(zhEn.length, enZh.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < zhEn.length) interleaved.push(zhEn[i]);
        if (i < enZh.length) interleaved.push(enZh[i]);
      }
      due = interleaved;
    }
    if (!settings.unlimitedReviews && settings.dailyReviewCap > 0) {
      due = due.slice(0, settings.dailyReviewCap);
    }
    return due;
  })();

  const uniqueWords = new Set(allCards.map((c) => c.word));
  const newWords    = allCards.filter((c) => c.state === 0 && c.cardType === "zh_en");
  const learningWords = allCards.filter((c) => c.state === 1 && c.cardType === "zh_en");
  const reviewWords = allCards.filter((c) => c.state === 2 && c.cardType === "zh_en");

  const handleToggleDeck = (id: string) => {
    setSelectedDeckIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleCreateDeck = async (name: string) => {
    await createDeck(name);
    await loadAll();
    toast.success(`Created deck "${name}"`);
  };

  const handleRenameDeck = async (id: string, name: string) => {
    await renameDeck(id, name);
    await loadAll();
    toast.success("Deck renamed");
  };

  const handleDeleteDeck = async (id: string) => {
    const deck = decks.find((d) => d.id === id);
    await deleteDeck(id);
    await loadAll();
    toast.success(`Deleted "${deck?.name ?? "deck"}"`);
  };

  // Persist session state after each card rating
  const handleSaveSession = useCallback(async (session: PersistedSession) => {
    const deckIds = Array.from(selectedDeckIds);
    await saveSession(deckIds, session, userId);
    setPersistedSession(session);
  }, [selectedDeckIds]);

  // Determine if we should auto-resume into the review screen:
  // - There is a persisted session for today
  // - The session is not yet done (or it's done but new cards appeared)
  const shouldAutoResume = sessionLoaded && persistedSession !== null && !persistedSession.isDone;

  // Auto-open review screen when a resumable session exists
  useEffect(() => {
    if (shouldAutoResume && !reviewing && !loading) {
      setReviewing(true);
    }
  }, [shouldAutoResume, reviewing, loading]);

  // Completed session: show "All done" screen if session is done and no new cards
  const sessionCompletedToday = sessionLoaded && persistedSession?.isDone === true && filteredDueCards.length === 0;

  if (reviewing) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={async () => {
            // Clear the session so the user can restart fresh if they exit mid-session
            await clearSession(Array.from(selectedDeckIds), userId);
            setPersistedSession(null);
            setReviewing(false);
            loadAll();
          }}>
            <X className="w-4 h-4 mr-1" /> Exit
          </Button>
          <h1 className="font-semibold text-foreground">Review Session</h1>
          {persistedSession && !persistedSession.isDone && persistedSession.reviewed > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">Resumed from {persistedSession.reviewed} reviewed</span>
          )}
        </div>
        <ReviewSession
          cards={filteredDueCards}
          allCards={allCards}
          settings={settings}
          deckIds={Array.from(selectedDeckIds)}
          initialSession={persistedSession}
          onSaveSession={handleSaveSession}
          onDone={async () => {
            setReviewing(false);
            await loadAll();
            // Reload the persisted session to reflect isDone=true
            const updated = await loadSession(Array.from(selectedDeckIds), userId);
            setPersistedSession(updated);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Flashcard Deck</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {uniqueWords.size} word{uniqueWords.size !== 1 ? "s" : ""} total
          </p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => {
          setNewWord(""); setNewPinyin(""); setNewDef(""); setLookupNotFound(false);
          setAddOpen(true);
        }}>
          <Plus className="w-4 h-4" /> Add Word
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-500">{newWords.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">New</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-amber-500">{learningWords.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Learning</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-emerald-500">{reviewWords.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Review</div>
          </CardContent>
        </Card>
      </div>

      {/* Deck toggle panel */}
      {!loading && (
        <DeckTogglePanel
          decks={decks}
          counts={deckCounts}
          selectedDeckIds={selectedDeckIds}
          onToggle={handleToggleDeck}
          onCreateDeck={handleCreateDeck}
          onRenameDeck={handleRenameDeck}
          onDeleteDeck={handleDeleteDeck}
        />
      )}

      {/* Start / resume review */}
      {loading || !sessionLoaded ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : sessionCompletedToday ? (
        // Session completed today — show "All done" until tomorrow's cards arrive
        <Card className="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-4 flex items-center gap-3">
            <Check className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">All done for today!</p>
              <p className="text-xs text-muted-foreground">
                You reviewed {persistedSession?.reviewed ?? 0} card{(persistedSession?.reviewed ?? 0) !== 1 ? "s" : ""} today. Come back tomorrow for more.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await clearSession(Array.from(selectedDeckIds), userId);
                setPersistedSession(null);
                await loadAll();
              }}
            >
              Reset
            </Button>
          </CardContent>
        </Card>
      ) : filteredDueCards.length > 0 ? (
        <Button
          size="lg"
          className="w-full gap-2"
          onClick={() => setReviewing(true)}
        >
          <Layers className="w-5 h-5" />
          {persistedSession && !persistedSession.isDone && persistedSession.reviewed > 0
            ? `Resume session — ${filteredDueCards.length} card${filteredDueCards.length !== 1 ? "s" : ""} left`
            : `Review ${filteredDueCards.length} card${filteredDueCards.length !== 1 ? "s" : ""} due today`}
        </Button>
      ) : (
        <Card className="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-4 flex items-center gap-3">
            <Check className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-sm text-foreground">
                {selectedDeckIds.size === 0 ? "No decks selected" : "All caught up!"}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedDeckIds.size === 0
                  ? "Select at least one deck above to start reviewing."
                  : "No cards due today. Come back tomorrow."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Word list */}
      {uniqueWords.size > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-foreground">All Words ({uniqueWords.size})</h2>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {Array.from(uniqueWords).map((word) => {
              const card = allCards.find((c) => c.word === word && c.cardType === "zh_en");
              if (!card) return null;
              return (
                <div key={word} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-foreground">{word}</span>
                    <span className="text-xs text-muted-foreground ml-2">{numericToTone(card.pinyin)}</span>
                    <p className="text-xs text-muted-foreground truncate">{card.definition}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <StateChip state={card.state} />
                    <button
                      onClick={async () => {
                        await removeWord(word);
                        loadAll();
                        toast.success(`Removed "${word}" from deck`);
                      }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {uniqueWords.size === 0 && !loading && (
        <div className="text-center py-12 space-y-3">
          <Layers className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="font-medium text-foreground">Your deck is empty</p>
          <p className="text-sm text-muted-foreground">Tap words while reading a story to add them here.</p>
          <Button variant="outline" asChild>
            <a href="/sessions"><BookOpen className="w-4 h-4 mr-1.5" />Browse stories</a>
          </Button>
        </div>
      )}

      {/* Add Word dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setNewWord(""); setNewPinyin(""); setNewDef(""); setLookupNotFound(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add word to deck</DialogTitle>
            <DialogDescription>Type a Chinese word and the pinyin and definition will be filled in automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Chinese word *</Label>
              <div className="relative">
                <Input
                  placeholder="e.g. 学习"
                  value={newWord}
                  onChange={(e) => handleAddWordChange(e.target.value)}
                  autoFocus
                />
                {lookingUp && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {lookupNotFound && !lookingUp && newWord.trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Not found in dictionary — fill in pinyin and definition manually.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Pinyin <span className="text-muted-foreground text-xs">(auto-filled)</span></Label>
              <Input
                placeholder="e.g. xué xí"
                value={newPinyin}
                onChange={(e) => setNewPinyin(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Definition <span className="text-muted-foreground text-xs">(auto-filled)</span></Label>
              <Input
                placeholder="e.g. to study, to learn"
                value={newDef}
                onChange={(e) => setNewDef(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddWordSubmit} disabled={!newWord.trim() || lookingUp}>Add word</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StateChip({ state }: { state: number }) {
  const labels: Record<number, { label: string; color: string }> = {
    0: { label: "New",     color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    1: { label: "Learning",color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    2: { label: "Review",  color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
    3: { label: "Relearn", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  };
  const { label, color } = labels[state] ?? labels[0];
  return <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", color)}>{label}</span>;
}
