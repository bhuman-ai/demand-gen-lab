import { NextRequest, NextResponse } from "next/server";
import { isAllowedOperatorEmail } from "@/lib/auth-allowlist";
import {
  AUTHENTICATED_HOME,
  AUTH_SESSION_COOKIE,
  isAuthPagePath,
  isPublicApiPath,
  isPublicPagePath,
  normalizeNextPath,
  readSignedSessionToken,
} from "@/lib/auth-session";

function loginRedirect(request: NextRequest) {
  const nextUrl = request.nextUrl.clone();
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  nextUrl.pathname = "/login";
  nextUrl.search = "";
  nextUrl.searchParams.set("next", normalizeNextPath(target));
  return NextResponse.redirect(nextUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  const session = await readSignedSessionToken(token);
  const allowedSession = session && isAllowedOperatorEmail(session.email) ? session : null;

  if (pathname.startsWith("/api/")) {
    if (isPublicApiPath(pathname)) {
      return NextResponse.next();
    }
    if (allowedSession) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (isPublicPagePath(pathname)) {
    if (allowedSession && isAuthPagePath(pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = AUTHENTICATED_HOME;
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  if (allowedSession) {
    return NextResponse.next();
  }

  return loginRedirect(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)"],
};
