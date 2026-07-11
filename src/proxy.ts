import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // 프로덕션(HTTPS)에선 세션 쿠키가 `__Secure-authjs.session-token` 이름을 쓰고
  // 이 이름이 JWT 복호화 salt가 된다. secureCookie를 명시하지 않으면 getToken이
  // 개발용 쿠키명으로 찾아 복호화에 실패 → 로그인해도 /login으로 되돌아간다.
  const secureCookie = request.nextUrl.protocol === "https:";
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });
  const isLoggedIn = !!token;

  if (pathname.startsWith("/login")) {
    if (isLoggedIn) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|skhynix_logo.png).*)"],
};
