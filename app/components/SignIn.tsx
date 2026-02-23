import { headers } from "next/headers"
import { signIn } from "@/auth"
 
export default function SignIn() {
  return (
    <form
      action={async () => {
        "use server"
        const h = await headers()
        const forwardedProto = h.get("x-forwarded-proto")
        const forwardedHost = h.get("x-forwarded-host")
        const host = forwardedHost || h.get("host")
        const origin = host ? `${forwardedProto || "https"}://${host}` : undefined
        await signIn("google", origin ? { redirectTo: origin } : undefined)
      }}
    >
      <button type="submit">Signin with Google</button>
    </form>
  )
}
