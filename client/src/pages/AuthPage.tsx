import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export default function AuthPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, refetch } = useAuth();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");

  useEffect(() => {
    if (isAuthenticated) navigate("/dashboard");
  }, [isAuthenticated]);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Welcome back!");
      navigate("/dashboard");
    },
    onError: (e) => toast.error(e.message),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Account created! Welcome to Mashang Chinese.");
      navigate("/dashboard");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto">
            <span className="text-primary-foreground font-bold text-2xl">马</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">马上中文</h1>
          <p className="text-muted-foreground text-sm">Graded Chinese reading with spaced repetition</p>
        </div>

        <Card>
          <Tabs defaultValue="login">
            <CardHeader className="pb-0">
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1">Sign in</TabsTrigger>
                <TabsTrigger value="register" className="flex-1">Create account</TabsTrigger>
              </TabsList>
            </CardHeader>

            <TabsContent value="login">
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate({ email: loginEmail, password: loginPassword })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate({ email: loginEmail, password: loginPassword })}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => loginMutation.mutate({ email: loginEmail, password: loginPassword })}
                  disabled={loginMutation.isPending || !loginEmail || !loginPassword}
                >
                  {loginMutation.isPending ? "Signing in…" : "Sign in"}
                </Button>
              </CardContent>
            </TabsContent>

            <TabsContent value="register">
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name">Name</Label>
                  <Input
                    id="reg-name"
                    placeholder="Your name"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email">Email</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="you@example.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">Password</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => registerMutation.mutate({ name: regName, email: regEmail, password: regPassword })}
                  disabled={registerMutation.isPending || !regEmail || !regPassword || regPassword.length < 8}
                >
                  {registerMutation.isPending ? "Creating account…" : "Create account"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Your progress is saved locally and synced to the cloud when signed in.
                </p>
              </CardContent>
            </TabsContent>
          </Tabs>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          You can use the app without an account — sign in to sync across devices.
        </p>
      </div>
    </div>
  );
}
