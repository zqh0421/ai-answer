"use client";

import { motion } from "framer-motion";
import HTMLFeedbackArea from "@/app/components/HTMLFeedbackArea";
import ReferenceArea from "@/app/components/ReferenceArea";
import { Reference, StructuredFeedback } from "@/app/types";

interface LeftFeedbackPanelProps {
  result:
    | string
    | StructuredFeedback
    | {
        feedback?: string;
        is_structured?: boolean;
        hide_structured_feedback_in_ui?: boolean;
        scoring_only?: boolean;
        score?: string | number;
        max_score?: string | number;
        structured_feedback?: string;
        text_feedback?: string;
      };
  reference: Reference | undefined;
  isReferenceLoading: boolean;
  images: string[] | null;
  isImageLoading: boolean;
  loadedCount: number;
  totalCount: number;
  onImageClick: (image: string, index: number) => void;
  studentAnswer: string;
  showFeedback?: boolean;
  showReference?: boolean;
  isStreaming?: boolean;
  streamingContent?: string;
  isFeedbackLoading?: boolean;
  hasSubmitted?: boolean;
  promptVersion?: string | null;
  question?: string | any[];
  options?: any[];
  correctAnswer?: string;
  recordId?: string | null; // Add recordId prop for rating functionality
  sessionId?: string;
  participantId?: string | null;
  debugEnabled?: boolean;
  debugData?: unknown;
}

export default function LeftFeedbackPanel({
  result,
  reference,
  isReferenceLoading,
  images,
  isImageLoading,
  loadedCount,
  totalCount,
  onImageClick,
  studentAnswer,
  showFeedback = true,
  showReference = true,
  isStreaming = false,
  streamingContent = "",
  isFeedbackLoading = false,
  hasSubmitted = false,
  promptVersion = null,
  question,
  options,
  correctAnswer,
  recordId,
  sessionId,
  participantId,
  debugEnabled = false,
  debugData,
}: LeftFeedbackPanelProps) {
  const feedbackHtml = (() => {
    if (isStreaming) return streamingContent;
    if (typeof result === "string") return result;
    const hideStructuredFeedbackInUI = Boolean((result as any).hide_structured_feedback_in_ui);
    if (hideStructuredFeedbackInUI) {
      // In scoring-only flows, keep score/max_score but hide structured feedback copy.
      return result.text_feedback || "";
    }

    if ("is_structured" in result && typeof result.is_structured === "boolean") {
      return result.is_structured
        ? result.structured_feedback || result.feedback || ""
        : result.text_feedback || result.feedback || "";
    }
    if ("structured_feedback" in result) {
      return result.structured_feedback || result.text_feedback || result.feedback || "";
    }
    if ("text_feedback" in result) {
      return result.text_feedback || result.feedback || "";
    }
    if ("feedback" in result) return result.feedback || "";
    return "";
  })();

  const feedbackScore = isStreaming || typeof result === "string" ? undefined : result.score;
  const feedbackMaxScore =
    isStreaming || typeof result === "string" ? undefined : ("max_score" in result ? result.max_score : undefined);

  return (
    <motion.div
      className="order-2 col-span-11 space-y-6 lg:order-1 lg:col-span-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      {/* Feedback and Answer */}
      {showFeedback && (
        <HTMLFeedbackArea
          html={feedbackHtml}
          isFeedbackLoading={isFeedbackLoading}
          hasSubmitted={hasSubmitted}
          score={feedbackScore}
          maxScore={feedbackMaxScore}
          isStreaming={isStreaming}
          promptVersion={promptVersion}
          recordId={recordId}
        />
      )}

      {showReference && (
        <ReferenceArea
          reference={reference}
          isReferenceLoading={isReferenceLoading}
          images={images}
          isImageLoading={isImageLoading}
          loadedCount={loadedCount}
          totalCount={totalCount}
          onImageClick={onImageClick}
          studentAnswer={studentAnswer}
          feedback={feedbackHtml}
          question={question}
          options={options}
          correctAnswer={correctAnswer}
          recordId={recordId}
          sessionId={sessionId}
          participantId={participantId}
          debugEnabled={debugEnabled}
          debugData={debugData}
        />
      )}

      {debugEnabled ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Debug Backend Payload
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-amber-200 bg-white p-2 text-[11px] text-slate-700">
            {JSON.stringify(debugData ?? null, null, 2)}
          </pre>
        </div>
      ) : null}
    </motion.div>
  );
}
