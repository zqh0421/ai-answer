"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Pencil } from "lucide-react";
import { getAndrewIdFromCookie } from "@/app/utils/andrewIdCookie";

export default function Header() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [displayLearnerId, setDisplayLearnerId] = useState<string | null>(null);

  const isQuestionPage = useMemo(
    () => pathname.startsWith("/question/") || pathname.startsWith("/mcq/") || pathname.startsWith("/oeq/"),
    [pathname]
  );
  const debugModeEnabled = useMemo(() => String(searchParams.get("debug") ?? "").trim() === "1", [searchParams]);

  useEffect(() => {
    if (!isQuestionPage) {
      setDisplayLearnerId(null);
      return;
    }
    if (debugModeEnabled) {
      const learnerIdFromUrl = String(searchParams.get("learner_id") ?? "").trim();
      setDisplayLearnerId(learnerIdFromUrl || "test_learner_auto");
      return;
    }
    setDisplayLearnerId(getAndrewIdFromCookie());
  }, [debugModeEnabled, isQuestionPage, searchParams]);

  useEffect(() => {
    const handleAndrewIdUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ andrewId?: string }>;
      const nextValue = String(customEvent.detail?.andrewId ?? "").trim();
      setDisplayLearnerId(nextValue || null);
    };

    const handleLearnerIdUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ learnerId?: string }>;
      const nextValue = String(customEvent.detail?.learnerId ?? "").trim();
      if (!nextValue) return;
      setDisplayLearnerId(nextValue);
    };

    window.addEventListener("andrew-id-updated", handleAndrewIdUpdated as EventListener);
    window.addEventListener("learner-id-updated", handleLearnerIdUpdated as EventListener);
    return () => {
      window.removeEventListener("andrew-id-updated", handleAndrewIdUpdated as EventListener);
      window.removeEventListener("learner-id-updated", handleLearnerIdUpdated as EventListener);
    };
  }, []);

  const handleOpenAndrewIdModal = () => {
    window.dispatchEvent(new CustomEvent("open-andrew-id-modal"));
  };

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="w-40" />
          <h1 className="text-lg font-bold">
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              SlideItRight
            </span>
            <span className="text-slate-600 font-normal ml-1">
              Feedback System
            </span>
          </h1>
          <div className="w-40 flex items-center justify-end">
            {isQuestionPage ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learner ID</span>
                <span className="font-mono text-xs text-slate-900">{displayLearnerId || "Not set"}</span>
                {!debugModeEnabled ? (
                  <button
                    type="button"
                    onClick={handleOpenAndrewIdModal}
                    className="rounded p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                    aria-label="Edit learner ID"
                    title="Edit learner ID"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
