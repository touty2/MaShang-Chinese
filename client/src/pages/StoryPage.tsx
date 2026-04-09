import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useParams, useLocation, Link } from "wouter";
import {
  ArrowLeft, BookmarkPlus, BookmarkCheck, Volume2, ChevronDown, ChevronUp,
  CheckCircle2, Play, Pause, X, Plus, Minus, Loader2, Scissors, GitMerge
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { loadStories, type Story, type StoryVocab } from "@/lib/stories";
import { loadDictionary, lookupWord, type DictEntry } from "@/lib/dictionary";
import { addWord, removeWord, hasWord } from "@/lib/flashcardStore";
import { addWordToDeck, MAIN_DECK_ID } from "@/lib/deckStore";
import { trpc } from "@/lib/trpc";
import { useSettings } from "@/contexts/SettingsContext";
import { cn } from "@/lib/utils";

// ─── Segmentation Override Store (localStorage) ───────────────────────────────
const SEG_OVERRIDES_KEY = "mashang_seg_overrides";

type SegOverrideMap = Record<number, Record<string, string>>; // storyId → { originalToken → newToken }

function loadSegOverrides(): SegOverrideMap {
  try { return JSON.parse(localStorage.getItem(SEG_OVERRIDES_KEY) || "{}"); } catch { return {}; }
}
function saveSegOverrides(map: SegOverrideMap) {
  localStorage.setItem(SEG_OVERRIDES_KEY, JSON.stringify(map));
}
function applyOverrides(tokens: string[], overrides: Record<string, string>): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (overrides[token]) {
      // Replace with the overridden segmentation: split the override into chars and re-segment
      const newToken = overrides[token];
      result.push(newToken);
    } else {
      result.push(token);
    }
    i++;
  }
  return result;
}

const COMPLETED_KEY = "mashang_completed";

function getCompleted(): number[] {
  try { return JSON.parse(localStorage.getItem(COMPLETED_KEY) || "[]"); } catch { return []; }
}
function setCompleted(ids: number[]) {
  localStorage.setItem(COMPLETED_KEY, JSON.stringify(ids));
}

// ─── Anchor-positioned Word Popup ────────────────────────────────────────────

interface WordPopupProps {
  word: string;
  entry: DictEntry | null;
  storyDef?: { pinyin: string; definition: string } | null; // from story vocab list
  inDeck: boolean;
  anchor: DOMRect;
  onAdd: () => void;
  onRemove: () => void;
  onClose: () => void;
  onSpeak: (text: string) => void;
  /** Surrounding characters for segmentation editing (the raw token + neighbours) */
  contextChars?: string;
  onSegmentationChange?: (newWord: string) => void;
}

