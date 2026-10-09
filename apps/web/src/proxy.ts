import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic auth gate. Only checks that a session cookie exists; real
 * authorization happens in requireSession / requireWorkspaceAccess on the
 * server, where the session is validated against the database.
 */
const PROTECTED_PREFIXES = ["/w/", "/account", "/workspaces"];
const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  if (isProtected && !hasSession) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (hasSession && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
