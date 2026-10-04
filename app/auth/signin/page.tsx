"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resetSession = searchParams.get("sessionExpired") === "1" || searchParams.get("switchTenant") === "1";
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (resetSession) {
      if (status === "authenticated") {
        void signOut({ redirect: false }).then(() => router.replace("/auth/signin"));
      } else if (status === "unauthenticated") {
        router.replace("/auth/signin");
      }
      return;
    }
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [router, status, resetSession]);

  if (status === "authenticated") {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
                callbackUrl: "/dashboard",
              });

              if (result?.error) {
                toast.error("Invalid email or password.");
                return;
              }

              window.location.href = "/dashboard";
            }}
          >
            <FormField id="email" label="Email">
              <Input
                id="email"
                type="email"
                placeholder="test@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>

            <FormField id="password" label="Password">
              <Input
                id="password"
                type="password"
                placeholder="password123"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>

            <Button className="w-full" type="submit">
              Sign in
            </Button>
          </form>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Invited parent-company users should use the reset flow first to set their password.
          </p>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => router.push("/auth/forgot-password")}
            >
              Forgot password?
            </button>
          </div>
        </CardContent>
        <div className="px-6 pb-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => router.push("/auth/signup")}
          >
            Create an account
          </button>
        </div>
      </Card>
    </div>
  );
}
