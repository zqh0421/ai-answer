"use client";

import { motion } from "framer-motion";
import HTMLFeedbackArea from "@/app/components/HTMLFeedbackArea";
import ReferenceArea from "@/app/components/ReferenceArea";
import { Reference, StructuredFeedback } from "@/app/types";

interface LeftFeedbackPanelProps {
  result: any;
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
              : (result as StructuredFeedback)?.structured_feedback || (result as any)?.feedback || ""
          }
          isFeedbackLoading={isFeedbackLoading}
          score={isStreaming ? "" : (result as StructuredFeedback)?.score || (result as any)?.score || ""}
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
        />
      )}
    </motion.div>
  );
}
