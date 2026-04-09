import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { SettingsProvider } from "./contexts/SettingsContext";
import { useAuth } from "./contexts/AuthContext";
import AppLayout from "./components/AppLayout";
import Dashboard from "./pages/Dashboard";
import Sessions from "./pages/Sessions";
import StoryPage from "./pages/StoryPage";
import Deck from "./pages/Deck";
import Vocab from "./pages/Vocab";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import AuthPage from "./pages/AuthPage";
import { Loader2 } from "lucide-react";

/**
 * Wraps a component so that unauthenticated users are redirected to /auth.
 * While auth is still loading, shows a centered spinner so there is no flash
 * of stale local data.
 */
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading, hydrating } = useAuth();

  // Block rendering while auth is loading OR while post-login hydration is running.
  // This prevents any flash of stale data from a previous session.
  if (loading || hydrating) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/auth" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/auth" component={AuthPage} />

      {/* Protected routes — redirect to /auth when signed out */}
      <Route path="/">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/sessions">
        {() => <ProtectedRoute component={Sessions} />}
      </Route>
      <Route path="/story/:id">
        {() => <ProtectedRoute component={StoryPage} />}
      </Route>
      <Route path="/deck">
        {() => <ProtectedRoute component={Deck} />}
      </Route>
      <Route path="/vocab">
        {() => <ProtectedRoute component={Vocab} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <SettingsProvider>
          <AuthProvider>
            <TooltipProvider>
              <Toaster />
              <AppLayout>
                <Router />
              </AppLayout>
            </TooltipProvider>
          </AuthProvider>
        </SettingsProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
