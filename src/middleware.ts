import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Check if authentication should be skipped (for local development)
const shouldSkipAuth = process.env.SKIP_AUTH === 'true';

function addSecurityHeaders(response: NextResponse) {
  const headers = response.headers;

  // HSTS - only in production (requires HTTPS)
  if (process.env.NODE_ENV === 'production') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Prevent clickjacking
  headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  headers.set('X-Content-Type-Options', 'nosniff');

  // Legacy XSS protection (for older browsers)
  headers.set('X-XSS-Protection', '1; mode=block');

  // Control referrer information
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy - restrict sensitive features
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

// Middleware handler that conditionally applies authentication
export default function middleware(req: NextRequest) {
  // If auth is disabled (local dev), just add security headers and continue
  if (shouldSkipAuth) {
    console.log('[Middleware] SKIP_AUTH enabled - bypassing authentication');
    const response = NextResponse.next();
    return addSecurityHeaders(response);
  }

  // Otherwise, use NextAuth authentication
  return auth((req) => {
    const isAuthenticated = !!req.auth;
    const { pathname } = req.nextUrl;

    // Allow access to auth pages and API routes
    if (
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/auth/")
    ) {
      return NextResponse.next();
    }

    // Redirect unauthenticated users to sign-in page
    if (!isAuthenticated) {
      const signInUrl = new URL("/auth/signin", req.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }

    // Allow authenticated users to proceed with security headers
    const response = NextResponse.next();
    return addSecurityHeaders(response);
  })(req);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth).*)",
    "/api/((?!auth).*)",
  ],
};
