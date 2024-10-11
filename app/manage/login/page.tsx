import SignIn from "@/app/components/SignIn";
import { auth } from "@/auth";
import { redirect } from 'next/navigation'

export default async function ManageLogin() {
    const session = await auth();
    if (session) return redirect('/manage');
    return (
        <SignIn />
    )
}