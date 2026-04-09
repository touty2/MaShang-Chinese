import { useEffect, useState, useMemo } from "react";
import { Link } from "wouter";
import { BookOpen, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { loadStories, HSK_BANDS, type Story } from "@/lib/stories";
import { getAllCards } from "@/lib/flashcardStore";
import { cn } from "@/lib/utils";

const COMPLETED_KEY = "mashang_completed";
function getCompleted(): number[] {
  try { return JSON.parse(localStorage.getItem(COMPLETED_KEY) || "[]"); } catch { return []; }
}

const BAND_COLORS: Record<string, string> = {
  "HSK 3-I":  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "HSK 3-II": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "HSK 4-I":  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "HSK 4-II": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "HSK 5-I":  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "HSK 5-II": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

function StoryRow({ story, completed }: { story: Story; completed: boolean }) {
  return (
    <Link href={`/story/${story.number}`}>
      <Card className="cursor-pointer hover:shadow-md transition-shadow">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", BAND_COLORS[story.hskBand] ?? "bg-muted text-muted-foreground")}>
                {story.hskBand}
              </span>
              <span className="text-xs text-muted-foreground">#{story.number}</span>
            </div>
            <p className="font-medium text-sm text-foreground">{story.chineseTitle || story.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{story.title}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-muted-foreground">{story.vocabulary.length} words</span>
            {completed && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StoryList({
  stories,
  completed,
  loading,
  emptyIcon,
  emptyText,
  emptySubtext,
}: {
  stories: Story[];
  completed: number[];
  loading: boolean;
  emptyIcon?: React.ReactNode;
  emptyText: string;
  emptySubtext?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }
  if (stories.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        {emptyIcon}
        <p className="text-muted-foreground text-sm">{emptyText}</p>
        {emptySubtext && <p className="text-xs text-muted-foreground">{emptySubtext}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2 mt-4">
      {stories.map((s) => (
        <StoryRow key={s.number} story={s} completed={completed.includes(s.number)} />
      ))}
    </div>
  );
}

export default function Sessions() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [completed, setCompleted] = useState<number[]>([]);
  const [suggestedIds, setSuggestedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function load() {
      const [s, cards] = await Promise.all([loadStories(), getAllCards()]);
      setStories(s);
      setCompleted(getCompleted());
      const lapseWords = new Set(cards.filter((c) => c.lapses > 0).map((c) => c.word));
      const suggested = new Set<number>();
      for (const story of s) {
        if (story.vocabulary.some((v) => lapseWords.has(v.word))) {
          suggested.add(story.number);
        }
      }
      setSuggestedIds(suggested);
      setLoading(false);
    }
    load();
  }, []);

  // Filter by search across all stories
  const filtered = useMemo(() => {
    if (!search) return stories;
    const q = search.toLowerCase();
    return stories.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.chineseTitle?.includes(search) ?? false) ||
        s.chineseText.includes(search)
    );
  }, [stories, search]);

  // Per-band filtered lists
  const byBand = useMemo(() => {
    const result: Record<string, Story[]> = {};
    for (const band of HSK_BANDS) {
      result[band] = filtered.filter((s) => s.hskBand === band);
    }
    return result;
  }, [filtered]);

  const completedStories = useMemo(
    () => filtered.filter((s) => completed.includes(s.number)),
    [filtered, completed]
  );
  const suggestedStories = useMemo(
    () => filtered.filter((s) => suggestedIds.has(s.number)),
    [filtered, suggestedIds]
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Stories</h1>
        <p className="text-muted-foreground text-sm mt-1">{stories.length} graded texts across HSK 3–5</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search stories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Tabs defaultValue="HSK 3-I">
        {/* Horizontally scrollable tab bar */}
        <ScrollArea className="w-full whitespace-nowrap">
          <TabsList className="inline-flex w-max h-auto flex-wrap sm:flex-nowrap">
            {HSK_BANDS.map((band) => (
              <TabsTrigger key={band} value={band} className="whitespace-nowrap text-xs sm:text-sm">
                {band}
                {!loading && (
                  <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                    {byBand[band]?.length ?? 0}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
            <TabsTrigger value="suggested" className="whitespace-nowrap text-xs sm:text-sm">
              Re-read
              {!loading && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {suggestedStories.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" className="whitespace-nowrap text-xs sm:text-sm">
              Completed
              {!loading && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {completedStories.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" className="h-1.5 mt-1" />
        </ScrollArea>

        {/* Per-band content */}
        {HSK_BANDS.map((band) => (
          <TabsContent key={band} value={band}>
            <StoryList
              stories={byBand[band] ?? []}
              completed={completed}
              loading={loading}
              emptyIcon={<BookOpen className="w-8 h-8 text-muted-foreground mx-auto" />}
              emptyText={search ? "No stories match your search." : `No stories in ${band}.`}
            />
          </TabsContent>
        ))}

        {/* Suggested Re-read */}
        <TabsContent value="suggested">
          <StoryList
            stories={suggestedStories}
            completed={completed}
            loading={loading}
            emptyIcon={<RefreshCw className="w-8 h-8 text-muted-foreground mx-auto" />}
            emptyText="No re-read suggestions yet."
            emptySubtext="Stories with words you've struggled with will appear here."
          />
        </TabsContent>

        {/* Completed */}
        <TabsContent value="completed">
          <StoryList
            stories={completedStories}
            completed={completed}
            loading={loading}
            emptyIcon={<CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto" />}
            emptyText="No completed stories yet."
            emptySubtext="Stories are marked complete when you finish reading them."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
