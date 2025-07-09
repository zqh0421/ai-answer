import { StructuredFeedback, StructuredFeedbackWithSpace, FeedbackResult, ProcessedFeedbackData } from "@/app/types";
import { MessageSquare, Loader2, Sparkles, Target, Quote } from 'lucide-react';
import React, { useState, useCallback } from "react";

// Helper functions to safely access feedback data
const getConcisedFeedback = (data: StructuredFeedback | StructuredFeedbackWithSpace): string => {
  if ('concised feedback' in data) {
    return data['concised feedback'];
  }
  return data.concised_feedback;
};

const isStructuredFeedback = (obj: unknown): obj is StructuredFeedback | StructuredFeedbackWithSpace => {
  return typeof obj === 'object' && obj !== null && (
    'concised feedback' in obj || 'concised_feedback' in obj
  );
};

const isFeedbackWrapper = (obj: unknown): obj is { feedback: string | StructuredFeedback | StructuredFeedbackWithSpace } => {
  return typeof obj === 'object' && obj !== null && 'feedback' in obj;
};

// function highlightTerms(text: string, terms: string[], className: string = 'highlight-term') {
//   // Sort terms by length descending to avoid partial overlaps
//   const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
//   let pattern = sortedTerms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
//   if (!pattern) return text;
//   const regex = new RegExp(`(${pattern})`, 'gi');
//   const parts = text.split(regex);
//   return parts.map((part, i) =>
//     sortedTerms.some(term => part.toLowerCase() === term.toLowerCase())
//       ? <span key={i} className={className}>{part}</span>
//       : part
//   );
// }

// // Highlight function for terms and phrases
// function highlightTermsAndPhrases(text: string, terms: string[], phrases: string[]) {
//   // Combine all terms and phrases, sort by length descending
//   const all = [
//     ...terms.map(t => ({ value: t, type: 'term' })),
//     ...phrases.map(p => ({ value: p, type: 'phrase' }))
//   ].sort((a, b) => b.value.length - a.value.length);
//   if (all.length === 0) return text;
//   // Build regex
//   const pattern = all.map(obj => obj.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
//   const regex = new RegExp(`(${pattern})`, 'gi');
//   // Split and wrap
//   const parts = text.split(regex);
//   return parts.map((part, i) => {
//     const match = all.find(obj => part.toLowerCase() === obj.value.toLowerCase());
//     if (match) {
//       return (
//         <span key={i} className={match.type === 'term' ? 'highlight-term' : 'highlight-phrase'}>{part}</span>
//       );
//     }
//     return part;
//   });
// }

function highlightTermsAndPhrasesWithTooltip(
  text: string,
  terms: { [key: string]: string }[],
  phrases: string[]
) {
  // Build a map of term → tooltip
  const termMap = Object.fromEntries(
    terms.map(obj => [Object.keys(obj)[0], Object.values(obj)[0]])
  );
  const termList = Object.keys(termMap);

  // Debug logging
  console.log("Highlighting terms:", termList);
  console.log("Highlighting phrases:", phrases);
  console.log("Text to highlight:", text);

  if (termList.length === 0 && phrases.length === 0) {
    return text;
  }

  // Create a simple word-by-word highlighting approach using React components
  let result = text;
  
  // Highlight terms first (longer terms first to avoid partial matches)
  const sortedTerms = termList.sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, `__TERM_${term}__`);
  }

  // Highlight phrases
  const sortedPhrases = phrases.sort((a, b) => b.length - a.length);
  for (const phrase of sortedPhrases) {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, `__PHRASE_${phrase}__`);
  }

  // Split the text and create React components
  const parts = result.split(/(__TERM_.*?__|__PHRASE_.*?__)/);
  
  return parts.map((part, index) => {
    if (part.startsWith('__TERM_')) {
      const term = part.replace('__TERM_', '').replace('__', '');
      return (
        <HighlightedTerm 
          key={index} 
          term={term} 
          tooltip={termMap[term]} 
        />
      );
    } else if (part.startsWith('__PHRASE_')) {
      const phrase = part.replace('__PHRASE_', '').replace('__', '');
      return (
        <span 
          key={index} 
          className='highlight-phrase transition-all duration-200 hover:scale-105' 
          style={{ 
            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
            borderRadius: '4px', // 减小圆角
            padding: '0px 4px', // 减少垂直padding，保持水平padding
            border: '1px solid #f59e0b',
            color: '#92400e',
            fontWeight: '500',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
          }}
        >
          {phrase}
        </span>
      );
    } else {
      return part;
    }
  });
}

