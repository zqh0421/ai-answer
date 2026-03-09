import React, { useState, useCallback } from "react";
import {
  MessageSquare,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

interface HTMLFeedbackAreaProps {
  html: string;
  isFeedbackLoading: boolean;
  hasSubmitted?: boolean;
  score?: string | number;
  maxScore?: string | number;
  isStreaming?: boolean;
  promptVersion?: string | null;
  recordId?: number | null; // Record ID for saving rating
}

// Component to render HTML feedback as a coherent paragraph with inline formatting
const HTMLFeedbackArea: React.FC<HTMLFeedbackAreaProps> = ({
  html,
  isFeedbackLoading,
  hasSubmitted = false,
  score,
  maxScore,
  isStreaming = false,
  promptVersion = null, // eslint-disable-line @typescript-eslint/no-unused-vars
  recordId,
}) => {
  const [feedbackRating, setFeedbackRating] = useState<"good" | "bad" | null>(
    null
  );
  const [hasRated, setHasRated] = useState(false);

  // Both learner and corrective feedback now show score-based icons

  // Handle feedback rating
  const handleFeedbackRating = async (rating: "good" | "bad") => {
    setFeedbackRating(rating);
    setHasRated(true);

    // Send rating to backend if recordId is available
    if (recordId) {
      try {
        const response = await fetch(`/api/record_result/${recordId}/rating`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rating: rating === "good",
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to save rating");
        }

        console.log(`Rating saved successfully: ${rating}`);
      } catch (error) {
        console.error("Error saving rating:", error);
        // Optionally show user feedback about the error
      }
    } else {
      console.log(`User rated feedback as: ${rating} (no record ID provided)`);
    }
  };

  // Reset rating when new feedback is received
  React.useEffect(() => {
    if (html && !isFeedbackLoading) {
      setFeedbackRating(null);
      setHasRated(false);
    }
  }, [html, isFeedbackLoading]);

  // Function to clean up the HTML string by removing code block markers
  const cleanHTMLString = (htmlString: string): string => {
    // Remove code block markers if present
    let cleaned = htmlString.trim();

    // Remove ```html at the beginning
    if (cleaned.startsWith("```html")) {
      cleaned = cleaned.substring(7);
    }

    // Remove ``` at the end
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }

    // Also handle cases with just ``` at the beginning
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.substring(3);
    }

    return cleaned.trim();
  };

  // Function to parse and render HTML as inline formatting within a paragraph
  const renderHTMLFeedback = (htmlString: string) => {
    // Clean the HTML string first
    const cleanedHTML = cleanHTMLString(htmlString);

    console.log("Original HTML string:", htmlString);
    console.log("Cleaned HTML string:", cleanedHTML);

    // Replace closing tag + space + opening tag patterns with a preserved space marker
    // This ensures spaces between inline elements are preserved
    const preservedHTML = cleanedHTML
      .replace(/<\/statement>\s+<explanation>/g, "</statement> <explanation>")
      .replace(/<\/explanation>\s+<advice>/g, "</explanation> <advice>")
      .replace(/<\/statement>\s+<advice>/g, "</statement> <advice>");

    // Create a temporary DOM element to parse the HTML
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = preservedHTML;
    console.log("Parsed innerHTML:", tempDiv.innerHTML);

    // Function to recursively process child nodes
    const processNode = (node: Node): React.ReactNode[] => {
      const result: React.ReactNode[] = [];

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        // Keep all text nodes, including whitespace-only ones
        // This preserves spaces between HTML elements
        if (text.length > 0) {
          result.push(<span key={`text-${Math.random()}`}>{text}</span>);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();
        const content = Array.from(element.childNodes).flatMap(processNode);

        switch (tagName) {
          case "statement":
            result.push(
              <span key={`statement-${Math.random()}`} className="font-bold">
                {content}
              </span>
            );
            // Add space after statement
            result.push(" ");
            break;

          case "explanation":
            result.push(
              <span
                key={`explanation-${Math.random()}`}
                className="text-slate-700"
              >
                {content}
              </span>
            );
            // Add space after explanation
            result.push(" ");
            break;

          case "advice":
            result.push(
              <span
                key={`advice-${Math.random()}`}
                className="underline decoration-2 underline-offset-2"
              >
                {content}
              </span>
            );
            break;

          case "term":
            const termContent = element.textContent || "";
            const explanation =
              element.getAttribute("explanation") ||
              element.getAttribute("title") ||
              termContent;
            result.push(
              <TermWithTooltip
                key={`term-${Math.random()}`}
                term={termContent}
                tooltip={explanation}
              />
            );
            break;

          default:
            // For any other tags, just render their content
            result.push(...content);
            break;
        }
      }

      return result;
    };

    // Process all child nodes of the temp div
    return Array.from(tempDiv.childNodes).flatMap(processNode);
  };

  // Determine icon color and icon based on score and feedback type
  const getIconStyle = () => {
    const scoreNumber =
      typeof score === "number" ? score : typeof score === "string" && score.trim() ? Number(score) : NaN;
    const maxScoreNumber =
      typeof maxScore === "number"
        ? maxScore
        : typeof maxScore === "string" && maxScore.trim()
        ? Number(maxScore)
        : NaN;

    if (Number.isFinite(scoreNumber)) {
      if (Number.isFinite(maxScoreNumber) && maxScoreNumber > 0) {
        if (scoreNumber >= maxScoreNumber) {
          return {
            color: "bg-gradient-to-r from-green-500 to-emerald-500",
            icon: <CheckCircle className="w-4 h-4 text-white" />,
          };
        }
        if (scoreNumber <= 0) {
          return {
            color: "bg-gradient-to-r from-red-500 to-pink-500",
            icon: <XCircle className="w-4 h-4 text-white" />,
          };
        }
        return {
          color: "bg-gradient-to-r from-yellow-500 to-amber-500",
          icon: <AlertCircle className="w-4 h-4 text-white" />,
        };
      }
      if (scoreNumber === 1) {
        return {
          color: "bg-gradient-to-r from-green-500 to-emerald-500",
          icon: <CheckCircle className="w-4 h-4 text-white" />,
        };
      }
      if (scoreNumber === 0) {
        return {
          color: "bg-gradient-to-r from-red-500 to-pink-500",
          icon: <XCircle className="w-4 h-4 text-white" />,
        };
      }
      if (scoreNumber === 2) {
        return {
          color: "bg-gradient-to-r from-yellow-500 to-amber-500",
          icon: <AlertCircle className="w-4 h-4 text-white" />,
        };
      }
    }

    // For both learner and corrective feedback, show score-based icons when score is available
    // Default/neutral color when score is not provided or unknown state
    return {
      color: "bg-gradient-to-r from-blue-500 to-indigo-500",
      icon: <MessageSquare className="w-4 h-4 text-white" />,
    };
  };

  const iconStyle = getIconStyle();
  const hasScore =
    (typeof score === "number" && Number.isFinite(score)) ||
    (typeof score === "string" && score.trim() !== "" && Number.isFinite(Number(score)));
  const normalizedScore =
    typeof score === "number" ? score : typeof score === "string" && score.trim() ? Number(score) : NaN;
  const normalizedMaxScore =
    typeof maxScore === "number" ? maxScore : typeof maxScore === "string" && maxScore.trim() ? Number(maxScore) : NaN;
  const shouldRenderFeedbackCard = ((html && !isFeedbackLoading) || (isStreaming && html) || hasScore);

  return (
    <div className="">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg">
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">Feedback</h3>
          <p className="text-xs text-slate-600">
            Detailed analysis of your answer
          </p>
        </div>
      </div>

      {isFeedbackLoading && !isStreaming ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{"Preparing feedback..."}</span>
          </div>
        </div>
      ) : shouldRenderFeedbackCard ? (
        <div className="p-6 bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl border border-slate-200 shadow-sm relative">
          <div className="flex items-start gap-3 mb-4">
            <div
              className={`flex-shrink-0 w-8 h-8 ${iconStyle.color} rounded-full flex items-center justify-center shadow-sm`}
            >
              {iconStyle.icon}
            </div>
            <div className="flex-1">
              <div className="text-slate-700 leading-relaxed text-base space-x-1">
                {isStreaming ? (
                  // For streaming, display raw text with typing indicator
                  <span className="inline">
                    {html}
                    <span className="inline-block w-2 h-5 bg-blue-500 ml-1 animate-pulse"></span>
                  </span>
                ) : html ? (
                  renderHTMLFeedback(html)
                ) : (
                  <span className="text-slate-500">
                    Score: {Number.isFinite(normalizedScore) ? normalizedScore : "-"} /{" "}
                    {Number.isFinite(normalizedMaxScore) ? normalizedMaxScore : "-"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Feedback Rating Buttons - Bottom Right - Only show when not streaming */}
          {!isStreaming && (
            <div className="absolute bottom-3 right-3 flex items-center gap-3">
              <span className="text-xs text-slate-500 font-medium">
                Rate this feedback:
              </span>
              <div className="flex items-center gap-1 transition-none">
                <button
                  onClick={() => handleFeedbackRating("good")}
                  className={`
                    p-1.5 rounded-md
                    ${
                      feedbackRating === "good"
                        ? "text-blue-700 transition-none"
                        : hasRated
                        ? "text-slate-400 hover:bg-slate-50"
                        : "text-slate-400 hover:bg-slate-50"
                    }
                  `}
                >
                  <ThumbsUp className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleFeedbackRating("bad")}
                  className={`
                    p-1.5 rounded-md
                    ${
                      feedbackRating === "bad"
                        ? "text-blue-700 transition-none"
                        : hasRated
                        ? "text-slate-400 hover:bg-slate-50"
                        : "text-slate-400 hover:bg-slate-50"
                    }
                  `}
                >
                  <ThumbsDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : isStreaming ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{"Preparing feedback..."}</span>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">
            {hasSubmitted
              ? "No feedback returned for this submission. Please submit again."
              : "No feedback yet. Submit your answer to get started."}
          </p>
        </div>
      )}
    </div>
  );
};

// Component for highlighted terms with tooltips
const TermWithTooltip = ({
  term,
  tooltip,
}: {
  term: string;
  tooltip: string;
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0, height: 0 });
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      // Clear previous delay
      if (timeoutId) {
        clearTimeout(timeoutId);
        setTimeoutId(null);
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const newPosition = {
        x: rect.left + rect.width / 2,
        y: rect.top,
        height: rect.height,
      };

      // Only update position if it actually changed
      setPosition((prev) => {
        if (
          Math.abs(prev.x - newPosition.x) > 1 ||
          Math.abs(prev.y - newPosition.y) > 1 ||
          Math.abs(prev.height - newPosition.height) > 1
        ) {
          return newPosition;
        }
        return prev;
      });

      setShowTooltip(true);
    },
    [timeoutId]
  );

  const handleMouseLeave = useCallback(() => {
    // Add small delay to avoid flickering
    const id = setTimeout(() => {
      setShowTooltip(false);
    }, 150);
    setTimeoutId(id);
  }, []);

  return (
    <CustomTooltip
      content={tooltip}
      isVisible={showTooltip}
      position={position}
    >
      <span
        className="inline-block bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 px-2 py-1 rounded-md text-sm font-medium border border-purple-200 cursor-help hover:from-purple-200 hover:to-pink-200 transition-all duration-200 shadow-sm"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {term}
      </span>
    </CustomTooltip>
  );
};

