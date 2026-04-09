/**
 * Converts numeric-tone pinyin (e.g. "xue2 xi2") to diacritic-tone pinyin (e.g. "xué xí").
 *
 * Rules follow the standard placement algorithm:
 *   1. If the syllable has 'a' or 'e', the tone mark goes on that vowel.
 *   2. If the syllable has 'ou', the tone mark goes on 'o'.
 *   3. Otherwise the tone mark goes on the last vowel.
 *
 * Tone 5 (neutral tone, written as 0 or 5) is left unmarked.
 */

const TONE_MARKS: Record<string, string[]> = {
  a: ["a", "ā", "á", "ǎ", "à"],
  e: ["e", "ē", "é", "ě", "è"],
  i: ["i", "ī", "í", "ǐ", "ì"],
  o: ["o", "ō", "ó", "ǒ", "ò"],
  u: ["u", "ū", "ú", "ǔ", "ù"],
  ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
  // ü written as v or u: in CEDICT, ü is written as "u:" or "v"
  v: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
};

/** Apply a tone number (1-4) to a single syllable string. */
function applyTone(syllable: string, tone: number): string {
  if (tone < 1 || tone > 4) return syllable; // neutral / invalid → no mark

  // Normalise "u:" → "ü" before processing
  const s = syllable.replace(/u:/g, "ü").replace(/U:/g, "Ü");

  // Find the vowel that should carry the tone mark.
  // Priority: a/e > ou > last vowel
  const vowels = ["a", "e", "ou", "i", "u", "ü", "v"];
  let targetIdx = -1;
  let targetVowel = "";

  for (const v of vowels) {
    const idx = s.toLowerCase().indexOf(v);
    if (idx !== -1) {
      targetIdx = idx;
      targetVowel = v;
      break;
    }
  }

  if (targetIdx === -1) return s; // no vowel found — shouldn't happen

  // For multi-char vowel groups like "ou", only mark the first char
  const baseChar = targetVowel[0];
  const marks = TONE_MARKS[baseChar];
  if (!marks) return s;

  const markedChar = marks[tone];
  // Preserve original case
  const originalChar = s[targetIdx];
  const finalChar = originalChar === originalChar.toUpperCase()
    ? markedChar.toUpperCase()
    : markedChar;

  return s.slice(0, targetIdx) + finalChar + s.slice(targetIdx + 1);
}

/**
 * Convert a single numeric-tone syllable token like "xue2" → "xué".
 * Handles neutral tones (0 or 5) by stripping the number.
 */
function convertSyllable(token: string): string {
  const match = token.match(/^([a-züüA-ZÜ:]+)([0-5])$/);
  if (!match) return token; // already has diacritics or no tone number
  const [, syllable, toneStr] = match;
  const tone = parseInt(toneStr, 10);
  return applyTone(syllable, tone);
}

/**
 * Convert a full pinyin string that may contain multiple space-separated
 * syllables with numeric tones into diacritic form.
 *
 * Examples:
 *   "xue2 xi2"  → "xué xí"
 *   "peng2 you5" → "péng you"
 *   "jǐnzhāng"  → "jǐnzhāng"  (already has diacritics — returned unchanged)
 */
export function numericToTone(pinyin: string): string {
  if (!pinyin) return pinyin;
  // If it already contains diacritic vowels, return as-is
  if (/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(pinyin)) return pinyin;
  return pinyin
    .split(" ")
    .map((token) => convertSyllable(token))
    .join(" ");
}