function WordPopup({ word, entry, storyDef, inDeck, anchor, onAdd, onRemove, onClose, onSpeak, contextChars, onSegmentationChange }: WordPopupProps) {
  // Merge: story vocab definition takes priority; cedict fills in pinyin if missing
  const displayPinyin = storyDef?.pinyin || entry?.pinyinDisplay || entry?.pinyin || "";
  const displayDefs: string[] = storyDef?.definition
    ? [storyDef.definition, ...(entry?.definitions.filter(d => d.toLowerCase() !== storyDef.definition.toLowerCase()) ?? []).slice(0, 3)]
    : (entry?.definitions ?? []).slice(0, 4);
  const popupWidth = 320;
  const popupRef = useRef<HTMLDivElement>(null);

  // Segmentation editor state
  const [segOpen, setSegOpen] = useState(false);
  // Build editable char array from contextChars (default to word itself)
  const allChars = contextChars || word;
  const [boundaries, setBoundaries] = useState<boolean[]>(() => {
    // Default: boundaries that reproduce the original word within contextChars
    const arr = Array(allChars.length - 1).fill(false);
    if (contextChars) {
      const idx = contextChars.indexOf(word);
      if (idx >= 0) {
        if (idx > 0) arr[idx - 1] = true;
        if (idx + word.length - 1 < arr.length) arr[idx + word.length - 1] = true;
      }
    }
    return arr;
  });

  const toggleBoundary = (i: number) => {
    setBoundaries((prev: boolean[]) => { const n = [...prev]; n[i] = !n[i]; return n; });
  };

  // Derive the "current word" from boundaries: find the segment containing the original word
  const getSegments = (chars: string, bounds: boolean[]) => {
    const segs: string[] = [];
    let cur = "";
    for (let i = 0; i < chars.length; i++) {
      cur += chars[i];
      if (i < bounds.length && bounds[i]) { segs.push(cur); cur = ""; }
    }
    if (cur) segs.push(cur);
    return segs;
  };

  const segments = getSegments(allChars, boundaries);
  // The segment that contains the original word (or the first one)
  const activeSegment = segments.find((s) => s.includes(word)) || segments[0] || word;

  // Compute horizontal position: centre on word, clamp to viewport
  const vw = window.innerWidth;
  let left = anchor.left + anchor.width / 2 - popupWidth / 2;
  left = Math.max(8, Math.min(left, vw - popupWidth - 8));

  // Decide above or below: prefer above if there's ≥200px above, else below
  const spaceAbove = anchor.top;
  const showAbove = spaceAbove >= 200;
  const top = showAbove ? anchor.top - 8 : anchor.bottom + 8;

  return (
    <div
      ref={popupRef}
      className="fixed z-50"
      style={{
        width: popupWidth,
        left,
        top,
        transform: showAbove ? "translateY(-100%)" : "none",
      }}
    >
      {/* Arrow */}
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-card border-border",
          showAbove
            ? "bottom-[-6px] border-b border-r"
            : "top-[-6px] border-t border-l"
        )}
        style={{ left: Math.min(Math.max(anchor.left + anchor.width / 2 - left, 16), popupWidth - 16) }}
      />
      <Card className="shadow-xl border border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-2xl font-bold text-foreground">{word}</span>
                <button
                  onClick={() => onSpeak(word)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title="Pronounce"
                >
                  <Volume2 className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              {displayPinyin && (
                <p className="text-sm text-muted-foreground mt-0.5 italic">{displayPinyin}</p>
              )}
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors flex-shrink-0">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {displayDefs.length > 0 ? (
            <div className="space-y-1">
              {displayDefs.map((def, i) => (
                <p key={i} className="text-sm text-foreground leading-relaxed">
                  {displayDefs.length > 1 ? `${i + 1}. ` : ""}{def}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No dictionary entry found.</p>
          )}

          <div className="space-y-2 pt-1">
            {/* Add / Remove deck button */}
            <div className="flex gap-2">
              {inDeck ? (
                <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={onRemove}>
                  <Minus className="w-3.5 h-3.5" />
                  Remove from deck
                </Button>
              ) : (
                <Button size="sm" className="flex-1 gap-1.5" onClick={onAdd}>
                  <Plus className="w-3.5 h-3.5" />
                  Add to deck
                </Button>
              )}
            </div>

            {/* Segmentation editor toggle */}
            <button
              onClick={() => setSegOpen((v: boolean) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <Scissors className="w-3 h-3" />
              <span>Adjust word boundary</span>
              <ChevronDown className={cn("w-3 h-3 ml-auto transition-transform", segOpen && "rotate-180")} />
            </button>

            {/* Segmentation editor panel */}
            {segOpen && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                  Click • between characters to split or merge
                </p>
                <div className="flex items-center flex-wrap gap-0.5 font-medium text-base">
                  {allChars.split("").map((ch, i) => (
                    <span key={i} className="inline-flex items-center">
                      <span
                        className={cn(
                          "seg-char text-foreground px-1 py-0.5 rounded",
                          segments.find((s) => s.includes(ch) && s === activeSegment) && "bg-primary/10 text-primary"
                        )}
                      >
                        {ch}
                      </span>
                      {i < allChars.length - 1 && (
                        <button
                          onClick={() => toggleBoundary(i)}
                          className={cn(
                            "seg-boundary text-[10px] w-4 h-5 flex items-center justify-center rounded hover:bg-primary/10",
                            boundaries[i] && "active font-bold"
                          )}
                          title={boundaries[i] ? "Remove split" : "Split here"}
                        >
                          {boundaries[i] ? "|" : "·"}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Word:</span>
                  <span className="text-sm font-semibold text-primary">{activeSegment}</span>
                  {activeSegment !== word && (
                    <button
                      onClick={() => onSegmentationChange?.(activeSegment)}
                      className="ml-auto flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2 py-1 rounded-md hover:opacity-90 transition-opacity"
                    >
                      <GitMerge className="w-3 h-3" /> Apply
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TTS Controller ───────────────────────────────────────────────────────────

function useTTS(settings: ReturnType<typeof useSettings>["settings"]) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState(-1);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setActiveSentenceIdx(-1);
  }, []);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "zh-CN";
    utt.rate = settings.ttsSpeed;
    if (settings.ttsVoiceURI) {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((v) => v.voiceURI === settings.ttsVoiceURI);
      if (voice) utt.voice = voice;
    }
    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
  }, [settings.ttsSpeed, settings.ttsVoiceURI]);

  const playSentences = useCallback((sentences: string[], startIdx = 0) => {
    if (!window.speechSynthesis || sentences.length === 0) return;
    setIsPlaying(true);
    let idx = startIdx;

    function playNext() {
      if (idx >= sentences.length) {
        setIsPlaying(false);
        setActiveSentenceIdx(-1);
        return;
      }
      setActiveSentenceIdx(idx);
      const utt = new SpeechSynthesisUtterance(sentences[idx]);
      utt.lang = "zh-CN";
      utt.rate = settings.ttsSpeed;
      if (settings.ttsVoiceURI) {
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find((v) => v.voiceURI === settings.ttsVoiceURI);
        if (voice) utt.voice = voice;
      }
      utt.onend = () => { idx++; playNext(); };
      utteranceRef.current = utt;
      window.speechSynthesis.speak(utt);
    }
    playNext();
  }, [settings.ttsSpeed, settings.ttsVoiceURI]);

  return { isPlaying, activeSentenceIdx, speak, playSentences, stop };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StoryPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { settings } = useSettings();
  const storyId = parseInt(params.id || "0", 10);

  const [story, setStory] = useState<Story | null>(null);
  const [tokens, setTokens] = useState<string[]>([]);
  const [sentences, setSentences] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dictLoading, setDictLoading] = useState(true);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedWordIdx, setSelectedWordIdx] = useState<number>(-1);
  const [selectedEntry, setSelectedEntry] = useState<DictEntry | null>(null);
  const [segOverrides, setSegOverrides] = useState<Record<string, string>>({});
  const [selectedStoryDef, setSelectedStoryDef] = useState<{ pinyin: string; definition: string } | null>(null);
  const [wordInDeck, setWordInDeck] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [deckWords, setDeckWords] = useState<Set<string>>(new Set());

  const tts = useTTS(settings);
  const utils = trpc.useUtils();

  // Load segmentation overrides for this story from localStorage
  useEffect(() => {
    const allOverrides = loadSegOverrides();
    setSegOverrides(allOverrides[storyId] || {});
  }, [storyId]);

  // Segmentation: use pre-segmented tokens from story file if available,
  // otherwise fall back to the server segmentation endpoint.
  const segQuery = trpc.stories.segmentStory.useQuery(
    { chineseText: story?.chineseText || "" },
    { enabled: !!story?.chineseText && !story?.segmentedText, staleTime: Infinity }
  );

  useEffect(() => {
    async function load() {
      const stories = await loadStories();
      const found = stories.find((s) => s.number === storyId);
      if (!found) { navigate("/sessions"); return; }
      setStory(found);
      const sents = found.chineseText.split(/[。！？；\n]+/).filter(Boolean);
      setSentences(sents);
      setIsCompleted(getCompleted().includes(storyId));
      // Use pre-segmented tokens from the story file immediately
      if (found.segmentedText && found.segmentedText.length > 0) {
        const allOverrides = loadSegOverrides();
        const overrides = allOverrides[storyId] || {};
        setTokens(applyOverrides(found.segmentedText, overrides));
      }
      setLoading(false);
    }
    load();
  }, [storyId]);

  useEffect(() => {
    // Only use server segmentation if story doesn't have pre-segmented tokens
    if (segQuery.data && !story?.segmentedText) {
      const allOverrides = loadSegOverrides();
      const overrides = allOverrides[storyId] || {};
      setTokens(applyOverrides(segQuery.data.tokens, overrides));
    }
  }, [segQuery.data, story?.segmentedText, storyId]);

  useEffect(() => {
    loadDictionary((pct) => { if (pct >= 100) setDictLoading(false); });
  }, []);

  useEffect(() => {
    if (!story) return;
    async function loadDeckWords() {
      const { getAllCards } = await import("@/lib/flashcardStore");
      const cards = await getAllCards();
      setDeckWords(new Set(cards.map((c) => c.word)));
    }
    loadDeckWords();
  }, [story]);

  const handleWordClick = useCallback(async (
    word: string,
    e: React.MouseEvent<HTMLSpanElement>,
    tokenIdx: number
  ) => {
    if (!/[\u4e00-\u9fff]/.test(word)) return;
    // If clicking the same word, close the popup
    if (selectedWord === word && selectedWordIdx === tokenIdx) {
      setSelectedWord(null);
      setAnchorRect(null);
      setSelectedWordIdx(-1);
      return;
    }
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setSelectedWord(word);
    setSelectedWordIdx(tokenIdx);
    setSelectedEntry(null); // clear while loading
    setSelectedStoryDef(null);
    // Check story vocabulary first (clean, learner-friendly definitions)
    if (story) {
      const vocabMatch = story.vocabulary.find((v) => v.word === word);
      if (vocabMatch) {
        setSelectedStoryDef({ pinyin: vocabMatch.pinyin, definition: vocabMatch.definition });
      }
    }
    const entry = await lookupWord(word);
    setSelectedEntry(entry);
    const inDeck = await hasWord(word);
    setWordInDeck(inDeck);
    if (settings.playAudioOnFlip) tts.speak(word);
  }, [selectedWord, selectedWordIdx, story, settings.playAudioOnFlip, tts]);

  const handleSegmentationChange = useCallback(async (originalToken: string, newToken: string) => {
    if (originalToken === newToken) return;
    // Update local override map
    const allOverrides = loadSegOverrides();
    const storyOverrides = { ...(allOverrides[storyId] || {}), [originalToken]: newToken };
    allOverrides[storyId] = storyOverrides;
    saveSegOverrides(allOverrides);
    setSegOverrides(storyOverrides);
    // Apply to current token list immediately
    setTokens((prev) => applyOverrides(prev, { [originalToken]: newToken }));
    // Close popup
    setSelectedWord(null);
    setAnchorRect(null);
    setSelectedWordIdx(-1);
    toast.success(`Segmentation updated: "${originalToken}" → "${newToken}"`);
    // Persist to server (non-blocking)
    try {
      await utils.client.sync.pushSegmentationOverrides.mutate([
        { storyId, overridesJson: JSON.stringify(storyOverrides), updatedAt: Date.now() }
      ]);
    } catch { /* non-fatal */ }
  }, [storyId, utils]);

  const handleAddToDeck = useCallback(async () => {
    if (!selectedWord || !story) return;
    const vocab = story.vocabulary.find((v) => v.word === selectedWord);
    const pinyin = vocab?.pinyin || selectedEntry?.pinyin || "";
    const definition = vocab?.definition || selectedEntry?.definitions.join("; ") || "";
    await addWord(selectedWord, pinyin, definition, story.hskBand, story.number);
    await addWordToDeck(MAIN_DECK_ID, selectedWord);
    setWordInDeck(true);
    setDeckWords((prev) => { const n = new Set(prev); n.add(selectedWord!); return n; });
    toast.success(`Added "${selectedWord}" to deck`);
  }, [selectedWord, story, selectedEntry]);

  const handleRemoveFromDeck = useCallback(async () => {
    if (!selectedWord) return;
    await removeWord(selectedWord);
    setWordInDeck(false);
    setDeckWords((prev) => { const n = new Set(prev); n.delete(selectedWord!); return n; });
    toast.success(`Removed "${selectedWord}" from deck`);
  }, [selectedWord]);

  const handleMarkComplete = useCallback(() => {
    const completed = getCompleted();
    if (!completed.includes(storyId)) {
      setCompleted([...completed, storyId]);
      setIsCompleted(true);
      toast.success("Story marked as complete!");
    }
  }, [storyId]);

  // Click outside popup closes it
  useEffect(() => {
    if (!selectedWord) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking another word-span (handleWordClick will handle it)
      if (target.classList.contains("word-span")) return;
      // Don't close if clicking inside the popup card
      const popup = document.getElementById("word-popup-card");
      if (popup && popup.contains(target)) return;
      setSelectedWord(null);
      setAnchorRect(null);
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [selectedWord]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!story) return null;

  // Render segmented text
  const renderText = () => {
    if (segQuery.isLoading || tokens.length === 0) {
      return (
        <p className="reading-text">
          {story.chineseText.split("").map((ch, i) =>
            /[\u4e00-\u9fff]/.test(ch) ? (
              <span
                key={i}
                className={cn("word-span", deckWords.has(ch) && "in-deck", selectedWord === ch && "active-word")}
                onClick={(e) => handleWordClick(ch, e, i)}
              >
                {ch}
              </span>
            ) : (
              <span key={i}>{ch}</span>
            )
          )}
        </p>
      );
    }

    return (
      <p className="reading-text leading-loose">
        {tokens.map((token, i) => {
          const isChinese = /[\u4e00-\u9fff]/.test(token);
          if (!isChinese) return <span key={i}>{token}</span>;
          return (
            <span
              key={i}
              className={cn(
                "word-span",
                deckWords.has(token) && "in-deck",
                selectedWord === token && "active-word"
              )}
              onClick={(e) => handleWordClick(token, e, i)}
            >
              {token}
            </span>
          );
        })}
      </p>
    );
  };

  const bgClass = settings.readingBackground !== "white"
    ? `reading-bg-${settings.readingBackground}`
    : "";

  return (
    <div className={cn("min-h-screen bg-background", bgClass)}>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/sessions">
            <button className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm text-foreground truncate">{story.chineseTitle || story.title}</h1>
            <p className="text-xs text-muted-foreground">{story.hskBand}</p>
          </div>
          <div className="flex items-center gap-1">
            {tts.isPlaying ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={tts.stop}>
                    <Pause className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop audio</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={() => tts.playSentences(sentences)}>
                    <Play className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Play story</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkComplete}
                  className={isCompleted ? "text-emerald-500" : ""}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isCompleted ? "Completed" : "Mark as complete"}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{story.hskBand}</Badge>
            {isCompleted && <Badge variant="outline" className="text-emerald-600 border-emerald-300">Completed</Badge>}
          </div>
          <h2 className="text-xl font-bold text-foreground">{story.chineseTitle || story.title}</h2>
          {story.chineseTitle && <p className="text-sm text-muted-foreground">{story.title}</p>}
        </div>

        {dictLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading dictionary…
          </div>
        )}

        {/* Chinese text */}
        <div className="space-y-4">
          {renderText()}
        </div>

        {/* English translation (collapsible) */}
        {story.englishTranslation && (
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              onClick={() => setShowTranslation(!showTranslation)}
            >
              <span>English Translation</span>
              {showTranslation ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showTranslation && (
              <div className="px-4 py-3 border-t border-border bg-muted/20">
                <p className="text-sm text-foreground leading-relaxed">{story.englishTranslation}</p>
              </div>
            )}
          </div>
        )}

        {/* Vocabulary list */}
        {story.vocabulary.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-foreground">Story Vocabulary ({story.vocabulary.length} words)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {story.vocabulary.map((v) => (
                <VocabRow
                  key={v.word}
                  vocab={v}
                  inDeck={deckWords.has(v.word)}
                  onAdd={async () => {
                    await addWord(v.word, v.pinyin, v.definition, story.hskBand, story.number);
                    setDeckWords((prev) => { const n = new Set(prev); n.add(v.word); return n; });
                    toast.success(`Added "${v.word}" to deck`);
                  }}
                  onRemove={async () => {
                    await removeWord(v.word);
                    setDeckWords((prev) => { const n = new Set(prev); n.delete(v.word); return n; });
                    toast.success(`Removed "${v.word}" from deck`);
                  }}
                  onSpeak={(w) => tts.speak(w)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Add all / Mark complete */}
        <div className="flex gap-2 pb-8">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              let added = 0;
              for (const v of story.vocabulary) {
                const already = await hasWord(v.word);
                if (!already) {
                  await addWord(v.word, v.pinyin, v.definition, story.hskBand, story.number);
                  added++;
                }
              }
              const newDeck = new Set(deckWords);
              story.vocabulary.forEach((v) => newDeck.add(v.word));
              setDeckWords(newDeck);
              toast.success(`Added ${added} new word${added !== 1 ? "s" : ""} to deck`);
            }}
          >
            <BookmarkPlus className="w-4 h-4 mr-1.5" />
            Add all vocabulary to deck
          </Button>
          {!isCompleted && (
            <Button size="sm" onClick={handleMarkComplete}>
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Mark complete
            </Button>
          )}
        </div>
      </main>

      {/* Anchor-positioned word popup */}
      {selectedWord && anchorRect && (() => {
        // Build contextChars: the selected token plus immediate Chinese neighbours
        const idx = selectedWordIdx;
        const prevToken = idx > 0 && /[\u4e00-\u9fff]/.test(tokens[idx - 1] || "") ? tokens[idx - 1] : "";
        const nextToken = idx >= 0 && idx < tokens.length - 1 && /[\u4e00-\u9fff]/.test(tokens[idx + 1] || "") ? tokens[idx + 1] : "";
        const contextChars = prevToken + selectedWord + nextToken;
        return createPortal(
          <div id="word-popup-card">
            <WordPopup
              word={selectedWord}
              entry={selectedEntry}
              storyDef={selectedStoryDef}
              inDeck={wordInDeck}
              anchor={anchorRect}
              onAdd={handleAddToDeck}
              onRemove={handleRemoveFromDeck}
              onClose={() => { setSelectedWord(null); setAnchorRect(null); setSelectedWordIdx(-1); }}
              onSpeak={(w) => tts.speak(w)}
              contextChars={contextChars}
              onSegmentationChange={(newToken) => handleSegmentationChange(selectedWord, newToken)}
            />
          </div>,
          document.body
        );
      })()}
    </div>
  );
}

function VocabRow({
  vocab,
  inDeck,
  onAdd,
  onRemove,
  onSpeak,
}: {
  vocab: StoryVocab;
  inDeck: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onSpeak: (w: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors group">
      <button onClick={() => onSpeak(vocab.word)} className="text-muted-foreground hover:text-foreground">
        <Volume2 className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm text-foreground">{vocab.word}</span>
        <span className="text-xs text-muted-foreground ml-1.5">{vocab.pinyin}</span>
        <p className="text-xs text-muted-foreground truncate">{vocab.definition}</p>
      </div>
      <button
        onClick={inDeck ? onRemove : onAdd}
        className={cn(
          "p-1 rounded transition-colors flex-shrink-0",
          inDeck ? "text-primary hover:text-destructive" : "text-muted-foreground hover:text-primary"
        )}
      >
        {inDeck ? <BookmarkCheck className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
      </button>
    </div>
  );
}
