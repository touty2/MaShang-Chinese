import { useState, useEffect, useRef } from "react";
import {
  Settings2, Volume2, Moon, Sun, RefreshCw, Trash2,
  Download, Info, User, LogIn, BookOpen, Palette
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { useSettings, type ReadingFont, type AccentColor, type ReadingBackground, type CharacterScript } from "@/contexts/SettingsContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { getAllCards, clearAllCards } from "@/lib/flashcardStore";
import { clearAllDecks } from "@/lib/deckStore";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// ─── Accent colour options ────────────────────────────────────────────────────
const ACCENT_OPTIONS: { value: AccentColor; label: string; hex: string }[] = [
  { value: "teal",    label: "Teal",    hex: "#0d9488" },
  { value: "indigo",  label: "Indigo",  hex: "#4f46e5" },
  { value: "violet",  label: "Violet",  hex: "#7c3aed" },
  { value: "rose",    label: "Rose",    hex: "#e11d48" },
  { value: "amber",   label: "Amber",   hex: "#d97706" },
  { value: "emerald", label: "Emerald", hex: "#059669" },
  { value: "sky",     label: "Sky",     hex: "#0284c7" },
  { value: "slate",   label: "Slate",   hex: "#475569" },
];

// ─── Reading background options ───────────────────────────────────────────────
const BG_OPTIONS: { value: ReadingBackground; label: string; bg: string; textColor: string }[] = [
  { value: "white", label: "White",  bg: "#ffffff", textColor: "#555" },
  { value: "paper", label: "Paper",  bg: "#f7f4ee", textColor: "#555" },
  { value: "warm",  label: "Warm",   bg: "#fdf6ec", textColor: "#555" },
  { value: "cool",  label: "Cool",   bg: "#f0f4f8", textColor: "#555" },
  { value: "dark",  label: "Dark",   bg: "#1e2030", textColor: "#ccc" },
];

// ─── Font options ─────────────────────────────────────────────────────────────
const FONT_OPTIONS: { value: ReadingFont; label: string }[] = [
  { value: "Noto Sans SC",   label: "Noto Sans SC (default)" },
  { value: "Noto Serif SC",  label: "Noto Serif SC" },
  { value: "Inter",          label: "Inter" },
  { value: "Source Serif 4", label: "Source Serif 4" },
  { value: "system-ui",      label: "System UI" },
];

// ─── Sample sentence for font preview ───────────────────────────────────────
const SAMPLE_SENTENCE = "今天天气很好，我们去公园散步吧。";
const SAMPLE_SENTENCE_TRAD = "今天天氣很好，我們去公園散步吧。";

// ─── FontPreview: shows sample sentence with flip animation on font change ───
function FontPreview({ font, script }: { font: ReadingFont; script: CharacterScript }) {
  const [displayFont, setDisplayFont] = useState(font);
  const [displayScript, setDisplayScript] = useState(script);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const pendingRef = useRef<{ font: ReadingFont; script: CharacterScript } | null>(null);

  useEffect(() => {
    if (font === displayFont && script === displayScript) return;
    pendingRef.current = { font, script };
    setPhase("out");
  }, [font, script]);

  const handleTransitionEnd = () => {
    if (phase === "out" && pendingRef.current) {
      setDisplayFont(pendingRef.current.font);
      setDisplayScript(pendingRef.current.script);
      pendingRef.current = null;
      setPhase("in");
    } else if (phase === "in") {
      setPhase("idle");
    }
  };

  const fontMap: Record<ReadingFont, string> = {
    "Noto Sans SC":   '"Noto Sans SC", sans-serif',
    "Noto Serif SC":  '"Noto Serif SC", serif',
    "Inter":          '"Inter", sans-serif',
    "Source Serif 4": '"Source Serif 4", serif',
    "system-ui":      "system-ui, sans-serif",
  };

  const sentence = displayScript === "traditional" ? SAMPLE_SENTENCE_TRAD : SAMPLE_SENTENCE;

  return (
    <div className="font-preview-scene rounded-lg border border-border bg-muted/30 px-4 py-3 mt-2">
      <div
        className={cn(
          "font-preview-inner text-base text-foreground leading-relaxed",
          phase === "out" && "flipping",
          phase === "in" && "flipped-in"
        )}
        style={{ fontFamily: fontMap[displayFont] }}
        onTransitionEnd={handleTransitionEnd}
      >
        {sentence}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        Preview · {FONT_OPTIONS.find(f => f.value === displayFont)?.label}
      </p>
    </div>
  );
}

export default function Settings() {
  const { settings, update: updateSettings } = useSettings();
  const { theme, toggleTheme } = useTheme();
  const { user, isAuthenticated } = useAuth();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [cardCount, setCardCount] = useState(0);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [syncing, setSyncing] = useState(false);
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();

  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => {
      // Close dialog and reset input immediately
      setDeleteDialogOpen(false);
      setDeleteConfirmText("");
      // Clear all local user data
      await clearAllCards();
      await clearAllDecks();
      ["mashang_completed", "mashang_my_words", "mashang_vocab_ignored", "mashang_seg_overrides"].forEach(k => localStorage.removeItem(k));
      // Invalidate auth so ProtectedRoute redirects to /auth
      utils.auth.me.invalidate();
      toast.success("Account deleted");
      // Explicit navigation as a safety net
      navigate("/auth");
    },
    onError: (err) => toast.error(err.message || "Failed to delete account"),
  });

  useEffect(() => {
    getAllCards().then((cards) => setCardCount(new Set(cards.map((c) => c.word)).size));
    const loadVoices = () => {
      const v = window.speechSynthesis?.getVoices() ?? [];
      setVoices(v.filter((voice) => voice.lang.startsWith("zh")));
    };
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const handleReset = async () => {
    await clearAllCards();
    await clearAllDecks();
    localStorage.removeItem("mashang_completed");
    localStorage.removeItem("mashang_my_words");
    setCardCount(0);
    toast.success("All local data cleared");
    setResetDialogOpen(false);
  };

  const handleSync = async () => {
    if (!isAuthenticated) { toast.error("Sign in to sync"); return; }
    setSyncing(true);
    try {
      const { performSync } = await import("@/lib/syncService");
      await performSync(utils, (status) => {
        if (status === "success") toast.success("Synced successfully");
        if (status === "error") toast.error("Sync failed");
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Customize your learning experience</p>
      </div>

      {/* Account — always visible */}
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
          <User className="w-4 h-4" /> Account
        </div>
        {isAuthenticated && user ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{user.name || "User"}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
              <Badge variant="secondary">Signed in</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Delete Account</p>
                <p className="text-xs text-muted-foreground">Permanently remove your account and all data</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { setDeleteConfirmText(""); setDeleteDialogOpen(true); }}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Sign in to sync your progress across devices.</p>
            <Link href="/auth">
              <Button size="sm" className="gap-1.5">
                <LogIn className="w-3.5 h-3.5" />
                Sign in
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Accordion sections */}
      <Accordion type="multiple" defaultValue={["appearance"]} className="space-y-2">

        {/* ── Appearance ── */}
        <AccordionItem value="appearance" className="rounded-xl border bg-card shadow-sm px-4 data-[state=open]:shadow-md">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Palette className="w-4 h-4" /> Appearance
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-5 pb-5">

            {/* Theme */}
            <div className="flex items-center justify-between">
              <Label>Theme</Label>
              <div className="flex gap-1">
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { if (theme !== "light") toggleTheme?.(); }}
                >
                  <Sun className="w-3.5 h-3.5 mr-1" />Light
                </Button>
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { if (theme !== "dark") toggleTheme?.(); }}
                >
                  <Moon className="w-3.5 h-3.5 mr-1" />Dark
                </Button>
              </div>
            </div>

            <Separator />

            {/* Accent colour */}
            <div className="space-y-2">
              <Label>Accent colour</Label>
              <div className="flex gap-2 flex-wrap">
                {ACCENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateSettings({ accentColor: opt.value })}
                    title={opt.label}
                    className={cn(
                      "w-7 h-7 rounded-full border-2 transition-all",
                      settings.accentColor === opt.value
                        ? "border-foreground scale-110 shadow-md"
                        : "border-transparent hover:border-muted-foreground/40"
                    )}
                    style={{ backgroundColor: opt.hex }}
                  />
                ))}
              </div>
            </div>

            <Separator />

            {/* Reading background */}
            <div className="space-y-2">
              <Label>Reading background</Label>
              <div className="flex gap-2 flex-wrap">
                {BG_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateSettings({ readingBackground: opt.value })}
                    title={opt.label}
                    className={cn(
                      "w-9 h-9 rounded-lg border-2 transition-all text-[9px] font-bold flex items-center justify-center",
                      settings.readingBackground === opt.value
                        ? "border-primary scale-110 shadow-md"
                        : "border-muted hover:border-muted-foreground/50"
                    )}
                    style={{ backgroundColor: opt.bg, color: opt.textColor }}
                  >
                    {opt.label[0]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Current: <strong>{BG_OPTIONS.find((o) => o.value === settings.readingBackground)?.label}</strong> — applied in the story reader
              </p>
            </div>

            <Separator />

            {/* Font family + preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Reading font</Label>
                <Select
                  value={settings.readingFont}
                  onValueChange={(v) => updateSettings({ readingFont: v as ReadingFont })}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Character script toggle with flip animation */}
              <div className="flex items-center justify-between">
                <Label>Character script</Label>
                <div className="flex gap-1">
                  <Button
                    variant={settings.characterScript === "simplified" ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateSettings({ characterScript: "simplified" })}
                  >
                    简 Simplified
                  </Button>
                  <Button
                    variant={settings.characterScript === "traditional" ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateSettings({ characterScript: "traditional" })}
                  >
                    繁 Traditional
                  </Button>
                </div>
              </div>
              {/* Animated font + script preview */}
              <FontPreview font={settings.readingFont} script={settings.characterScript} />
            </div>

            {/* Font size — max 48px */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Font size</Label>
                <p className="text-xs text-muted-foreground">{settings.fontSize}px</p>
              </div>
              <div className="w-36">
                <Slider
                  min={14}
                  max={48}
                  step={2}
                  value={[settings.fontSize]}
                  onValueChange={([v]) => updateSettings({ fontSize: v })}
                />
              </div>
            </div>

            {/* Line spacing */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Line spacing</Label>
                <p className="text-xs text-muted-foreground">{(settings.lineHeight / 10).toFixed(1)}×</p>
              </div>
              <div className="w-36">
                <Slider
                  min={12}
                  max={30}
                  step={1}
                  value={[settings.lineHeight]}
                  onValueChange={([v]) => updateSettings({ lineHeight: v })}
                />
              </div>
            </div>

            {/* Paragraph spacing */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Paragraph spacing</Label>
                <p className="text-xs text-muted-foreground">{(settings.paraSpacing / 10).toFixed(1)}rem</p>
              </div>
              <div className="w-36">
                <Slider
                  min={5}
                  max={30}
                  step={1}
                  value={[settings.paraSpacing]}
                  onValueChange={([v]) => updateSettings({ paraSpacing: v })}
                />
              </div>
            </div>

          </AccordionContent>
        </AccordionItem>

        {/* ── Flashcard Settings ── */}
        <AccordionItem value="flashcard" className="rounded-xl border bg-card shadow-sm px-4 data-[state=open]:shadow-md">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Flashcard Settings
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-5">

            <div className="flex items-center justify-between">
              <div>
                <Label>Desired retention</Label>
                <p className="text-xs text-muted-foreground">{settings.desiredRetention}%</p>
              </div>
              <div className="w-36">
                <Slider min={70} max={97} step={1}
                  value={[settings.desiredRetention]}
                  onValueChange={([v]) => updateSettings({ desiredRetention: v })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Maximum interval</Label>
                <p className="text-xs text-muted-foreground">{settings.maxInterval} days</p>
              </div>
              <div className="w-36">
                <Slider min={30} max={730} step={30}
                  value={[settings.maxInterval]}
                  onValueChange={([v]) => updateSettings({ maxInterval: v })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>Card direction</Label>
              <Select
                value={settings.cardDirection}
                onValueChange={(v) => updateSettings({ cardDirection: v as "zh_en" | "en_zh" | "mixed" })}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh_en">Chinese → English</SelectItem>
                  <SelectItem value="en_zh">English → Chinese</SelectItem>
                  <SelectItem value="mixed">Mixed (both)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label>Show pinyin on front of card</Label>
              <Switch
                checked={settings.showPinyinOnFront}
                onCheckedChange={(v) => updateSettings({ showPinyinOnFront: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Unlimited daily reviews</Label>
              <Switch
                checked={settings.unlimitedReviews}
                onCheckedChange={(v) => updateSettings({ unlimitedReviews: v })}
              />
            </div>

            {!settings.unlimitedReviews && (
              <div className="flex items-center justify-between">
                <div>
                  <Label>Daily review cap</Label>
                  <p className="text-xs text-muted-foreground">{settings.dailyReviewCap} cards</p>
                </div>
                <div className="w-36">
                  <Slider min={10} max={200} step={10}
                    value={[settings.dailyReviewCap]}
                    onValueChange={([v]) => updateSettings({ dailyReviewCap: v })}
                  />
                </div>
              </div>
            )}

          </AccordionContent>
        </AccordionItem>

        {/* ── Story Reading ── */}
        <AccordionItem value="reading" className="rounded-xl border bg-card shadow-sm px-4 data-[state=open]:shadow-md">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Story Reading
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-5">

            <div className="flex items-center justify-between">
              <Label>Highlight active sentence</Label>
              <Switch
                checked={settings.highlightActiveSentence}
                onCheckedChange={(v) => updateSettings({ highlightActiveSentence: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Highlight active word</Label>
              <Switch
                checked={settings.highlightActiveWord}
                onCheckedChange={(v) => updateSettings({ highlightActiveWord: v })}
              />
            </div>

          </AccordionContent>
        </AccordionItem>

        {/* ── Audio & Pronunciation ── */}
        <AccordionItem value="audio" className="rounded-xl border bg-card shadow-sm px-4 data-[state=open]:shadow-md">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Volume2 className="w-4 h-4" /> Audio &amp; Pronunciation
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-5">

            <div className="flex items-center justify-between">
              <Label>Play audio when card flips</Label>
              <Switch
                checked={settings.playAudioOnFlip}
                onCheckedChange={(v) => updateSettings({ playAudioOnFlip: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>TTS speed</Label>
                <p className="text-xs text-muted-foreground">{settings.ttsSpeed.toFixed(1)}×</p>
              </div>
              <div className="w-36">
                <Slider min={0.5} max={1.5} step={0.1}
                  value={[settings.ttsSpeed]}
                  onValueChange={([v]) => updateSettings({ ttsSpeed: v })}
                />
              </div>
            </div>

            {voices.length > 0 && (
              <div className="flex items-center justify-between">
                <Label>Chinese voice</Label>
                <Select
                  value={settings.ttsVoiceURI || "__default__"}
                  onValueChange={(v) => updateSettings({ ttsVoiceURI: v === "__default__" ? "" : v })}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">System default</SelectItem>
                    {voices.map((v) => (
                      <SelectItem key={v.voiceURI} value={v.voiceURI}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              Word highlighting during audio playback works best in Chrome or Edge. Safari/iOS may have limited TTS support.
            </div>

          </AccordionContent>
        </AccordionItem>

        {/* ── Data Management ── */}
        <AccordionItem value="data" className="rounded-xl border bg-card shadow-sm px-4 data-[state=open]:shadow-md">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Download className="w-4 h-4" /> Data Management
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-5">

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Local data</p>
                <p className="text-xs text-muted-foreground">{cardCount} words in deck</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">Danger zone</p>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => setResetDialogOpen(true)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset all local data
              </Button>
            </div>

          </AccordionContent>
        </AccordionItem>

        {/* ── Cloud Sync ── */}
        <AccordionItem value="sync" className="rounded-xl border bg-card shadow-sm px-4 data-[state=open]:shadow-md">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Cloud Sync
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-5">

            {isAuthenticated ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Sync your flashcard progress, completed stories, and preferences across devices.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Sign in to enable cloud sync across devices.</p>
                <Link href="/auth">
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <LogIn className="w-3.5 h-3.5" />
                    Sign in to sync
                  </Button>
                </Link>
              </div>
            )}

          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {/* About */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
        <Info className="w-3.5 h-3.5 flex-shrink-0" />
        <span>Mashang Chinese — 118 graded texts, HSK 3–5, with FSRS spaced repetition</span>
      </div>

      {/* Reset dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all local data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all flashcards, SRS progress, completed stories, and custom words stored locally. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Account confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete account permanently?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">This will permanently delete your account and <strong>all associated data</strong> — flashcards, progress, completed stories, decks, and preferences. This action cannot be undone.</span>
              <span className="block mt-2">Type <strong>delete my account</strong> to confirm:</span>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="delete my account"
                className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirmText.trim().toLowerCase() !== "delete my account" || deleteAccountMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40"
              onClick={(e) => {
                e.preventDefault();
                if (deleteConfirmText.trim().toLowerCase() !== "delete my account") return;
                deleteAccountMutation.mutate();
              }}
            >
              {deleteAccountMutation.isPending ? "Deleting…" : "Delete my account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
