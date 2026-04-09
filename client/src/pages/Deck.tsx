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
  getAllCards, getDueCards, rateCard, removeWord,
  getIntervalLabel, Rating, State, type FlashCard
} from "@/lib/flashcardStore";
import {
  getAllDecks, createDeck, renameDeck, deleteDeck,
  getWordsInDeck, getDeckCounts, type LocalDeck,
  MAIN_DECK_ID, MY_VOCAB_ID
} from "@/lib/deckStore";
import { useSettings } from "@/contexts/SettingsContext";
import { cn } from "@/lib/utils";
import { addWord } from "@/lib/flashcardStore";
import { addWordToDeck } from "@/lib/deckStore";
import { loadDictionary, lookupWord } from "@/lib/dictionary";

// ─── Review Session ───────────────────────────────────────────────────────────

function ReviewSession({
  cards,
  settings,
  onDone,
}: {
  cards: FlashCard[];
  settings: ReturnType<typeof useSettings>["settings"];
  onDone: (reviewed: number) => void;
}) {
  // Shuffle once using a stable ref.
  // Uses an anti-adjacency shuffle: after a standard Fisher-Yates shuffle,
  // if two consecutive cards share the same word, swap the second one with
  // a later card to prevent the same word appearing back-to-back.
  const initialQueue = useRef<FlashCard[]>((() => {
    const shuffled = [...cards];
    // Fisher-Yates
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Anti-adjacency pass: move same-word neighbours apart
    for (let i = 0; i < shuffled.length - 1; i++) {
      if (shuffled[i].word === shuffled[i + 1].word) {
        // Find the next card with a different word to swap with
        const swapIdx = shuffled.findIndex((c, k) => k > i + 1 && c.word !== shuffled[i].word);
        if (swapIdx !== -1) {
          [shuffled[i + 1], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[i + 1]];
        }
      }
    }
    return shuffled;
  })());
  const [queue, setQueue] = useState<FlashCard[]>(initialQueue.current);
  // current always tracks queue[0]
  const [current, setCurrent] = useState<FlashCard | null>(initialQueue.current[0] ?? null);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [largeFontMode, setLargeFontMode] = useState(false);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "zh-CN";
    utt.rate = settings.ttsSpeed;
    window.speechSynthesis.speak(utt);
  }, [settings.ttsSpeed]);

  // Two-way flip toggle — click to flip, click again to flip back
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
    await rateCard(current, rating, settings.desiredRetention, settings.maxInterval);
    const newReviewed = reviewed + 1;
    setReviewed(newReviewed);
    const remaining = queue.slice(1);
    if (remaining.length === 0) {
      setSessionDone(true);
      onDone(newReviewed);
    } else {
      setQueue(remaining);
      setCurrent(remaining[0]);
      setFlipped(false);
    }
  }, [current, queue, reviewed, settings, onDone]);

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
              <p className="text-primary text-lg font-medium tracking-wide">{current.pinyin}</p>
            </div>
            <div className="px-8 py-5 overflow-y-auto max-h-48">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">DEFINITION</p>
              <p className={cn("text-foreground", defSize)}>{current.definition}</p>
            </div>
          </div>

        </div>
      </div>

      {/* Controls row: I Know + speaker + speed */}
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

  const handleCreate = () => {
    if (!newDeckName.trim()) return;
    onCreateDeck(newDeckName.trim());
    setNewDeckName("");
    setCreating(false);
  };

  const totalSelected = Array.from(selectedDeckIds).reduce((sum, id) => sum + (counts[id] ?? 0), 0);

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors rounded-xl"
      >
        <span className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          Decks
          <Badge variant="secondary" className="text-xs">{selectedDeckIds.size} selected · {totalSelected} words</Badge>
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-2">
          {decks.map((deck) => (
            <div key={deck.id} className="flex items-center gap-2 group">
              <Checkbox
                id={`deck-${deck.id}`}
                checked={selectedDeckIds.has(deck.id)}
                onCheckedChange={() => onToggle(deck.id)}
              />
              <Label
                htmlFor={`deck-${deck.id}`}
                className="flex-1 text-sm cursor-pointer flex items-center gap-2"
              >
                <span className="flex flex-col">
                  <span>{deck.name}</span>
                  {deck.id === MAIN_DECK_ID && (
                    <span className="text-xs text-muted-foreground font-normal">Words from stories</span>
                  )}
                  {deck.id === MY_VOCAB_ID && (
                    <span className="text-xs text-muted-foreground font-normal">Manually added words</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">({counts[deck.id] ?? 0})</span>
              </Label>
              {!deck.isSystem && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setRenaming({ id: deck.id, name: deck.name })}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleting(deck)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Create new deck */}
          {creating ? (
            <div className="flex gap-2 pt-1">
              <Input
                autoFocus
                placeholder="Deck name…"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={handleCreate} disabled={!newDeckName.trim()} className="h-8 px-3">
                <Check className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)} className="h-8 px-2">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
            >
              <Plus className="w-3.5 h-3.5" /> New deck
            </button>
          )}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(o) => { if (!o) setRenaming(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename deck</DialogTitle></DialogHeader>
          <Input
            value={renaming?.name ?? ""}
            onChange={(e) => setRenaming((r) => r ? { ...r, name: e.target.value } : null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renaming?.name.trim()) {
                onRenameDeck(renaming.id, renaming.name);
                setRenaming(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button
              disabled={!renaming?.name.trim()}
              onClick={() => { if (renaming) { onRenameDeck(renaming.id, renaming.name); setRenaming(null); } }}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the deck and all its word assignments. The words themselves and their SRS progress will not be deleted.
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
  const [allCards, setAllCards] = useState<FlashCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [decks, setDecks] = useState<LocalDeck[]>([]);
  const [deckCounts, setDeckCounts] = useState<Record<string, number>>({});
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set([MAIN_DECK_ID, MY_VOCAB_ID]));
  const [deckWordSets, setDeckWordSets] = useState<Record<string, Set<string>>>({});

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
          setNewPinyin(entry.pinyinDisplay || entry.pinyin);
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

    // Build word sets per deck
    const sets: Record<string, Set<string>> = {};
    for (const deck of allDecks) {
      const words = await getWordsInDeck(deck.id);
      sets[deck.id] = new Set(words);
    }
    setDeckWordSets(sets);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

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
  // Main Deck is a catch-all: it includes ALL cards in the flashcard store
  const filteredDueCards = (() => {
    if (selectedDeckIds.size === 0) return [];
    const now = Date.now();
    const mainSelected = selectedDeckIds.has(MAIN_DECK_ID);
    const allowedWords = new Set<string>();

    if (mainSelected) {
      // Main Deck = words added from stories
      Array.from(deckWordSets[MAIN_DECK_ID] ?? []).forEach((w) => allowedWords.add(w));
    }
    // Add words from other selected decks (including My Words)
    Array.from(selectedDeckIds).forEach((id) => {
      if (id === MAIN_DECK_ID) return;
      Array.from(deckWordSets[id] ?? []).forEach((w) => allowedWords.add(w));
    });

    // Always default to zh_en direction; only use en_zh or mixed if explicitly set
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
    // In mixed mode, interleave zh_en and en_zh so the same word never appears
    // back-to-back. Dedupe by word within each direction bucket then interleave.
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

  if (reviewing) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => { setReviewing(false); loadAll(); }}>
            <X className="w-4 h-4 mr-1" /> Exit
          </Button>
          <h1 className="font-semibold text-foreground">Review Session</h1>
        </div>
        <ReviewSession
          cards={filteredDueCards}
          settings={settings}
          onDone={() => { setReviewing(false); loadAll(); }}
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

      {/* Start review */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : filteredDueCards.length > 0 ? (
        <Button size="lg" className="w-full gap-2" onClick={() => setReviewing(true)}>
          <Layers className="w-5 h-5" />
          Review {filteredDueCards.length} card{filteredDueCards.length !== 1 ? "s" : ""} due today
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
                    <span className="text-xs text-muted-foreground ml-2">{card.pinyin}</span>
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
