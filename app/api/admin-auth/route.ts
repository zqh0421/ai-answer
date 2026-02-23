import { NextRequest, NextResponse } from "next/server";

function parseAdminAllowlist() {
  const raw = process.env.ADMIN_EMAILS ?? process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = (body?.email ?? "").toString().trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { permitted: false, reason: "email is required" },
        { status: 400 }
      );
    }

    const allowlist = parseAdminAllowlist();
    const permitted = allowlist.length === 0 ? true : allowlist.includes(email);

    return NextResponse.json({ permitted });
  } catch {
    return NextResponse.json(
      { permitted: false, reason: "invalid request body" },
      { status: 400 }
    );
  }
}
