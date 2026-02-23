import type { Metadata } from "next";
import SignIn from "@/app/components/SignIn";
import { auth } from "@/auth";
import { redirect } from 'next/navigation'
import { buildStaticPageTitle } from "@/app/utils/title";

export const metadata: Metadata = {
    title: buildStaticPageTitle("Manage Login"),
};

interface ManageLoginProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ManageLogin({ searchParams: _searchParams }: ManageLoginProps) {
    const resolvedSearchParams = _searchParams ? await _searchParams : undefined;
    const ltiMode = resolvedSearchParams?.lti_mode;
    const launchId = resolvedSearchParams?.launch_id;
    const isDeepLinkMode = ltiMode === "deep_link" || (
        Array.isArray(ltiMode) && ltiMode.includes("deep_link")
    );
    const normalizedLaunchId = Array.isArray(launchId) ? launchId[0] : launchId;
    const withLtiMode = (path: string) => {
        if (!isDeepLinkMode) return path;
        const params = new URLSearchParams({ lti_mode: "deep_link" });
        if (normalizedLaunchId) params.set("launch_id", normalizedLaunchId);
        return `${path}?${params.toString()}`;
    };

    const session = await auth();
    if (session) {
        return redirect(withLtiMode(isDeepLinkMode ? '/lti/questions' : '/manage'));
    }
    return (
        <main className="bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] px-6 py-4 md:px-8 md:py-5">
            <div className="mx-auto flex min-h-[calc(100vh-90px)] max-h-[calc(100vh-90px)] w-full max-w-[1500px] items-center justify-center">
                <section className="w-full max-w-xl -translate-y-2 rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm ring-1 ring-white md:-translate-y-6 md:p-8">
                    <div className="mb-8">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Management Console
                        </p>
                        <h1 className="mt-3 text-2xl font-bold text-slate-900 md:text-3xl">
                            Sign In
                        </h1>
                        <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
                            Access the management dashboard.
                        </p>
                    </div>

                    <div className="pt-1">
                        <SignIn redirectTo={withLtiMode(isDeepLinkMode ? "/lti/questions" : "/manage")} />
                    </div>
                </section>
            </div>
        </main>
    )
}
