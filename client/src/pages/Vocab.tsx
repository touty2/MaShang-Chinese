import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Search, Volume2, Plus, Trash2, BookmarkPlus, BookmarkCheck, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { loadStories, getUniqueVocab, type StoryVocab } from "@/lib/stories";
import { addWord, removeWord, getAllCards } from "@/lib/flashcardStore";
import { loadDictionary, lookupWord } from "@/lib/dictionary";
import {
  getAllDecks, addWordToDeck, getDeckCounts, type LocalDeck,
  MAIN_DECK_ID, MY_VOCAB_ID
} from "@/lib/deckStore";
import { cn } from "@/lib/utils";
import { numericToTone } from "@/lib/pinyin";

const MY_WORDS_KEY = "mashang_my_words";

interface MyWord {
  word: string;
  pinyin: string;
  definition: string;
  addedAt: number;
}

function getMyWords(): MyWord[] {
  try { return JSON.parse(localStorage.getItem(MY_WORDS_KEY) || "[]"); } catch { return []; }
}
function saveMyWords(words: MyWord[]) {
  localStorage.setItem(MY_WORDS_KEY, JSON.stringify(words));
}

function speak(text: string, speed = 1.0) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "zh-CN";
  utt.rate = speed;
  window.speechSynthesis.speak(utt);
}

const BAND_COLORS: Record<string, string> = {
  "HSK 3-I":  "bg-green-100 text-green-700",
  "HSK 3-II": "bg-green-100 text-green-700",
  "HSK 4-I":  "bg-blue-100 text-blue-700",
  "HSK 4-II": "bg-blue-100 text-blue-700",
  "HSK 5-I":  "bg-purple-100 text-purple-700",
  "HSK 5-II": "bg-purple-100 text-purple-700",
};

type SortKey = "word" | "pinyin" | "hsk";

