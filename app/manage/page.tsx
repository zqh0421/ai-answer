import { auth, signOut } from "@/auth";
import { redirect } from 'next/navigation';
import axios from "axios";
import Link from "next/link";

interface AuthResponse {
  user: {
    email: string;
    name?: string;
  };
}
 
const Manage = async () => {
  const session = await auth() as AuthResponse;

  if (!session) {
    console.log('No session found, redirecting to /admin/login');
    return redirect('/manage/login');  // Ensure this is the correct path to redirect to
  }

  const handleAuth = async () => {
    let res;
    try {
      res = await axios.post(`${process.env.NEXTAUTH_URL}/api/admin_auth`, {
        email: session?.user.email
      });
    } catch (err) {
      if (err instanceof Error) {
        console.error("Error during admin auth:", err.message);
      } else {
        console.error("Unknown error during admin auth:", err);
      }
    }
    if (res?.data?.permitted === false) {
      return redirect('/manage/noPermission');
    }
  };

  await handleAuth();
  
  return (
    <main>
      <h1>Hello {session.user.name}</h1>

      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button type="submit">Log Out</button>
      </form>

      {/* Button to go to Manage Course Overview */}
      <section>
        <Link href="/manage/course">
          <button type="button">Go to Course Management</button>
        </Link>
      </section>
    </main>
  );
};
export default Manage;