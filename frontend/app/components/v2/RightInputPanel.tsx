"use client";

import { motion } from "framer-motion";
import TabNavigation from "./TabNavigation";
import ContentSelectionPanel from "./ContentSelectionPanel";
import QuestionAnswerPanel from "./QuestionAnswerPanel";
import { QuestionContent } from "@/app/manage/question/page";
import { Question } from "@/app/manage/question/page";

interface RightInputPanelProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  course: string | undefined;
  setCourse: (course: string) => void;
  module: string[];
  setModule: (module: string[]) => void;
  slide: string[];
  setSlide: (slide: string[]) => void;
  question: QuestionContent[];
  setQuestion: (question: QuestionContent[]) => void;
  answer: string;
  setAnswer: (answer: string) => void;
  questionPreset: Question;
  questionLoading: boolean;
  isFeedbackLoading: boolean;
  isImageLoading: boolean;
  isReferenceLoading: boolean;
  saveStatus: string;
  onSubmit: () => void;
  onSaveDraftQuestion: (content: string) => void;
  questionId?: string | null;
}

export default function RightInputPanel({
  activeTab,
  setActiveTab,
  course,
  setCourse,
  module,
  setModule,
  slide,
  setSlide,
  question,
  setQuestion,
  answer,
  setAnswer,
  questionPreset,
  questionLoading,
  isFeedbackLoading,
  isImageLoading,
  isReferenceLoading,
  saveStatus,
  onSubmit,
  onSaveDraftQuestion,
  questionId,
}: RightInputPanelProps) {
  const handleContinue = () => setActiveTab("input");

  return (
    <motion.div
      className="col-span-5 z-1"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
    >
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sticky top-24 z-0">
        {/* Tabs Header */}
        <TabNavigation
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          questionId={questionId}
        />

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {activeTab === "selection" && (
            <ContentSelectionPanel
              course={course}
              setCourse={setCourse}
              module={module}
              setModule={setModule}
              slide={slide}
              setSlide={setSlide}
              onContinue={handleContinue}
              isAnyLoading={
                isFeedbackLoading || isImageLoading || isReferenceLoading
              }
            />
          )}

          {activeTab === "input" && (
            <QuestionAnswerPanel
              question={question}
              setQuestion={setQuestion}
              answer={answer}
              setAnswer={setAnswer}
              questionPreset={questionPreset}
              questionLoading={questionLoading}
              isFeedbackLoading={isFeedbackLoading}
              isImageLoading={isImageLoading}
              isReferenceLoading={isReferenceLoading}
              saveStatus={saveStatus}
              onSubmit={onSubmit}
              onSaveDraftQuestion={onSaveDraftQuestion}
            />
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
