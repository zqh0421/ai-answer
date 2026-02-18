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
    const launchId = resolvedSearchParams?.launch_id;
    const isDeepLinkMode = ltiMode === "deep_link" || (
        Array.isArray(ltiMode) && ltiMode.includes("deep_link")
    );
    const normalizedLaunchId = Array.isArray(launchId) ? launchId[0] : launchId;
    if (session) {
        if (!isDeepLinkMode) return redirect('/manage');
        const params = new URLSearchParams({ lti_mode: "deep_link" });
        if (normalizedLaunchId) params.set("launch_id", normalizedLaunchId);
        return redirect(`/manage?${params.toString()}`);
    }
    return (
        <SignIn />
    )
}
