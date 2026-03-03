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

  if (!mode) return <div>Loading question...</div>;

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
    <Suspense fallback={<div>Loading...</div>}>
      <QuestionRouter qid={qid} searchParams={resolvedSearchParams} />
    </Suspense>
  );
}
