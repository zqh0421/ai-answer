import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

function normalizeAuthUrl() {
  const candidates = [
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.DEVELOPMENT_FRONTEND_URL,
    process.env.PUBLIC_BASE_URL,
    "http://localhost:3000",
  ];

  for (const value of candidates) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      const normalized = parsed.origin;
      process.env.AUTH_URL = normalized;
      process.env.NEXTAUTH_URL = normalized;
      return;
    } catch {
      continue;
    }
  }
}

normalizeAuthUrl();
 
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [ Google ],
  debug: true,  // Enable debugging to help see more logs
  trustHost: true,  // Disable strict host matching
})
