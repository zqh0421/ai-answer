import { headers } from "next/headers"
import { signIn } from "@/auth"
 
interface SignInProps {
  redirectTo?: string
}

export default function SignIn({ redirectTo = "/manage" }: SignInProps) {
  return (
    <form
      className="w-full"
      action={async () => {
        "use server"
        const h = await headers()
        const forwardedProto = h.get("x-forwarded-proto")
        const forwardedHost = h.get("x-forwarded-host")
        const host = forwardedHost || h.get("host")
        const origin = host ? `${forwardedProto || "https"}://${host}` : undefined
        const resolvedRedirectTo =
          origin && redirectTo.startsWith("/")
            ? `${origin}${redirectTo}`
            : redirectTo
        await signIn("google", { redirectTo: resolvedRedirectTo })
      }}
    >
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
      >
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
          <path
            fill="#EA4335"
            d="M12 10.2v3.9h5.4c-.2 1.2-.9 2.2-1.9 2.9l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.4-.2-2H12z"
          />
          <path
            fill="#34A853"
            d="M12 22c2.6 0 4.8-.9 6.4-2.5l-3.1-2.4c-.9.6-2 .9-3.3.9-2.5 0-4.6-1.7-5.3-4H3.5v2.5C5.1 19.8 8.3 22 12 22z"
          />
          <path
            fill="#4A90E2"
            d="M6.7 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.5H3.5C2.9 8.8 2.5 10.4 2.5 12s.4 3.2 1 4.5L6.7 14z"
          />
          <path
            fill="#FBBC05"
            d="M12 6.1c1.4 0 2.6.5 3.6 1.4l2.7-2.7C16.8 3.2 14.6 2 12 2 8.3 2 5.1 4.2 3.5 7.5l3.2 2.5c.7-2.3 2.8-3.9 5.3-3.9z"
          />
        </svg>
        Sign in with Google
      </button>
    </form>
  )
}
