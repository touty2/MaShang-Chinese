const STORIES_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663317949134/gyZHNejwRaX99q6q2mE9js/all_stories_5b705d57.json";

export interface StoryVocab {
  word: string;
  pinyin: string;
  definition: string;
}

export interface Story {
  number: number;
  title: string;
  chineseTitle?: string;        // optional — not present in new story format
  hskBand: string;
  chineseText: string;
  englishTranslation?: string;  // optional — not present in new story format
  vocabulary: StoryVocab[];
  segmentedText?: string[];     // pre-segmented tokens from new story format
}

let storiesCache: Story[] | null = null;
let loadPromise: Promise<Story[]> | null = null;

export async function loadStories(): Promise<Story[]> {
  if (storiesCache) return storiesCache;
  if (loadPromise) return loadPromise;
  loadPromise = fetch(STORIES_URL)
    .then((r) => r.json())
    .then((data) => {
      storiesCache = data.stories as Story[];
      return storiesCache;
    });
  return loadPromise;
}

export function getStoryById(stories: Story[], id: number): Story | undefined {
  return stories.find((s) => s.number === id);
}

export function getUniqueVocab(stories: Story[]): (StoryVocab & { hskBand: string })[] {
  const seen = new Set<string>();
  const result: (StoryVocab & { hskBand: string })[] = [];
  for (const story of stories) {
    for (const v of story.vocabulary) {
      if (!seen.has(v.word)) {
        seen.add(v.word);
        result.push({ ...v, hskBand: story.hskBand });
      }
    }
  }
  return result;
}

export const HSK_BANDS = ["HSK 3-I", "HSK 3-II", "HSK 4-I", "HSK 4-II", "HSK 5-I", "HSK 5-II"] as const;
export type HskBand = (typeof HSK_BANDS)[number];
