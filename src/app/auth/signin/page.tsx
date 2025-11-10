"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") || "/";
  const error = searchParams?.get("error");
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    // Let NextAuth handle the OAuth redirect flow normally
    await signIn("azure-ad", { callbackUrl });
    // Note: If this line executes, sign-in was cancelled or failed
    setIsSigningIn(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <Image
              src="/logo.png"
              alt="Sparq Systems Logo"
              width={80}
              height={80}
              priority
            />
          </div>
          <CardTitle className="text-2xl text-center">Burnin Test Dashboard</CardTitle>
          <CardDescription className="text-center">
            Sign in with your Sparq Systems account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/15 p-3 text-sm text-destructive">
              {error === "AccessDenied" && (
                <>
                  <strong>Access Denied</strong>
                  <p className="mt-1">
                    Only Sparq Systems email addresses (@sparqsys.com) are allowed to access this
                    application.
                  </p>
                </>
              )}
              {error === "OAuthAccountNotLinked" && (
                <>
                  <strong>Account Error</strong>
                  <p className="mt-1">
                    This account is already linked to another provider. Please contact support.
                  </p>
                </>
              )}
              {error !== "AccessDenied" && error !== "OAuthAccountNotLinked" && (
                <>
                  <strong>Sign-in Error</strong>
                  <p className="mt-1">An error occurred during sign-in. Please try again.</p>
                </>
              )}
            </div>
          )}

          <Button
            onClick={handleSignIn}
            className="w-full cursor-pointer"
            size="lg"
            disabled={isSigningIn}
          >
            {isSigningIn ? (
              <>
                <svg
                  className="mr-2 h-5 w-5 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Redirecting to Microsoft...
              </>
            ) : (
              <>
                <svg
                  className="mr-2 h-5 w-5"
                  viewBox="0 0 23 23"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M11 0H0V11H11V0Z" fill="#F25022" />
                  <path d="M23 0H12V11H23V0Z" fill="#7FBA00" />
                  <path d="M11 12H0V23H11V12Z" fill="#00A4EF" />
                  <path d="M23 12H12V23H23V12Z" fill="#FFB900" />
                </svg>
                Sign in with Microsoft
              </>
            )}
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            <p>Restricted to @sparqsys.com email addresses</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
