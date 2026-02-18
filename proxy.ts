import { NextRequest, NextResponse } from "next/server";

const LTI_MODE_KEY = "lti_mode";
const DEEP_LINK_MODE = "deep_link";

export function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.next();
  }

  const url = request.nextUrl;
  const queryMode = url.searchParams.get(LTI_MODE_KEY);
  const cookieMode = request.cookies.get(LTI_MODE_KEY)?.value;

  if (queryMode === DEEP_LINK_MODE) {
    const response = NextResponse.next();
    response.cookies.set(LTI_MODE_KEY, DEEP_LINK_MODE, {
      path: "/",
      sameSite: "lax",
    });
    return response;
  }

  if (cookieMode === DEEP_LINK_MODE) {
    const redirectUrl = url.clone();
    redirectUrl.searchParams.set(LTI_MODE_KEY, DEEP_LINK_MODE);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