// Component for highlighted terms with tooltips
const HighlightedTerm = ({ term, tooltip }: { term: string; tooltip: string }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    // 清除之前的延迟
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const newPosition = {
      x: rect.left + rect.width / 2,
      y: rect.top
    };
    
    // 只有当位置真正改变时才更新，避免不必要的重渲染
    setPosition(prev => {
      if (Math.abs(prev.x - newPosition.x) > 1 || Math.abs(prev.y - newPosition.y) > 1) {
        return newPosition;
      }
      return prev;
    });
    
    setShowTooltip(true);
  }, [timeoutId]);

  const handleMouseLeave = useCallback(() => {
    // 添加小延迟，避免鼠标快速移动时的频闪
    const id = setTimeout(() => {
      setShowTooltip(false);
    }, 150); // 增加延迟时间，让用户更容易移动到tooltip上
    setTimeoutId(id);
  }, []);

  return (
    <CustomTooltip 
      content={tooltip} 
      isVisible={showTooltip} 
      position={position}
    >
      <span
        className='highlight-term transition-all duration-200 hover:scale-105'
        style={{ 
          background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
          borderRadius: '4px', // 减小圆角
          padding: '0px 4px', // 减少垂直padding，保持水平padding
          border: '1px solid #93c5fd',
          color: '#1e40af',
          fontWeight: '500',
          cursor: 'help',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          display: 'inline-block', // 确保元素有正确的盒模型
          position: 'relative', // 确保定位上下文正确
          zIndex: 1, // 确保在tooltip下方
          lineHeight: '1.2',
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {term}
      </span>
    </CustomTooltip>
  );
};

// Custom Tooltip Component
const CustomTooltip = ({ children, content, isVisible, position }: { 
  children: React.ReactNode; 
  content: string; 
  isVisible: boolean; 
  position: { x: number; y: number; } 
}) => {
  if (!isVisible) return <>{children}</>;
  
  // 计算气泡应该显示的位置，避免被遮挡
  // const tooltipHeight = 80; // 估算气泡高度
  const tooltipWidth = 300; // 估算气泡宽度
  const viewportWidth = window.innerWidth;
  // const viewportHeight = window.innerHeight;
  
  // 默认位置（向上显示）
  let finalTop = position.y - 70; // 向上移动更多
  let finalLeft = position.x;
  let transformX = 'translateX(-50%)';
  
  // 检查是否会超出左边界
  if (position.x - tooltipWidth / 2 < 10) {
    finalLeft = tooltipWidth / 2 + 10;
    transformX = 'translateX(-50%)';
  }
  
  // 检查是否会超出右边界
  if (position.x + tooltipWidth / 2 > viewportWidth - 10) {
    finalLeft = viewportWidth - tooltipWidth / 2 - 10;
    transformX = 'translateX(-50%)';
  }
  
  // 检查是否会超出上边界，如果会则显示在下方
  if (finalTop < 10) {
    finalTop = position.y + 30; // 显示在下方
  }
  
  return (
    <>
      {children}
      <div
        className="fixed px-3 py-2 text-sm text-slate-700 bg-white border border-slate-200 rounded-xl shadow-lg max-w-xs backdrop-blur-sm pointer-events-none"
        style={{
          left: finalLeft,
          top: finalTop,
          transform: transformX,
          animation: 'tooltipFadeIn 0.2s ease-out',
          zIndex: 9999 // 使用非常高的z-index确保在最顶层
        }}
      >
        <p className="text-slate-600 leading-normal">{content}</p>
        
        {/* 外层箭头 - 边框颜色 */}
        <div 
          className="absolute w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent"
          style={{
            left: '50%',
            top: finalTop < position.y ? '100%' : '-4px', // 根据位置调整箭头方向
            transform: 'translateX(-50%)',
            borderTopColor: finalTop < position.y ? '#e2e8f0' : 'transparent',
            borderBottomColor: finalTop > position.y ? '#e2e8f0' : 'transparent'
          }}
        ></div>
        
        {/* 内层箭头 - 背景颜色 */}
        <div 
          className="absolute w-0 h-0 border-l-3 border-r-3 border-t-3 border-transparent"
          style={{
            left: '50%',
            top: finalTop < position.y ? 'calc(100% - 1px)' : '-3px', // 根据位置调整箭头方向
            transform: 'translateX(-50%)',
            borderTopColor: finalTop < position.y ? '#ffffff' : 'transparent',
            borderBottomColor: finalTop > position.y ? '#ffffff' : 'transparent'
          }}
        ></div>
      </div>
      <style jsx>{`
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: ${transformX} translateY(5px);
          }
          to {
            opacity: 1;
            transform: ${transformX} translateY(0);
          }
        }
      `}</style>
    </>
  );
};

export default function FeedbackArea({ result, isFeedbackLoading }: { result: FeedbackResult, isFeedbackLoading: boolean }) {
  console.log("FeedbackArea received result:", result);
  console.log("Result type:", typeof result);
  if (typeof result === 'object' && result !== null) {
    console.log("Result keys:", Object.keys(result));
    if (isStructuredFeedback(result)) {
      console.log("Concised feedback in component:", getConcisedFeedback(result));
    }
  }

  // Handle different result formats
  const getFeedbackData = (): ProcessedFeedbackData => {
    if (typeof result === "string") {
      console.log("Result is a string:", result);
      return result;
    } else if (result && typeof result === "object") {
      console.log("Result is an object:", result);
      if (isFeedbackWrapper(result)) {
        return result.feedback;
      }
      // Check if it's direct StructuredFeedback format
      if (isStructuredFeedback(result)) {
        return result;
      }
      // Fallback to string representation
      return JSON.stringify(result);
    }
    return "";
  };

  const feedbackData = getFeedbackData();

  const renderContent = () => {
    if (typeof feedbackData === "string") {
      return (
        <div className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-slate-700 leading-normal text-base">{feedbackData}</p>
            </div>
          </div>
        </div>
      );
    } else {
      // Prepare terms and phrases for highlighting
      const terms = isStructuredFeedback(feedbackData) && feedbackData.terms
        ? feedbackData.terms.map(termObj => Object.keys(termObj)[0])
        : [];
      const phrases = isStructuredFeedback(feedbackData) && feedbackData.quotes
        ? feedbackData.quotes.flatMap(q => q.quotes)
        : [];
      
      console.log("Prepared terms for highlighting:", terms);
      console.log("Prepared phrases for highlighting:", phrases);
      console.log("Is structured feedback:", isStructuredFeedback(feedbackData));
      
      return (
        <div className="space-y-6">
          {/* Concised Feedback - Main Highlight */}
          <div className="p-6 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-200">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center">
                <Target className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-emerald-700 mb-2 uppercase tracking-wide">Summary Feedback</h4>
                <p className="text-slate-700 leading-normal text-base">
                  {isStructuredFeedback(feedbackData)
                    ? highlightTermsAndPhrasesWithTooltip(
                        getConcisedFeedback(feedbackData),
                        feedbackData.terms ?? [],
                        feedbackData.quotes?.flatMap(q => q.quotes) ?? []
                      )
                    : feedbackData}
                </p>
              </div>
            </div>
          </div>

          {isStructuredFeedback(feedbackData) && feedbackData.quotes && feedbackData.quotes.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                Key Phrases
              </h4>
              {feedbackData.quotes.map((sectionObj, idx) => (
                <div key={idx} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-4 bg-purple-500 rounded-full"></div>
                    <p className="font-semibold text-purple-700 text-sm uppercase tracking-wide">{sectionObj.section}</p>
                  </div>
                  <div className="space-y-2">
                    {sectionObj.quotes.map((quote, qIdx) => (
                      <div key={qIdx} className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200 hover:border-purple-300 transition-all duration-200">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                            <Quote className="w-3 h-3 text-white" />
                          </div>
                          <div className="flex-1">
                            <span className="text-slate-700 text-sm leading-normal italic">&quot;{quote}&quot;</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
  };

  // Test the highlighting function with sample data
  const testHighlighting = () => {
    const testText = "The student has not provided an answer to the question regarding the air pressure inside the pump if the inlet valve remains open when the rod is pushed in.";
    const testTerms: { [key: string]: string }[] = [
      { "inlet valve": "A valve that allows air to enter the pump." }, 
      { "air pressure": "The force exerted by air within a confined space." }
    ];
    const testPhrases = ["The student has not answered the question."];
    
    console.log("Testing highlighting function...");
    const result = highlightTermsAndPhrasesWithTooltip(testText, testTerms, testPhrases);
    console.log("Test result:", result);
  };
  
  // Run test once
  React.useEffect(() => {
    testHighlighting();
  }, []);

  return (
    <div className="">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg">
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">Feedback</h3>
          <p className="text-xs text-slate-600">Detailed analysis of your answer</p>
        </div>
      </div>
      
      {isFeedbackLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Generating feedback...</span>
          </div>
        </div>
      ) : result ? (
        renderContent()
      ) : (
        <div className="text-center py-8">
          <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No feedback yet. Submit your answer to get started.</p>
        </div>
      )}
    </div>
  );
}