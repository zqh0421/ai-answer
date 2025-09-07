"use client";

import { motion } from "framer-motion";
import HTMLFeedbackArea from "@/app/components/HTMLFeedbackArea";
import ReferenceArea from "@/app/components/ReferenceArea";
import { Reference, StructuredFeedback } from "@/app/types";

interface LeftFeedbackPanelProps {
  result: string | StructuredFeedback | { feedback?: string; score?: string; structured_feedback?: string };
  reference: Reference | undefined;
  isReferenceLoading: boolean;
  images: string[] | null;
  isImageLoading: boolean;
  loadedCount: number;
  totalCount: number;
  onImageClick: (image: string, index: number) => void;
  studentAnswer: string;
  feedback: string;
  showFeedback?: boolean;
  showReference?: boolean;
  isStreaming?: boolean;
  streamingContent?: string;
  isFeedbackLoading?: boolean;
  promptVersion?: string | null;
  question?: string | any[];
  options?: any[];
  correctAnswer?: string;
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
  feedback,
  showFeedback = true,
  showReference = true,
  isStreaming = false,
  streamingContent = "",
  isFeedbackLoading = false,
  promptVersion = null,
  question,
  options,
  correctAnswer,
}: LeftFeedbackPanelProps) {
  return (
    <motion.div
      className="col-span-6 space-y-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      {/* Feedback and Answer */}
      {showFeedback && (
        <HTMLFeedbackArea
          html={isStreaming 
            ? streamingContent 
            : typeof result === 'string' 
              ? result 
              : 'structured_feedback' in result 
                ? result.structured_feedback || result.feedback || ""
                : 'feedback' in result 
                  ? result.feedback || ""
                  : ""
          }
          isFeedbackLoading={isFeedbackLoading}
          score={isStreaming ? "" : 
            typeof result !== 'string' && 'score' in result 
              ? result.score || "" 
              : ""}
          isStreaming={isStreaming}
          promptVersion={promptVersion}
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
          feedback={feedback}
          question={question}
          options={options}
          correctAnswer={correctAnswer}
        />
      )}
    </motion.div>
  );
}
