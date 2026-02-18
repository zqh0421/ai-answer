import { auth, signOut } from "@/auth";
import { redirect } from 'next/navigation';
import axios from "axios";
import Link from "next/link";
import { headers } from "next/headers";

interface AuthResponse {
  user: {
    email: string;
    name?: string;
    image?: string;
    user_id: string;
  };
  expires: string
}
 
interface ManageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const Manage = async ({ searchParams }: ManageProps) => {
  const session = await auth() as AuthResponse;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const ltiMode = resolvedSearchParams?.lti_mode;
  const isDeepLinkMode = ltiMode === "deep_link" || (
    Array.isArray(ltiMode) && ltiMode.includes("deep_link")
  );
  const withLtiMode = (path: string) => (isDeepLinkMode ? `${path}?lti_mode=deep_link` : path);
  // console.log(session)

  if (!session) {
    console.log('No session found, redirecting to /admin/login');
    return redirect(withLtiMode('/manage/login'));  // Ensure this is the correct path to redirect to
  }

  // console.log(session.user)

  const handleAuth = async () => {
    let res;
    try {
      const headerStore = await headers();
      const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
      const proto = headerStore.get("x-forwarded-proto") ?? "http";
      const origin = host ? `${proto}://${host}` : (process.env.AUTH_URL ?? "http://localhost:3000");

      res = await axios.post(`${origin}/api/admin-auth`, {
        email: session?.user.email
      });
      // console.log("handleAuth")
      // console.log(res.data)
    } catch (err) {
      if (err instanceof Error) {
        console.error("Error during admin auth:", err.message);
      } else {
        console.error("Unknown error during admin auth:", err);
      }
    }
    if (res?.data?.permitted === false) {
      return redirect(withLtiMode('/manage/noPermission'));
    }
  };

  await handleAuth();
  
  return (
    <main className="flex flex-col gap-2">
      <h1>Hello, {session.user.name}!</h1>

      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button type="submit" className="text-blue-600">Log Out</button>
      </form>

      {/* Button to go to Manage Course Overview */}
      <section className="flex flex-col gap-2">
        <Link href={withLtiMode("/manage/course")}>
          <button type="button" className="text-blue-600">Go to Course Management</button>
        </Link>
        <Link href={withLtiMode("/manage/question")}>
          <button type="button" className="text-blue-600">Go to Question Management</button>
        </Link>
      </section>
    </main>
  );
};
export default Manage;