function VocabTable({
  words,
  deckWords,
  onAdd,
  onRemove,
  onDelete,
  showHsk = true,
  showDelete = false,
}: {
  words: (StoryVocab & { hskBand?: string })[];
  deckWords: Set<string>;
  onAdd: (v: StoryVocab & { hskBand?: string }) => void;
  onRemove: (v: StoryVocab & { hskBand?: string }) => void;
  onDelete?: (word: string) => void;
  showHsk?: boolean;
  showDelete?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      {words.map((v) => (
        <div
          key={v.word}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group"
        >
          <button
            onClick={() => speak(v.word)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr] gap-x-3 items-baseline">
            <span className="font-medium text-sm text-foreground">{v.word}</span>
            <span className="text-xs text-muted-foreground truncate">{numericToTone(v.pinyin)} — {v.definition}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {showHsk && v.hskBand && (
              <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", BAND_COLORS[v.hskBand] ?? "bg-muted text-muted-foreground")}>
                {v.hskBand}
              </span>
            )}
            <button
              onClick={() => deckWords.has(v.word) ? onRemove(v) : onAdd(v)}
              className={cn(
                "p-1 rounded transition-colors",
                deckWords.has(v.word)
                  ? "text-primary hover:text-destructive"
                  : "text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100"
              )}
              title={deckWords.has(v.word) ? "Remove from deck" : "Add to deck"}
            >
              {deckWords.has(v.word) ? <BookmarkCheck className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
            </button>
            {showDelete && onDelete && (
              <button
                onClick={() => onDelete(v.word)}
                className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Vocab() {
  const [allVocab, setAllVocab] = useState<(StoryVocab & { hskBand?: string })[]>([]);
  const [myWords, setMyWords] = useState<MyWord[]>(getMyWords());
  const [deckWords, setDeckWords] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("word");

  // Add dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [newPinyin, setNewPinyin] = useState("");
  const [newDef, setNewDef] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set([MAIN_DECK_ID]));
  const [availableDecks, setAvailableDecks] = useState<LocalDeck[]>([]);
  const lookupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      // Load dictionary in parallel so it's ready when the user opens Add Word
      const [stories, cards, decks] = await Promise.all([
        loadStories(),
        getAllCards(),
        getAllDecks(),
        loadDictionary(),
      ]);
      const vocab = getUniqueVocab(stories);
      setAllVocab(vocab);
      setDeckWords(new Set(cards.map((c) => c.word)));
      setAvailableDecks(decks);
      setLoading(false);
    }
    load();
  }, []);

  // Auto-fill pinyin + definition when word changes
  const handleWordChange = useCallback(async (value: string) => {
    setNewWord(value);
    setLookupNotFound(false);
    if (!value.trim()) {
      // Clear all fields when word box is cleared
      setNewPinyin("");
      setNewDef("");
      if (lookupTimeout.current) clearTimeout(lookupTimeout.current);
      return;
    }
    if (lookupTimeout.current) clearTimeout(lookupTimeout.current);
    lookupTimeout.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        // Ensure dictionary is loaded before lookup (may already be loaded)
        await loadDictionary();
        const entry = await lookupWord(value.trim());
        if (entry) {
          setNewPinyin(numericToTone(entry.pinyinDisplay || entry.pinyin));
          setNewDef(entry.definitions.slice(0, 3).join("; "));
          setLookupNotFound(false);
        } else {
          // Word not found — clear auto-filled values and let user type manually
          setNewPinyin("");
          setNewDef("");
          setLookupNotFound(true);
        }
      } finally {
        setLookingUp(false);
      }
    }, 350);
  }, []);

  const handleToggleDeck = (id: string) => {
    setSelectedDeckIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const filtered = useMemo(() => {
    let list = allVocab;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (v) => v.word.includes(search) || v.pinyin.toLowerCase().includes(q) || v.definition.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sort === "word")   return a.word.localeCompare(b.word, "zh");
      if (sort === "pinyin") return a.pinyin.localeCompare(b.pinyin);
      if (sort === "hsk")    return (a.hskBand ?? "").localeCompare(b.hskBand ?? "");
      return 0;
    });
  }, [allVocab, search, sort]);

  const filteredMyWords = useMemo(() => {
    if (!search) return myWords;
    const q = search.toLowerCase();
    return myWords.filter(
      (w) => w.word.includes(search) || w.pinyin.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q)
    );
  }, [myWords, search]);

  const handleAdd = useCallback(async (v: StoryVocab & { hskBand?: string }) => {
    await addWord(v.word, v.pinyin, v.definition, v.hskBand ?? "");
    // Add to Main Deck by default for story vocab
    await addWordToDeck(MAIN_DECK_ID, v.word);
    setDeckWords((prev) => { const n = new Set(prev); n.add(v.word); return n; });
    toast.success(`Added "${v.word}" to deck`);
  }, []);

  const handleRemove = useCallback(async (v: StoryVocab & { hskBand?: string }) => {
    await removeWord(v.word);
    setDeckWords((prev) => { const n = new Set(prev); n.delete(v.word); return n; });
    toast.success(`Removed "${v.word}" from deck`);
  }, []);

  const handleAddMyWord = useCallback(async () => {
    if (!newWord.trim()) return;
    const word: MyWord = {
      word: newWord.trim(),
      pinyin: newPinyin.trim(),
      definition: newDef.trim(),
      addedAt: Date.now(),
    };
    const updated = [word, ...myWords.filter((w) => w.word !== word.word)];
    setMyWords(updated);
    saveMyWords(updated);

    // Add to flashcard store
    await addWord(word.word, word.pinyin, word.definition, "Custom");

    // Add to selected decks (default: My Words)
    const decksToAdd = selectedDeckIds.size > 0 ? Array.from(selectedDeckIds) : [MY_VOCAB_ID];
    for (const deckId of decksToAdd) {
      await addWordToDeck(deckId, word.word);
    }

    setDeckWords((prev) => { const n = new Set(prev); n.add(word.word); return n; });
    setAddDialogOpen(false);
    setNewWord(""); setNewPinyin(""); setNewDef("");
    setSelectedDeckIds(new Set([MY_VOCAB_ID]));
    toast.success(`Added "${word.word}" to My Words`);
  }, [newWord, newPinyin, newDef, myWords, selectedDeckIds]);

  const handleDeleteMyWord = useCallback(async (word: string) => {
    const updated = myWords.filter((w) => w.word !== word);
    setMyWords(updated);
    saveMyWords(updated);
    await removeWord(word);
    setDeckWords((prev) => { const n = new Set(prev); n.delete(word); return n; });
    toast.success(`Removed "${word}"`);
  }, [myWords]);

  const openAddDialog = () => {
    setNewWord(""); setNewPinyin(""); setNewDef("");
    setSelectedDeckIds(new Set([MY_VOCAB_ID]));
    setAddDialogOpen(true);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Vocabulary</h1>
        <p className="text-muted-foreground text-sm mt-1">{allVocab.length} unique words from 118 stories</p>
      </div>

      {/* Search + sort */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search words, pinyin, or definitions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="word">By character</SelectItem>
            <SelectItem value="pinyin">By pinyin</SelectItem>
            <SelectItem value="hsk">By HSK band</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">
            All Words
            <Badge variant="secondary" className="ml-2 text-xs">{filtered.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="my">
            My Words
            <Badge variant="secondary" className="ml-2 text-xs">{filteredMyWords.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No words match your search.</p>
          ) : (
            <VocabTable
              words={filtered}
              deckWords={deckWords}
              onAdd={handleAdd}
              onRemove={handleRemove}
            />
          )}
        </TabsContent>

        <TabsContent value="my" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={openAddDialog} className="gap-1.5">
              <Plus className="w-4 h-4" />
              Add word
            </Button>
          </div>
          {filteredMyWords.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <p className="text-muted-foreground text-sm">No custom words yet.</p>
              <p className="text-xs text-muted-foreground">Add words you want to study that aren't in the stories.</p>
            </div>
          ) : (
            <VocabTable
              words={filteredMyWords}
              deckWords={deckWords}
              onAdd={handleAdd}
              onRemove={handleRemove}
              onDelete={handleDeleteMyWord}
              showHsk={false}
              showDelete
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Add word dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add custom word</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Chinese word *</Label>
              <div className="relative">
                <Input
                  placeholder="e.g. 学习"
                  value={newWord}
                  onChange={(e) => handleWordChange(e.target.value)}
                  autoFocus
                />
                {lookingUp && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {lookupNotFound && !lookingUp && newWord.trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Not found in dictionary — you can fill in pinyin and definition manually.
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

            {/* Deck selector */}
            {availableDecks.length > 0 && (
              <div className="space-y-1.5">
                <Label>Add to deck(s)</Label>
                <div className="space-y-1.5 max-h-36 overflow-y-auto border rounded-md p-2">
                  {availableDecks.map((deck) => (
                    <div key={deck.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`add-deck-${deck.id}`}
                        checked={selectedDeckIds.has(deck.id)}
                        onCheckedChange={() => handleToggleDeck(deck.id)}
                      />
                      <Label htmlFor={`add-deck-${deck.id}`} className="text-sm cursor-pointer">
                        {deck.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddMyWord} disabled={!newWord.trim()}>Add word</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
