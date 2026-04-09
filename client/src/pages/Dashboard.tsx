import { useEffect, useState } from "react";
import { Link } from "wouter";
import { BookOpen, Layers, TrendingUp, CheckCircle2, Flame, Target, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAllCards, getDueCards } from "@/lib/flashcardStore";
import { loadStories, type Story } from "@/lib/stories";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface Stats {
  totalCards: number;
  dueToday: number;
  newCards: number;
  completedStories: number;
  totalStories: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalCards: 0, dueToday: 0, newCards: 0, completedStories: 0, totalStories: 0 });
  const [recentStories, setRecentStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [cards, stories] = await Promise.all([getAllCards(), loadStories()]);
      const due = await getDueCards("mixed");
      const newCards = cards.filter((c) => c.state === 0);
      const completed = JSON.parse(localStorage.getItem("mashang_completed") || "[]") as number[];
      setStats({
        totalCards: new Set(cards.map((c) => c.word)).size,
        dueToday: due.length,
        newCards: new Set(newCards.map((c) => c.word)).size,
        completedStories: completed.length,
        totalStories: stories.length,
      });
      // Show first 6 stories as "recent"
      setRecentStories(stories.slice(0, 6));
      setLoading(false);
    }
    load();
  }, []);

  const greeting = user ? `Welcome back, ${user.name || user.email.split("@")[0]}` : "Welcome to Mashang Chinese";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{greeting}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {stats.dueToday > 0
            ? `You have ${stats.dueToday} card${stats.dueToday !== 1 ? "s" : ""} due for review today.`
            : "No cards due today — great work!"}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Layers} label="Words in deck" value={stats.totalCards} color="text-primary" />
        <StatCard icon={Target} label="Due today" value={stats.dueToday} color="text-amber-500" />
        <StatCard icon={Flame} label="New words" value={stats.newCards} color="text-rose-500" />
        <StatCard icon={CheckCircle2} label="Stories read" value={`${stats.completedStories}/${stats.totalStories}`} color="text-emerald-500" />
      </div>

      {/* CTA buttons */}
      <div className="flex flex-wrap gap-3">
        {stats.dueToday > 0 && (
          <Link href="/deck">
            <Button size="lg" className="gap-2">
              <Layers className="w-4 h-4" />
              Review {stats.dueToday} card{stats.dueToday !== 1 ? "s" : ""}
            </Button>
          </Link>
        )}
        <Link href="/sessions">
          <Button variant="outline" size="lg" className="gap-2">
            <BookOpen className="w-4 h-4" />
            Read a story
          </Button>
        </Link>
      </div>

      {/* Recent stories */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground">Stories</h2>
          <Link href="/sessions">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              View all <ChevronRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
              ))
            : recentStories.map((story) => (
                <StoryCard key={story.number} story={story} />
              ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number | string; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={cn("w-4 h-4", color)} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function StoryCard({ story }: { story: Story }) {
  const completed = JSON.parse(localStorage.getItem("mashang_completed") || "[]") as number[];
  const isDone = completed.includes(story.number);
  const bandColor: Record<string, string> = {
    "HSK 3-I": "bg-green-100 text-green-700",
    "HSK 3-II": "bg-green-100 text-green-700",
    "HSK 4-I": "bg-blue-100 text-blue-700",
    "HSK 4-II": "bg-blue-100 text-blue-700",
    "HSK 5-I": "bg-purple-100 text-purple-700",
    "HSK 5-II": "bg-purple-100 text-purple-700",
  };

  return (
    <Link href={`/story/${story.number}`}>
      <Card className={cn("cursor-pointer hover:shadow-md transition-shadow h-full", isDone && "opacity-70")}>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", bandColor[story.hskBand] ?? "bg-muted text-muted-foreground")}>
              {story.hskBand}
            </span>
            {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
          </div>
          <div>
            <p className="font-medium text-sm text-foreground leading-tight">{story.chineseTitle || story.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{story.title}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
