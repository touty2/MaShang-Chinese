import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { hydrateFromServer, performSync, shouldSync } from "@/lib/syncService";
import { clearAllCards } from "@/lib/flashcardStore";
import { clearAllDecks } from "@/lib/deckStore";
import { pruneOldSessions, clearUserSessions } from "@/lib/sessionStore";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** True while the initial auth check OR post-login hydration is in progress */
  hydrating: boolean;
  isAuthenticated: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  hydrating: true,
  isAuthenticated: false,
  refetch: () => {},
});

/**
 * Clear all browser-local data that is scoped per-user.
 *
 * NOTE: We intentionally do NOT clear localStorage session keys here.
 * Sessions are stored under "mashang_sess_<userId>_..." so they are already
 * user-scoped.  Clearing them on login would destroy the mid-session queue
 * that the user was in the middle of.  Instead:
 *   - On LOGIN of the SAME user: sessions survive → resume works.
 *   - On LOGIN of a DIFFERENT user: sessions from the old user are ignored
 *     because the key includes the old user's email.
 *   - On LOGOUT: we explicitly clear the current user's sessions below.
 */
async function clearLocalUserData(userEmail?: string): Promise<void> {
  await clearAllCards();
  await clearAllDecks();
  // Prune stale (yesterday's) sessions
  await pruneOldSessions();
  // On logout: also clear today's sessions for this user so the next user
  // doesn't accidentally resume them.
  if (userEmail) {
    await clearUserSessions(userEmail);
  }
  const keysToRemove = [
    "mashang_completed",
    "mashang_my_words",
    "mashang_vocab_ignored",
    "mashang_seg_overrides",
  ];
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const user = data ?? null;
  const prevUserRef = useRef<{ id: number | null; email: string | null } | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // hydrating = true while auth is loading OR while post-login hydration is running.
  // Pages must not render user data until this is false.
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    if (isLoading) return;

    const currentUserId = user?.id ?? null;
    const currentEmail = user?.email ?? null;
    const prevUserId = prevUserRef.current?.id;
    const prevEmail = prevUserRef.current?.email ?? undefined;

    const isFirstLoad = prevUserRef.current === undefined;
    const isNewUser = currentUserId !== null && currentUserId !== prevUserId;
    const isSignOut = !isFirstLoad && prevUserId !== null && currentUserId === null;

    if (isNewUser || (isFirstLoad && currentUserId !== null)) {
      // Logged in or switched accounts — clear local state then pull from server.
      // Pass the PREVIOUS user's email so we clear their sessions on account switch.
      // Do NOT pass the current user's email — we want to keep their sessions!
      const emailToClear = isNewUser && prevUserId !== null ? (prevEmail ?? undefined) : undefined;
      setHydrating(true);
      clearLocalUserData(emailToClear)
        .then(() => hydrateFromServer(utils))
        .catch(console.error)
        .finally(() => setHydrating(false));
    } else if (isSignOut) {
      // Signed out — clear local data including the current user's sessions.
      setHydrating(true);
      clearLocalUserData(prevEmail)
        .catch(console.error)
        .finally(() => setHydrating(false));
    } else if (isFirstLoad && currentUserId === null) {
      // First load, not authenticated — nothing to hydrate.
      setHydrating(false);
    }

    prevUserRef.current = { id: currentUserId, email: currentEmail };
  }, [user?.id, user?.email, isLoading, utils]);

  // Periodic sync every 3 minutes while authenticated
  useEffect(() => {
    if (!user) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      if (shouldSync()) {
        performSync(utils).catch(console.error);
      }
    }, 60 * 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [user, utils]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: isLoading,
        hydrating: isLoading || hydrating,
        isAuthenticated: !!user,
        refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
