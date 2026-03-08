import type { Metadata } from "next";
import { auth, signOut } from "@/auth";
import { redirect } from 'next/navigation';
import axios from "axios";
import Link from "next/link";
import ActionButton from '@/app/components/ActionButton';
import ManageBreadcrumb from "@/app/components/manage/ManageBreadcrumb";
import { buildStaticPageTitle } from "@/app/utils/title";

export const metadata: Metadata = {
  title: buildStaticPageTitle("Management Dashboard"),
};

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
  // console.log(session)

  if (!session) {
    console.log('No session found, redirecting to /admin/login');
    return redirect(withLtiMode('/manage/login'));  // Ensure this is the correct path to redirect to
  }

  if (isDeepLinkMode) {
    return redirect(withLtiMode('/lti/questions'));
  }

  // console.log(session.user)

  const handleAuth = async () => {
    const backendUrl =
      process.env.NODE_ENV === "production"
        ? process.env.PRODUCTION_BACKEND_URL
        : process.env.DEVELOPMENT_BACKEND_URL;

    if (!backendUrl) {
      throw new Error("Missing backend URL for admin permission check.");
    }

    let res;
    try {
      res = await axios.post(`${backendUrl}/api/admin_auth`, {
        email: session?.user.email
      });
    } catch (err) {
      if (err instanceof Error) {
        console.error("Error during admin auth:", err.message);
      } else {
        console.error("Unknown error during admin auth:", err);
      }
      // Do not mislabel backend/network failures as "no permission".
      throw err instanceof Error ? err : new Error("Admin permission check failed.");
    }
    console.log("Admin permission check:", {
      email: session?.user.email,
      source: "/api/admin_auth",
      permitted: res?.data?.permitted,
      response: res?.data,
    });
    if (res?.data?.permitted === false) {
      return redirect(withLtiMode('/manage/noPermission'));
    }
    if (res?.data?.permitted !== true) {
      throw new Error("Unexpected admin permission response.");
    }
  };

  await handleAuth();
  
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
        <section className="">
          <ManageBreadcrumb />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Management Console
              </p>
              <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
                Hello, {session.user.name || session.user.email}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                Manage courses and questions from a single dashboard with the same tools and styling used across the admin experience.
              </p>
            </div>
            <form
              className="shrink-0 md:pt-1"
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <ActionButton type="submit" variant="ghost" className="rounded-lg px-3.5 py-2">
                Log Out
              </ActionButton>
            </form>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm ring-1 ring-white md:p-5">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Manage Content</h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose an area to continue.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Link
              href={withLtiMode("/manage/course")}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-white transition hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-md"
            >
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">
                    Courses
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900 group-hover:text-blue-800">
                    Course Management
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Create, search, sort, and maintain course records and course-level content.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 group-hover:text-blue-700">
                  Open
                  <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>

            <Link
              href={withLtiMode("/manage/agent")}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-white transition hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-md"
            >
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">
                    Agents
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900 group-hover:text-blue-800">
                    Agent Management
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Manage agent configurations, metadata, and related content workflows.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 group-hover:text-blue-700">
                  Open
                  <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>

            <Link
              href={withLtiMode("/manage/question")}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-white transition hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-md"
            >
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">
                    Questions
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900 group-hover:text-blue-800">
                    Question Management
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Review and manage question items, metadata, and related assessment content.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 group-hover:text-blue-700">
                  Open
                  <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
};
export default Manage;
