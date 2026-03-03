"use client";

import { useMemo, useState, useEffect } from "react";
import { QuestionContent } from "@/app/manage/question/page";
import ContentEditor from "@/app/components/ContentEditor";
import DynamicImage from "@/app/components/DynamicImage";
import axios from "axios";

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
  questionId?: string;
  participantId?: string;
  courseVersion?: string | null;
  showQuestion?: boolean;
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
  questionId,
  participantId,
  courseVersion = null,
  showQuestion = false,
}: QuestionAnswerPanelProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(
    null
  );

  // Determine feedback type based on prompt version
  // Default to learner feedback (no correctness indicators) when prompt version is unknown
  const isLearnerFeedback =
    promptVersion === "prompt_learner" || promptVersion === null;
  const isCorrectiveFeedback = promptVersion === "prompt_corrective";

  const mcqOptions = useMemo(() => {
    const asArray = (value: any) => (Array.isArray(value) ? value : []);
    const direct = asArray(questionPreset?.options);
    const interactionOptions =
      asArray(questionPreset?.interactions)?.flatMap((interaction: any) =>
        asArray(interaction?.options).length > 0
          ? asArray(interaction.options)
          : asArray(interaction?.interaction_options)
      ) || [];
    const fallback = asArray(questionPreset?.interaction_options);
    const merged = direct.length > 0 ? direct : interactionOptions.length > 0 ? interactionOptions : fallback;

    return merged
      .map((option: any) => {
        if (typeof option === "string") {
          return { text: option, isCorrect: false };
        }
        const text = String(
          option?.text ??
            option?.option_text ??
            option?.option_label ??
            option?.option_value ??
            option?.label ??
            ""
        ).trim();
        return {
          text,
          isCorrect: Boolean(option?.isCorrect ?? option?.is_correct ?? option?.correct),
        };
      })
      .filter((option: { text: string }) => Boolean(option.text));
  }, [questionPreset]);

  return (
    <div className="space-y-4">
      {showQuestion && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-800">Question</h3>
            {questionLoading ? (
              <span className="text-xs text-slate-400">Loading...</span>
            ) : null}
          </div>

          {questionPreset?.content?.length > 0 ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              {questionPreset.content.map((item: any, index: number) => (
                <div key={index} className="rounded-lg border border-slate-200 bg-white p-3">
                  {item.type === "text" ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                      {item.content}
                    </p>
                  ) : item.type === "image" ? (
                    <DynamicImage
                      src={item.content}
                      alt={`Question content ${index + 1}`}
                      className="max-h-64 w-auto rounded-md object-contain"
                    />
                  ) : (
                    <p className="text-sm text-slate-500">Unsupported content type: {item.type}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              {questionLoading ? (
                <div className="space-y-2">
                  <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
                </div>
              ) : (
                "No question content available."
              )}
            </div>
          )}
        </div>
      )}

      {/* Question Section */}
      {/* <div>
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

              <div className="w-full p-6 space-y-6">
                {questionPreset.content && questionPreset.content.length > 0 ? (
                  questionPreset.content.map((item: any, index: number) => (
                    <div
                      key={index}
                      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                    >
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
      </div> */}

      {/* Answer Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-semibold text-slate-800">
            Your Answer
          </h3>
          <p className="text-sm text-slate-500">{saveStatus}</p>
        </div>

        {isMCQ ? (
          mcqOptions.length > 0 ? (
            <div className="space-y-3">
              {mcqOptions.map((option: { text: string; isCorrect: boolean }, index: number) => {
              // Handle both string and object formats
              const optionText = option.text;
              const isCorrectOption = option.isCorrect;
              const isSelected = answer === optionText;
              const humanFeedback = questionPreset.mcq_human_feedback?.[index];

              // Handle AI feedback structure - can be either:
              // 1. New format: {corrective_feedback: [...], learner_feedback: [...]}
              // 2. Old format: [...]
              let aiFeedback = null;
              if (questionPreset.mcq_ai_feedback) {
                if (
                  typeof questionPreset.mcq_ai_feedback === "object" &&
                  !Array.isArray(questionPreset.mcq_ai_feedback)
                ) {
                  // New structured format - use corrective by default for display
                  aiFeedback =
                    questionPreset.mcq_ai_feedback.corrective_feedback?.[
                      index
                    ] ||
                    questionPreset.mcq_ai_feedback.learner_feedback?.[index];
                } else if (Array.isArray(questionPreset.mcq_ai_feedback)) {
                  // Old array format
                  aiFeedback = questionPreset.mcq_ai_feedback[index];
                }
              }

                return (
                  <div key={index} className="space-y-2">
                    <label
                      className={`flex items-center p-4 border rounded-lg cursor-pointer transition-colors duration-200 ${
                        isSelected
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="mcq-option"
                        value={optionText}
                        checked={isSelected}
                        onChange={(e) => {
                          setAnswer(e.target.value);
                          setSelectedOption(e.target.value);
                          setSelectedOptionIndex(index);

                          // Trigger the save and feedback fetch in parent component
                          const syntheticEvent = {
                            target: { value: e.target.value },
                          } as React.ChangeEvent<HTMLTextAreaElement>;
                          onAnswerChange(syntheticEvent);
                        }}
                        className="mr-3 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-slate-700 flex-1">{optionText}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          ) : questionLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, idx) => (
                <div
                  key={`mcq-option-loading-${idx}`}
                  className="animate-pulse rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full border border-slate-300 bg-slate-200" />
                    <div className="h-4 flex-1 rounded bg-slate-200" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              No options available for this MCQ question.
            </div>
          )
        ) : (
          <textarea
            value={answer}
            onChange={onAnswerChange}
            placeholder="Enter your answer here..."
            className="w-full px-3 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 resize-none min-h-32"
            rows={1}
            onInput={onInputResize}
            onPaste={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
              e.preventDefault();
              return false;
            }}
            onCopy={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
              e.preventDefault();
              return false;
            }}
            onCut={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
              e.preventDefault();
              return false;
            }}
            onContextMenu={(e: React.MouseEvent<HTMLTextAreaElement>) => {
              e.preventDefault();
              return false;
            }}
            onDrop={(e: React.DragEvent<HTMLTextAreaElement>) => {
              e.preventDefault();
              return false;
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              // Block common copy/paste keyboard shortcuts
              if (
                (e.ctrlKey || e.metaKey) &&
                ["c", "v", "x", "a"].includes(e.key.toLowerCase())
              ) {
                e.preventDefault();
                return false;
              }
              // Optional: Add additional keystroke controls here
              // For example, to block certain keys:
              // if (['Tab', 'Enter'].includes(e.key)) {
              //   e.preventDefault();
              //   return false;
              // }
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        )}
      </div>
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
    </div>
  );
}
