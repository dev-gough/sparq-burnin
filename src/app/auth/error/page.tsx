"use client";

import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function AuthErrorPage() {
  const searchParams = useSearchParams();
  const error = searchParams?.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center text-destructive">
            Authentication Error
          </CardTitle>
          <CardDescription className="text-center">
            There was a problem signing you in
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-destructive/15 p-4 text-sm">
            {error === "AccessDenied" && (
              <>
                <strong className="text-destructive">Access Denied</strong>
                <p className="mt-2 text-muted-foreground">
                  Only Sparq Systems email addresses (@sparqsys.com) are allowed to access this
                  application. Please sign in with your work email address.
                </p>
              </>
            )}
            {error === "Configuration" && (
              <>
                <strong className="text-destructive">Configuration Error</strong>
                <p className="mt-2 text-muted-foreground">
                  There is a problem with the server configuration. Please contact the administrator.
                </p>
              </>
            )}
            {!error || (error !== "AccessDenied" && error !== "Configuration") && (
              <>
                <strong className="text-destructive">Unknown Error</strong>
                <p className="mt-2 text-muted-foreground">
                  An unexpected error occurred. Please try again or contact support if the problem
                  persists.
                </p>
              </>
            )}
          </div>

          <Button asChild className="w-full">
            <Link href="/auth/signin">Back to Sign In</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
