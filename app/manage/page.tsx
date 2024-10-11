import { auth, signOut } from "@/auth";
// import { notFound } from "next/navigation";
import { redirect } from 'next/navigation';
import axios from "axios";
 
const HomePage = async () => {
  const session = await auth();
//  if (!session) return notFound();
  if (!session) {
    console.log('No session found, redirecting to /admin/login');
    return redirect('/manage/login');  // Ensure this is the correct path to redirect to
  }

  const handleAuth = async () => {
    axios.post(`${process.env.NEXTAUTH_URL}/api/admin-auth`, {
      email: session.user.email
    }).then((res) => {
      // if (res.data.permitted === false) {
      //   return redirect('/manage/noPermission');
      // }
      console.log(res.data); // Instead of logging the entire response object
    }).catch((err) => {
      console.error("Error during admin auth:", err.message);
      // Handle error case (e.g., show a message)
    })
    // axios.post("/api/manage-auth",
    //   { 
    //     email: session.user.email
    //   }
    // ).then((res) => {
    //   if (res.data.permitted === false) {
    //     return redirect('/manage/noPermission');
    //   }
    // }).catch((err) => {
    //   console.error("Error during admin auth:", err);
    //   // Handle error case (e.g., show a message)
    // })
  };

  await handleAuth();
  // if (await handleAuth())
  // if (session.user.email != "qianhui.zhao.qd@gmail.com") {
  //   return redirect('/manage/noPermission');
  // }
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
    </main>
  );
};
export default HomePage;