// Custom Tooltip Component
const CustomTooltip = ({
  children,
  content,
  isVisible,
  position,
}: {
  children: React.ReactNode;
  content: string;
  isVisible: boolean;
  position: { x: number; y: number; height: number };
}) => {
  if (!isVisible) return <>{children}</>;

  const tooltipWidth = 260;
  const viewportWidth = window.innerWidth;
  const gap = 12;

  // Default placement: above the highlighted term with a safe gap
  let finalTop = position.y - gap;
  let finalLeft = position.x;
  let transform = "translate(-50%, -100%)";
  let animationTransformFrom = "translate(-50%, calc(-100% + 5px))";
  let isTooltipAbove = true;

  const minCenter = tooltipWidth / 2 + 10;
  const maxCenter = viewportWidth - tooltipWidth / 2 - 10;
  if (finalLeft < minCenter) {
    finalLeft = minCenter;
  } else if (finalLeft > maxCenter) {
    finalLeft = maxCenter;
  }

  // Reserve horizontal breathing room for the QA panel on the right
  const qaPanelWidth = 360;
  const qaPanelGutter = 24;
  const qaSafeCenter = Math.max(
    minCenter,
    viewportWidth - qaPanelWidth - qaPanelGutter - tooltipWidth / 2
  );
  if (finalLeft > qaSafeCenter) {
    finalLeft = qaSafeCenter;
  }

  // Shift bubble slightly left to avoid QA panel overlap
  const bubbleShift = 24;
  finalLeft = Math.max(minCenter, finalLeft - bubbleShift);

  const caretOffsetRaw = position.x - finalLeft;
  const maxCaretOffset = tooltipWidth / 2 - 16;
  const caretOffset =
    caretOffsetRaw > maxCaretOffset
      ? maxCaretOffset
      : caretOffsetRaw < -maxCaretOffset
      ? -maxCaretOffset
      : caretOffsetRaw;

  // Check if would overflow top boundary, if so show below
  if (finalTop < 10) {
    finalTop = position.y + position.height + gap;
    transform = "translate(-50%, 0)";
    animationTransformFrom = "translate(-50%, 5px)";
    isTooltipAbove = false;
  }

  const arrowContainerClass = isTooltipAbove
    ? "pointer-events-none absolute top-full"
    : "pointer-events-none absolute top-0";
  const arrowContainerStyle = isTooltipAbove
    ? { left: `calc(50% + ${caretOffset}px)`, transform: "translate(-50%, 0)" }
    : {
        left: `calc(50% + ${caretOffset}px)`,
        transform: "translate(-50%, -100%)",
      };
  const outerArrowClass = isTooltipAbove
    ? "h-0 w-0 border-x-4 border-t-[6px] border-x-transparent border-t-slate-300"
    : "h-0 w-0 border-x-4 border-b-[6px] border-x-transparent border-b-slate-300";
  const innerArrowClass = isTooltipAbove
    ? "absolute left-1/2 -top-[5px] -translate-x-1/2 h-0 w-0 border-x-[3px] border-t-[5px] border-x-transparent border-t-white"
    : "absolute left-1/2 top-[1px] -translate-x-1/2 h-0 w-0 border-x-[3px] border-b-[5px] border-x-transparent border-b-white";

  return (
    <>
      {children}
      <div
        className="fixed px-4 py-3 text-sm text-slate-700 bg-white border border-slate-300 rounded-xl shadow-lg max-w-[16rem] backdrop-blur-sm pointer-events-none"
        style={{
          left: finalLeft,
          top: finalTop,
          transform,
          animation: "tooltipFadeIn 0.2s ease-out",
          zIndex: 9999,
        }}
      >
        <span className="text-slate-600 leading-normal block">{content}</span>
        <div className={arrowContainerClass} style={arrowContainerStyle}>
          <div className="relative">
            <div className={outerArrowClass}></div>
            <div className={innerArrowClass}></div>
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: ${animationTransformFrom};
          }
          to {
            opacity: 1;
            transform: ${transform};
          }
        }
      `}</style>
    </>
  );
};

export default HTMLFeedbackArea;
