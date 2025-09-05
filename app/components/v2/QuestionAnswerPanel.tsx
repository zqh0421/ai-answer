"use client";

import { useState } from "react";
import { QuestionContent } from "@/app/manage/question/page";
import ContentEditor from "@/app/components/ContentEditor";
import DynamicImage from "@/app/components/DynamicImage";

interface QuestionAnswerPanelProps {
  question: QuestionContent[];
  setQuestion: (question: QuestionContent[]) => void;
  answer: string;
  setAnswer: (answer: string) => void;
  questionPreset: any;
  questionLoading: boolean;
  isFeedbackLoading: boolean;
  isImageLoading: boolean;
  isReferenceLoading: boolean;
  saveStatus: string;
  onSubmit: () => void;
  onSaveDraftQuestion: (content: string) => void;
  onAnswerChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onInputResize: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  useStreaming?: boolean;
  setUseStreaming?: (value: boolean) => void;
  isStreaming?: boolean;
  stopStreaming?: () => void;
  isMCQ?: boolean;
  promptVersion?: string | null;
}

export default function QuestionAnswerPanel({
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
  onAnswerChange,
  onInputResize,
  useStreaming = true,
  setUseStreaming,
  isStreaming = false,
  stopStreaming,
  isMCQ = false,
  promptVersion = null,
}: QuestionAnswerPanelProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string>("");
  
  // Determine feedback type based on prompt version
  // Default to learner feedback (no correctness indicators) when prompt version is unknown
  const isLearnerFeedback = promptVersion === "prompt_learner" || promptVersion === null;
  const isCorrectiveFeedback = promptVersion === "prompt_corrective";

  return (
    <div className="space-y-4">
      {/* Question Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-semibold text-slate-800">Question</h3>
          {!questionLoading && questionPreset?.content?.length > 0 && (
            <button
              onClick={() => setIsFullScreen(true)}
              className="px-3 py-1 text-sm bg-emerald-100 text-emerald-700 rounded-full hover:bg-emerald-200 transition-colors duration-200"
            >
              View Full
            </button>
          )}
        </div>

        {questionPreset?.content?.length > 0 ? (
          !isFullScreen ? (
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-sm text-slate-600">
                Preloaded question available
              </p>
            </div>
          ) : (
            <div
              className="fixed z-50 bg-gradient-to-br from-slate-50 to-blue-50 overflow-auto"
              style={{
                top: "var(--header-height, 60px)",
                bottom: "var(--footer-height, 60px)",
                left: 0,
                right: 0,
              }}
            >
              {/* Header */}
              <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm z-10">
                <div className="flex items-center justify-between p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center shadow-sm">
                      <svg
                        className="w-5 h-5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">
                        Question Details
                      </h2>
                      <p className="text-sm text-slate-600">
                        Full question content and materials
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsFullScreen(false)}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    Close
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="w-full p-6 space-y-6">
                {questionPreset.content && questionPreset.content.length > 0 ? (
                  questionPreset.content.map((item: any, index: number) => (
                    <div
                      key={index}
                      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                    >
                      {/* Block Counter */}
                      <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-6 py-3 border-b border-slate-200">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-600">
                            Content Block {index + 1} of{" "}
                            {questionPreset.content?.length || 0}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span className="text-xs text-slate-500 uppercase tracking-wide">
                              {item.type}
                            </span>
                          </div>
                        </div>
                      </div>

                      {item.type === "text" ? (
                        <div className="p-8">
                          <div className="prose prose-slate max-w-none">
                            <p className="text-lg leading-relaxed text-slate-700">
                              {item.content}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8">
                          <div className="flex justify-center">
                            <DynamicImage
                              src={item.content}
                              alt={`Question content ${index + 1}`}
                              className="max-w-full h-auto rounded-xl shadow-lg border border-slate-200"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    No question content available
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <ContentEditor
            contents={question}
            setContents={(newContent) => {
              setQuestion(newContent);
              const textContent =
                newContent.find((item) => item.type === "text")?.content || "";
              onSaveDraftQuestion(textContent);
            }}
          />
        )}
      </div>

      {/* Answer Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-semibold text-slate-800">
            Your Answer
          </h3>
          <p className="text-sm text-slate-500">{saveStatus}</p>
        </div>
        
        {isMCQ && questionPreset?.options?.length > 0 ? (
          <div className="space-y-3">
            {questionPreset.options.map((option: string, index: number) => {
              const isSelected = answer === option;
              const humanFeedback = questionPreset.mcq_human_feedback?.[index];
              const aiFeedback = questionPreset.mcq_ai_feedback?.[index];
              
              return (
                <div key={index} className="space-y-2">
                  <label
                    className={`flex items-center p-4 border rounded-lg cursor-pointer transition-colors duration-200 ${
                      isSelected 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mcq-option"
                      value={option}
                      checked={isSelected}
                      onChange={(e) => {
                        setAnswer(e.target.value);
                        setSelectedOption(e.target.value);
                        // Trigger the save for MCQ selection
                        const syntheticEvent = {
                          target: { value: e.target.value }
                        } as React.ChangeEvent<HTMLTextAreaElement>;
                        onAnswerChange(syntheticEvent);
                      }}
                      className="mr-3 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-slate-700 flex-1">{option}</span>
                  </label>
                  
                  {/* Show feedback if this option is selected */}
                  {isSelected && (humanFeedback || aiFeedback) && (
                    <div className="ml-8 space-y-2">
                      {/* Only show correctness indicators for corrective feedback */}
                      {isCorrectiveFeedback && (
                        <div className="flex items-center gap-2 mb-2">
                          {/* Check if this is the correct answer based on feedback content */}
                          {(humanFeedback?.toLowerCase().includes('correct') && !humanFeedback?.toLowerCase().includes('incorrect')) ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              <span className="text-sm font-medium">Correct!</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-red-600">
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                              </svg>
                              <span className="text-sm font-medium">Incorrect</span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* For learner feedback: Show neutral, encouraging feedback */}
                      {isLearnerFeedback ? (
                        <>
                          {humanFeedback && (
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                              <p className="text-sm font-medium text-blue-800 mb-1">Feedback:</p>
                              <p className="text-sm text-blue-700">{humanFeedback}</p>
                            </div>
                          )}
                          {!humanFeedback && aiFeedback && (
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                              <p className="text-sm font-medium text-blue-800 mb-1">Feedback:</p>
                              <p className="text-sm text-blue-700">{aiFeedback}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        // For corrective feedback or default: Show detailed feedback
                        <>
                          {humanFeedback && (
                            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                              <p className="text-sm font-medium text-green-800 mb-1">Expert Feedback:</p>
                              <p className="text-sm text-green-700">{humanFeedback}</p>
                            </div>
                          )}
                          {aiFeedback && (
                            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                              <p className="text-sm font-medium text-purple-800 mb-1">AI Analysis:</p>
                              <p className="text-sm text-purple-700">{aiFeedback}</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <textarea
            value={answer}
            onChange={onAnswerChange}
            placeholder="Enter your answer here..."
            className="w-full px-3 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 resize-none min-h-32"
            rows={1}
            onInput={onInputResize}
          />
        )}
      </div>
      {!isMCQ && (
        <button
          onClick={onSubmit}
          disabled={isFeedbackLoading || isImageLoading || isReferenceLoading}
          className={`
            relative w-full py-3 px-4 rounded-lg font-medium transition-all duration-300 overflow-hidden group
            ${
              isFeedbackLoading || isImageLoading || isReferenceLoading
                ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                : "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg hover:shadow-xl"
            }
          `}
        >
          {/* Subtle skewed background overlay on hover */}
          {!isFeedbackLoading && !isImageLoading && !isReferenceLoading && (
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-all duration-500 transform -skew-x-6 scale-x-0 group-hover:scale-x-100 origin-left"></div>
          )}

          {/* Button content */}
          <div className="relative z-10 flex items-center justify-center">
            {isFeedbackLoading || isImageLoading || isReferenceLoading ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>{isStreaming ? "Thinking..." : "Evaluating..."}</span>
              </div>
            ) : (
              "Submit Answer"
            )}
          </div>
        </button>
      )}
    </div>
  );
}
