import type { Metadata } from "next";
import { auth, signOut } from "@/auth";
import Link from "next/link";
import ActionButton from "@/app/components/ActionButton";
import { redirect } from 'next/navigation'
import { buildStaticPageTitle } from "@/app/utils/title";

export const metadata: Metadata = {
  title: buildStaticPageTitle("No Permission"),
};

interface NoPermissionProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NoPermission({ searchParams }: NoPermissionProps) {
  const session = await auth();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const ltiMode = resolvedSearchParams?.lti_mode;
  const launchId = resolvedSearchParams?.launch_id;
  const ltiLaunchId = resolvedSearchParams?.lti_launch_id;
  const ltiUserId = resolvedSearchParams?.lti_user_id;
  const isDeepLinkMode = ltiMode === "deep_link" || (
    Array.isArray(ltiMode) && ltiMode.includes("deep_link")
  );
  const normalizedLaunchId = Array.isArray(launchId) ? launchId[0] : launchId;
  const normalizedLtiLaunchId = Array.isArray(ltiLaunchId) ? ltiLaunchId[0] : ltiLaunchId;
  const normalizedLtiUserId = Array.isArray(ltiUserId) ? ltiUserId[0] : ltiUserId;
  const withLtiMode = (path: string) => {
    if (!isDeepLinkMode) return path;
    const params = new URLSearchParams({ lti_mode: "deep_link" });
    if (normalizedLaunchId) params.set("launch_id", normalizedLaunchId);
    if (normalizedLtiLaunchId) params.set("lti_launch_id", normalizedLtiLaunchId);
    if (normalizedLtiUserId) params.set("lti_user_id", normalizedLtiUserId);
    return `${path}?${params.toString()}`;
  };

  if (!session) return redirect(withLtiMode('/manage/login'))

  return (
    <main className="bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] px-6 py-4 md:px-8 md:py-5">
      <div className="mx-auto flex min-h-[calc(100vh-130px)] max-h-[calc(100vh-90px)] w-full max-w-[1500px] items-center justify-center">
        <section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm ring-1 ring-white md:p-8">
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Management Console
              </p>
              <h1 className="mt-3 text-2xl font-bold text-slate-900 md:text-3xl">
                No Permission
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
                Hello {session?.user?.name || session?.user?.email}. Your account does not have permission to access the management dashboard.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
              Please contact an administrator if you believe this is a mistake.
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={withLtiMode("/")}>
                <ActionButton type="button" variant="neutral" className="w-full sm:w-auto rounded-lg px-4 py-2">
                  Go to Home page
                </ActionButton>
              </Link>

              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <ActionButton type="submit" variant="ghost" className="w-full sm:w-auto rounded-lg px-4 py-2">
                  Log Out
                </ActionButton>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
