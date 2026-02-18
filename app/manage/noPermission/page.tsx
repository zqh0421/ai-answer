import { auth, signOut } from "@/auth";
import { redirect } from 'next/navigation'

interface NoPermissionProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NoPermission({ searchParams }: NoPermissionProps) {
  const session = await auth();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const ltiMode = resolvedSearchParams?.lti_mode;
  const isDeepLinkMode = ltiMode === "deep_link" || (
    Array.isArray(ltiMode) && ltiMode.includes("deep_link")
  );
  const withLtiMode = (path: string) => (isDeepLinkMode ? `${path}?lti_mode=deep_link` : path);

  if (!session) return redirect(withLtiMode('/manage/login'))

  return (
    <div>
      <h1>Hello {session?.user?.name}</h1>
      <h1>You do not have permission to access this page.</h1>
      <a href={withLtiMode("/")}>Go back to Home</a>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button type="submit">Log Out</button>
      </form>
    </div>
  );
}
