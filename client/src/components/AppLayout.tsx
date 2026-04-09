import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  Layers,
  BookOpen,
  BookMarked,
  Settings,
  LogIn,
  LogOut,
  RefreshCw,
  User,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearAllCards } from "@/lib/flashcardStore";
import { clearAllDecks } from "@/lib/deckStore";

const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { path: "/deck", label: "Deck", icon: Layers },
  { path: "/sessions", label: "Sessions", icon: BookOpen },
  { path: "/vocab", label: "Vocab", icon: BookMarked },
  { path: "/settings", label: "Settings", icon: Settings },
];

function SidebarNav({ onClose }: { onClose?: () => void }) {
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      // Clear all local user data before invalidating auth so pages
      // never render stale data from the previous session.
      await clearAllCards();
      await clearAllDecks();
      const keysToRemove = [
        "mashang_completed",
        "mashang_my_words",
        "mashang_vocab_ignored",
        "mashang_seg_overrides",
      ];
      for (const key of keysToRemove) localStorage.removeItem(key);
      utils.auth.me.invalidate();
      toast.success("Signed out");
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-sidebar-border">
        <Link href="/dashboard" onClick={onClose}>
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">马</span>
            </div>
            <div>
              <div className="font-semibold text-sm text-sidebar-foreground leading-tight">马上中文</div>
              <div className="text-xs text-muted-foreground leading-tight">Mashang Chinese</div>
            </div>
          </div>
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const active = location === path || (path === "/dashboard" && location === "/");
          return (
            <Link key={path} href={path} onClick={onClose}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer: auth */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        {isAuthenticated && user ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground">
              <User className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </div>
            <button
              onClick={() => logoutMutation.mutate()}
              className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              Sign out
            </button>
          </div>
        ) : (
          <Link href="/auth" onClick={onClose}>
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors cursor-pointer">
              <LogIn className="w-4 h-4 flex-shrink-0" />
              Sign in
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Full-width pages (no sidebar)
  const isFullWidth = location.startsWith("/story/") || location === "/auth";

  if (isFullWidth) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border">
        <SidebarNav />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-sidebar-border z-10">
            <div className="flex items-center justify-end px-4 pt-4">
              <button onClick={() => setMobileOpen(false)} className="p-1 rounded text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarNav onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
          <button onClick={() => setMobileOpen(true)} className="p-1 rounded text-muted-foreground hover:text-foreground">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">马</span>
            </div>
            <span className="font-semibold text-sm">Mashang Chinese</span>
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden flex border-t border-border bg-background">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = location === path || (path === "/dashboard" && location === "/");
            return (
              <Link key={path} href={path} className="flex-1">
                <div
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-2 text-xs transition-colors cursor-pointer",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span>{label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
