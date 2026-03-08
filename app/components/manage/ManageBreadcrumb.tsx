"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

type Crumb = {
  label: string;
  href: string;
};

const SEGMENT_LABELS: Record<string, string> = {
  manage: "Management",
  course: "Courses",
  question: "Questions",
  agent: "Agents",
  login: "Sign In",
  noPermission: "No Permission",
};

const HIDDEN_PATHS = new Set(["/manage/login"]);

const sentenceCase = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatSegmentLabel = (segment: string, previous?: string) => {
  if (SEGMENT_LABELS[segment]) return sentenceCase(SEGMENT_LABELS[segment]);
  if (previous === "course") return sentenceCase("course detail");
  if (previous === "question") return sentenceCase("question detail");

  return sentenceCase(
    segment
    .split("-")
    .join(" ")
  );
};

export default function ManageBreadcrumb() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const ltiQuery = useMemo(() => {
    const params = new URLSearchParams();
    const ltiMode = searchParams.get("lti_mode");
    const launchId = searchParams.get("launch_id");
    const ltiLaunchId = searchParams.get("lti_launch_id");
    const ltiUserId = searchParams.get("lti_user_id");

    if (ltiMode) params.set("lti_mode", ltiMode);
    if (launchId) params.set("launch_id", launchId);
    if (ltiLaunchId) params.set("lti_launch_id", ltiLaunchId);
    if (ltiUserId) params.set("lti_user_id", ltiUserId);

    const query = params.toString();
    return query ? `?${query}` : "";
  }, [searchParams]);

  const crumbs = useMemo(() => {
    if (!pathname || !pathname.startsWith("/manage")) return [] as Crumb[];

    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return [] as Crumb[];

    const items: Crumb[] = [{ label: "Home", href: "/" }];
    let currentPath = "";

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      currentPath += `/${segment}`;

      items.push({
        label: formatSegmentLabel(segment, segments[i - 1]),
        href: `${currentPath}${ltiQuery}`,
      });
    }

    return items;
  }, [pathname, ltiQuery]);

  if (!pathname || !pathname.startsWith("/manage") || HIDDEN_PATHS.has(pathname) || crumbs.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-xs font-medium tracking-[0.02em] text-slate-500">
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          const isHome = index === 0;

          return (
            <li key={crumb.href} className="inline-flex items-center gap-1">
              {index > 0 ? <span className="text-slate-400">/</span> : null}
              {isCurrent ? (
                <span aria-current="page" className="inline-flex items-center gap-1 text-slate-700">
                  {isHome ? (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="M9.25 2.79a1.2 1.2 0 0 1 1.5 0l6.25 4.95a1.2 1.2 0 0 1 .46.94v7.07c0 .66-.54 1.2-1.2 1.2h-3.11a1 1 0 0 1-1-1v-3.58a.4.4 0 0 0-.4-.4H8.25a.4.4 0 0 0-.4.4v3.58a1 1 0 0 1-1 1H3.74c-.66 0-1.2-.54-1.2-1.2V8.68c0-.36.16-.7.46-.94l6.25-4.95Z" />
                    </svg>
                  ) : null}
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="inline-flex items-center gap-1 text-slate-500 hover:text-blue-700">
                  {isHome ? (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="M9.25 2.79a1.2 1.2 0 0 1 1.5 0l6.25 4.95a1.2 1.2 0 0 1 .46.94v7.07c0 .66-.54 1.2-1.2 1.2h-3.11a1 1 0 0 1-1-1v-3.58a.4.4 0 0 0-.4-.4H8.25a.4.4 0 0 0-.4.4v3.58a1 1 0 0 1-1 1H3.74c-.66 0-1.2-.54-1.2-1.2V8.68c0-.36.16-.7.46-.94l6.25-4.95Z" />
                    </svg>
                  ) : null}
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
