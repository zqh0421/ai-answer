import { auth, signOut } from "@/auth";
import { redirect } from 'next/navigation'

export default async function NoPermission() {
  const session = await auth();
  if (!session) return redirect('/manage/login')

  return (
    <div>
      <h1>You do not have permission to access this page.</h1>
      <a href="/">Go back to Home</a>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button type="submit">Log Out</button>
      </form>
    </div>
  );
}