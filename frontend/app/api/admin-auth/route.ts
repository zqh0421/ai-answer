// app/api/admin-auth/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Hello, Next.js API!' });
}