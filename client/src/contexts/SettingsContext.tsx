import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type ReadingFont = "Noto Sans SC" | "Noto Serif SC" | "Inter" | "Source Serif 4" | "system-ui";
export type AccentColor = "teal" | "indigo" | "violet" | "rose" | "amber" | "emerald" | "sky" | "slate";
export type ReadingBackground = "white" | "paper" | "warm" | "cool" | "dark";
export type CardDirection = "zh_en" | "en_zh" | "mixed";
export type CharacterScript = "simplified" | "traditional";

export interface AppSettings {
  // Appearance
  readingFont: ReadingFont;
  characterScript: CharacterScript;
  fontSize: number;           // actual px, e.g. 18
  lineHeight: number;         // * 10, e.g. 20 = 2.0
  paraSpacing: number;        // rem * 10, e.g. 15 = 1.5rem
  darkMode: boolean;
  accentColor: AccentColor;
  readingBackground: ReadingBackground;
  // Flashcard
  cardDirection: CardDirection;
  dailyReviewCap: number;
  unlimitedReviews: boolean;
  newWordCap: number;
  desiredRetention: number;   // 0-100
  maxInterval: number;        // days
  showPinyinOnFront: boolean;
  autoAdvance: boolean;
  // Story reading
  sentenceModeDefault: boolean;
  highlightActiveSentence: boolean;
  highlightActiveWord: boolean;
  // Audio
  ttsVoiceURI: string;
  ttsGender: "female" | "male";
  ttsSpeed: number;           // 0.5-2.0
  playAudioOnFlip: boolean;
}

const DEFAULTS: AppSettings = {
  readingFont: "Noto Sans SC",
  characterScript: "simplified",
  fontSize: 18,
  lineHeight: 20,
  paraSpacing: 15,
  darkMode: false,
  accentColor: "teal",
  readingBackground: "white",
  cardDirection: "zh_en",
  dailyReviewCap: 100,
  unlimitedReviews: false,
  newWordCap: 20,
  desiredRetention: 90,
  maxInterval: 365,
  showPinyinOnFront: false,
  autoAdvance: false,
  sentenceModeDefault: false,
  highlightActiveSentence: true,
  highlightActiveWord: true,
  ttsVoiceURI: "",
  ttsGender: "female",
  ttsSpeed: 1.0,
  playAudioOnFlip: false,
};

const STORAGE_KEY = "mashang_settings";

const ACCENT_COLORS: Record<AccentColor, string> = {
  teal:    "oklch(0.46 0.07 195)",
  indigo:  "oklch(0.46 0.18 264)",
  violet:  "oklch(0.49 0.18 293)",
  rose:    "oklch(0.55 0.19 10)",
  amber:   "oklch(0.65 0.17 65)",
  emerald: "oklch(0.50 0.14 162)",
  sky:     "oklch(0.55 0.15 220)",
  slate:   "oklch(0.40 0.02 250)",
};

interface SettingsContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULTS,
  update: () => {},
  reset: () => {},
});

function applySettings(s: AppSettings) {
  const root = document.documentElement;
  // Dark mode
  root.classList.toggle("dark", s.darkMode);
  // Reading CSS vars
  // Character script CSS class
  root.classList.toggle("script-traditional", s.characterScript === "traditional");

  const fontMap: Record<ReadingFont, string> = {
    "Noto Sans SC": '"Noto Sans SC", sans-serif',
    "Noto Serif SC": '"Noto Serif SC", serif',
    "Inter": '"Inter", sans-serif',
    "Source Serif 4": '"Source Serif 4", serif',
    "system-ui": "system-ui, sans-serif",
  };
  root.style.setProperty("--reading-font", fontMap[s.readingFont]);
  root.style.setProperty("--reading-size", `${s.fontSize}px`);
  root.style.setProperty("--reading-line-height", `${s.lineHeight / 10}`);
  root.style.setProperty("--reading-para-spacing", `${s.paraSpacing / 10}rem`);
  // Accent color
  const accent = ACCENT_COLORS[s.accentColor];
  root.style.setProperty("--primary", accent);
  root.style.setProperty("--ring", accent);
  root.style.setProperty("--sidebar-primary", accent);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AppSettings>;
        // Migrate legacy fontSize (rem*100, e.g. 112) to actual px (e.g. 18)
        if (parsed.fontSize !== undefined && parsed.fontSize > 48) {
          parsed.fontSize = Math.round(parsed.fontSize / 100 * 16);
        }
        // Clamp to valid range
        if (parsed.fontSize !== undefined) {
          parsed.fontSize = Math.min(48, Math.max(14, parsed.fontSize));
        }
        // Guard cardDirection — coerce unexpected/legacy values to zh_en
        const validDirections: CardDirection[] = ["zh_en", "en_zh", "mixed"];
        if (parsed.cardDirection !== undefined && !validDirections.includes(parsed.cardDirection)) {
          parsed.cardDirection = "zh_en";
        }
        return { ...DEFAULTS, ...parsed };
      }
    } catch {}
    return DEFAULTS;
  });

  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSettings(DEFAULTS);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
