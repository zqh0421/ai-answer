import SignIn from "@/app/components/SignIn";
import { auth } from "@/auth";
import { redirect } from 'next/navigation'

interface ManageLoginProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ManageLogin({ searchParams }: ManageLoginProps) {
    const session = await auth();
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const ltiMode = resolvedSearchParams?.lti_mode;
    const isDeepLinkMode = ltiMode === "deep_link" || (
        Array.isArray(ltiMode) && ltiMode.includes("deep_link")
    );
    if (session) return redirect(isDeepLinkMode ? '/manage?lti_mode=deep_link' : '/manage');
    return (
        <SignIn />
    )
}
