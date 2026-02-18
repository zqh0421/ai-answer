"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const LTI_MODE_KEY = "lti_mode";
const DEEP_LINK_MODE = "deep_link";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const key = `${name}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(key)) {
      return decodeURIComponent(trimmed.slice(key.length));
    }
  }
  return null;
}

export default function LtiDeepLinkBanner() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryMode = searchParams.get(LTI_MODE_KEY);
  const isDeepLinkMode = useMemo(() => {
    if (queryMode === DEEP_LINK_MODE) {
      return true;
    }
    return readCookie(LTI_MODE_KEY) === DEEP_LINK_MODE;
  }, [queryMode]);

  useEffect(() => {
    if (queryMode === DEEP_LINK_MODE) {
      document.cookie = `${LTI_MODE_KEY}=${DEEP_LINK_MODE}; path=/; SameSite=Lax`;
      return;
    }

    if (readCookie(LTI_MODE_KEY) !== DEEP_LINK_MODE) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set(LTI_MODE_KEY, DEEP_LINK_MODE);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [pathname, queryMode, router, searchParams]);

  const handleSelectForLms = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const payload = {
        resource_url: window.location.href,
        title: document.title || undefined,
        text: undefined,
      };

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
        if (bodyText.includes("Missing launch cookie")) {
          throw new Error(
            "LTI deep-link launch session is missing. Start from an LMS deep-link launch so the HttpOnly `lti_launch` cookie is set."
          );
        }
        if (bodyText.includes("Session is not a deep-linking launch")) {
          throw new Error(
            "Current LTI session is not a deep-linking launch. Re-launch the tool from LMS resource selection flow."
          );
        }
        if (bodyText.includes("Missing deep_link_return_url in session")) {
          throw new Error(
            "LTI launch session is incomplete (missing deep_link_return_url). Re-launch from LMS deep-link picker."
          );
        }
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
