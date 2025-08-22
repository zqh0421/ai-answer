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
          html={(result as StructuredFeedback).structured_feedback}
          isFeedbackLoading={false}
          score={(result as StructuredFeedback).score}
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
