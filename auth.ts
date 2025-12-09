import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
 
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [ Google ],
  debug: true,  // Enable debugging to help see more logs
  trustHost: true,  // Disable strict host matching
})