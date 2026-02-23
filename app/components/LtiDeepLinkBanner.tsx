"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildDeepLinkPayloadTitle } from "@/app/utils/title";

const LTI_MODE_KEY = "lti_mode";
const DEEP_LINK_MODE = "deep_link";
const LEARN_MODE = "learn";
const LAUNCH_ID_KEY = "launch_id";

export default function LtiDeepLinkBanner() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryMode = searchParams.get(LTI_MODE_KEY);
  const isDeepLinkMode = useMemo(() => queryMode === DEEP_LINK_MODE, [queryMode]);

  useEffect(() => {
    if (queryMode !== DEEP_LINK_MODE) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set(LTI_MODE_KEY, DEEP_LINK_MODE);
    const query = nextParams.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;
    if (nextUrl !== `${pathname}?${searchParams.toString()}`) {
      router.replace(nextUrl);
    }
  }, [pathname, queryMode, router, searchParams]);

  const handleSelectForLms = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const payload = {
        resource_url: (() => {
          const resourceUrl = new URL(window.location.href);
          resourceUrl.searchParams.set(LTI_MODE_KEY, LEARN_MODE);
          resourceUrl.searchParams.delete(LAUNCH_ID_KEY);
          return resourceUrl.toString();
        })(),
        title: buildDeepLinkPayloadTitle({
          documentTitle: document.title || "Resource - SlideItRight Feedback System",
          pathname: window.location.pathname,
        }),
        text: "",
      };

      console.log("[LTI deep-link] complete payload", payload);

      const response = await fetch("/api/lti/deep-link/complete", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.text();
      if (!response.ok) {
        const bodyText = responseBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(
          `LTI deep-link completion failed: ${response.status}${bodyText ? ` - ${bodyText}` : ""}`
        );
      }

      // Render returned auto-post HTML in document context so LMS handoff executes.
      document.open();
      document.write(responseBody);
      document.close();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to complete LTI deep link. Please try again.");
      setIsSubmitting(false);
    }
  };

  if (!isDeepLinkMode) {
    return null;
  }

  return (
    <section className="w-full border-b border-amber-300 bg-amber-50">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-amber-900">LTI Resource Selection Mode</p>
          <p className="text-sm text-amber-800">Pick this page/resource to return to your LMS.</p>
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
        <button
          type="button"
          onClick={handleSelectForLms}
          disabled={isSubmitting}
          className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Selecting..." : "Select for LMS"}
        </button>
      </div>
    </section>
  );
}
