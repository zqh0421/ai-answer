"use client";

import { Suspense, use, useEffect, useMemo, useState } from "react";
import axios from "axios";

import McqQuestionPage from "@/app/mcq/[questionId]/page";
import OeqQuestionPage from "@/app/oeq/[questionId]/page";

type RouteMode = "mcq" | "oeq";

type QuestionPayload = {
  question_type?: string;
  type?: string;
  question?: {
    question_type?: string;
    type?: string;
  };
  item?: {
    question_type?: string;
    type?: string;
  };
  data?: {
    question_type?: string;
    type?: string;
  };
};

const isMcqLikeType = (value: unknown): boolean => {
  const normalized = String(value ?? "").toLowerCase();
  return (
    normalized.includes("choice") ||
    normalized.includes("true_false") ||
    normalized.includes("dropdown") ||
    normalized.includes("mcq")
  );
};

const resolveQuestionType = (raw: QuestionPayload): RouteMode => {
  const topLevelType = raw?.question_type ?? raw?.type;
  if (isMcqLikeType(topLevelType)) return "mcq";

  const nestedType =
    raw?.question?.question_type ??
    raw?.question?.type ??
    raw?.item?.question_type ??
    raw?.item?.type ??
    raw?.data?.question_type ??
    raw?.data?.type;

  return isMcqLikeType(nestedType) ? "mcq" : "oeq";
};

function QuestionRouter({
  qid,
  searchParams,
}: {
  qid: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const [mode, setMode] = useState<RouteMode | null>(null);

  useEffect(() => {
    if (!qid) {
      setMode("oeq");
      return;
    }

    let active = true;

    axios
      .get<QuestionPayload>(`/api/questions/${encodeURIComponent(qid)}`)
      .then((res) => {
        if (!active) return;
        setMode(resolveQuestionType(res.data ?? {}));
      })
      .catch((error) => {
        console.error("Failed to resolve question type for unified route:", error);
        if (active) setMode("oeq");
      });

    return () => {
      active = false;
    };
  }, [qid]);

  const childParams = useMemo(() => Promise.resolve({ questionId: qid }), [qid]);
  const childSearchParams = useMemo(() => Promise.resolve(searchParams), [searchParams]);

  if (!mode) {
    return (
      <div className="px-3 pb-3 pt-4 md:px-4 md:pb-4 md:pt-5">
        <section className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 space-y-2">
            <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
          </div>
        </section>
        <div className="grid h-full grid-cols-11 gap-2">
          <div className="col-span-11 h-56 animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-6" />
          <div className="col-span-11 h-56 animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-5" />
        </div>
      </div>
    );
  }

  if (mode === "mcq") {
    return <McqQuestionPage params={childParams} searchParams={childSearchParams} />;
  }

  return <OeqQuestionPage params={childParams} searchParams={childSearchParams} />;
}

export default function UnifiedQuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ qid?: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = use(params);
  const resolvedSearchParams = use(searchParams);
  const qid = resolvedParams?.qid ?? "";

  return (
    <Suspense
      fallback={
        <div className="px-3 pb-3 pt-4 md:px-4 md:pb-4 md:pt-5">
          <section className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 space-y-2">
              <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
            </div>
          </section>
          <div className="grid h-full grid-cols-11 gap-2">
            <div className="col-span-11 h-56 animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-6" />
            <div className="col-span-11 h-56 animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-5" />
          </div>
        </div>
      }
    >
      <QuestionRouter qid={qid} searchParams={resolvedSearchParams} />
    </Suspense>
  );
}
