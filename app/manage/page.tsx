import { auth, signOut } from "@/auth";
import { redirect } from 'next/navigation';
import axios from "axios";
import Link from "next/link";

interface AuthResponse {
  user: {
    email: string;
    name?: string;
    image?: string;
    user_id: string;
  };
  expires: string
}
 
const Manage = async () => {
  const session = await auth() as AuthResponse;
  // console.log(session)

  if (!session) {
    console.log('No session found, redirecting to /admin/login');
    return redirect('/manage/login');  // Ensure this is the correct path to redirect to
  }

  // console.log(session.user)

  const handleAuth = async () => {
    let res;
    try {
      res = await axios.post(`${process.env.NEXTAUTH_URL}/api/admin_auth`, {
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
      return redirect('/manage/noPermission');
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
        <Link href="/manage/course">
          <button type="button" className="text-blue-600">Go to Course Management</button>
        </Link>
        <Link href="/manage/question">
          <button type="button" className="text-blue-600">Go to Question Management</button>
        </Link>
      </section>
    </main>
  );
};
export default Manage;