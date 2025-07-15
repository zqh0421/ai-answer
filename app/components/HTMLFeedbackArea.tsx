import React, { useState, useCallback } from 'react';
import { MessageSquare, Loader2, CheckCircle, XCircle, ThumbsUp, ThumbsDown } from 'lucide-react';

interface HTMLFeedbackAreaProps {
  html: string;
  isFeedbackLoading: boolean;
  score?: string; // 0 or 1 for color coding
}

// Component to render HTML feedback as a coherent paragraph with inline formatting
const HTMLFeedbackArea: React.FC<HTMLFeedbackAreaProps> = ({ html, isFeedbackLoading, score }) => {
  const [feedbackRating, setFeedbackRating] = useState<'good' | 'bad' | null>(null);
  const [hasRated, setHasRated] = useState(false);

  // Handle feedback rating
  const handleFeedbackRating = (rating: 'good' | 'bad') => {
    setFeedbackRating(rating);
    setHasRated(true);
    
    // Here you can add logic to send the rating to your backend
    console.log(`User rated feedback as: ${rating}`);
    
    // Example: Send to backend
    // sendFeedbackRating(rating, html);
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
    if (cleaned.startsWith('```html')) {
      cleaned = cleaned.substring(7);
    }
    
    // Remove ``` at the end
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    
    // Also handle cases with just ``` at the beginning
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.substring(3);
    }
    
    return cleaned.trim();
  };

  // Function to parse and render HTML as inline formatting within a paragraph
  const renderHTMLFeedback = (htmlString: string) => {
    // Clean the HTML string first
    const cleanedHTML = cleanHTMLString(htmlString);
    
    // Create a temporary DOM element to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = cleanedHTML;
    
    // Function to recursively process child nodes
    const processNode = (node: Node): React.ReactNode[] => {
      const result: React.ReactNode[] = [];
      
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) {
          result.push(<span key={`text-${Math.random()}`}>{text}</span>);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();
        const content = Array.from(element.childNodes).flatMap(processNode);
        
        switch (tagName) {
          case 'statement':
            result.push(
              <span key={`statement-${Math.random()}`} className="font-bold">
                {content}
              </span>
            );
            break;
            
          case 'explanation':
            result.push(
              <span key={`explanation-${Math.random()}`} className="text-slate-700">
                {content}
              </span>
            );
            break;
            
          case 'advice':
            result.push(
              <span key={`advice-${Math.random()}`} className="underline decoration-2 underline-offset-2">
                {content}
              </span>
            );
            break;
            
          case 'term':
            const termContent = element.textContent || '';
            const explanation = element.getAttribute('explanation') || element.getAttribute('title') || termContent;
            result.push(
              <TermWithTooltip key={`term-${Math.random()}`} term={termContent} tooltip={explanation} />
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

  // Determine icon color and icon based on score
  const getIconStyle = () => {
    if (score === "1") {
      return {
        color: 'bg-gradient-to-r from-green-500 to-emerald-500',
        icon: <CheckCircle className="w-4 h-4 text-white" />
      };
    } else if (score === "0") {
      return {
        color: 'bg-gradient-to-r from-red-500 to-pink-500',
        icon: <XCircle className="w-4 h-4 text-white" />
      };
    } else {
      // Default/neutral color when score is not provided
      return {
        color: 'bg-gradient-to-r from-blue-500 to-indigo-500',
        icon: <MessageSquare className="w-4 h-4 text-white" />
      };
    }
  };

  const iconStyle = getIconStyle();

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
      ) : html ? (
        <div className="p-6 bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl border border-slate-200 shadow-sm relative">
          <div className="flex items-start gap-3">
            <div className={`flex-shrink-0 w-8 h-8 ${iconStyle.color} rounded-full flex items-center justify-center shadow-sm`}>
              {iconStyle.icon}
            </div>
            <div className="flex-1">
              <p className="text-slate-700 leading-relaxed text-base space-x-1">
                {renderHTMLFeedback(html)}
              </p>
            </div>
          </div>
          
          {/* Feedback Rating Buttons - Bottom Right */}
          <div className="absolute bottom-3 right-3 flex items-center gap-3">
            <span className="text-xs text-slate-500 font-medium">Rate this feedback:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleFeedbackRating('good')}
                className={`
                  p-1.5 rounded-md transition-all duration-200
                  ${feedbackRating === 'good' 
                    ? 'text-blue-600 bg-blue-50 border border-blue-200' 
                    : hasRated 
                      ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-50' 
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                  }
                `}
              >
                <ThumbsUp className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => handleFeedbackRating('bad')}
                className={`
                  p-1.5 rounded-md transition-all duration-200
                  ${feedbackRating === 'bad' 
                    ? 'text-blue-600 bg-blue-50 border border-blue-200' 
                    : hasRated 
                      ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-50' 
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                  }
                `}
              >
                <ThumbsDown className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No feedback yet. Submit your answer to get started.</p>
        </div>
      )}
    </div>
  );
};

// Component for highlighted terms with tooltips
const TermWithTooltip = ({ term, tooltip }: { term: string; tooltip: string }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    // Clear previous delay
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const newPosition = {
      x: rect.left + rect.width / 2,
      y: rect.top
    };
    
    // Only update position if it actually changed
    setPosition(prev => {
      if (Math.abs(prev.x - newPosition.x) > 1 || Math.abs(prev.y - newPosition.y) > 1) {
        return newPosition;
      }
      return prev;
    });
    
    setShowTooltip(true);
  }, [timeoutId]);

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
const CustomTooltip = ({ children, content, isVisible, position }: { 
  children: React.ReactNode; 
  content: string; 
  isVisible: boolean; 
  position: { x: number; y: number; } 
}) => {
  if (!isVisible) return <>{children}</>;
  
  const tooltipWidth = 300;
  const viewportWidth = window.innerWidth;
  
  // Default position (show above)
  let finalTop = position.y - 70;
  let finalLeft = position.x;
  let transformX = 'translateX(-50%)';
  
  // Check if would overflow left boundary
  if (position.x - tooltipWidth / 2 < 10) {
    finalLeft = tooltipWidth / 2 + 10;
    transformX = 'translateX(-50%)';
  }
  
  // Check if would overflow right boundary
  if (position.x + tooltipWidth / 2 > viewportWidth - 10) {
    finalLeft = viewportWidth - tooltipWidth / 2 - 10;
    transformX = 'translateX(-50%)';
  }
  
  // Check if would overflow top boundary, if so show below
  if (finalTop < 10) {
    finalTop = position.y + 30;
  }
  
  return (
    <>
      {children}
      <div
        className="fixed px-4 py-3 text-sm text-slate-700 bg-white border border-slate-200 rounded-xl shadow-lg max-w-xs backdrop-blur-sm pointer-events-none"
        style={{
          left: finalLeft,
          top: finalTop,
          transform: transformX,
          animation: 'tooltipFadeIn 0.2s ease-out',
          zIndex: 9999
        }}
      >
        <p className="text-slate-600 leading-normal">{content}</p>
        
        {/* Outer arrow - border color */}
        <div 
          className="absolute w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent"
          style={{
            left: '50%',
            top: finalTop < position.y ? '100%' : '-4px',
            transform: 'translateX(-50%)',
            borderTopColor: finalTop < position.y ? '#e2e8f0' : 'transparent',
            borderBottomColor: finalTop > position.y ? '#e2e8f0' : 'transparent'
          }}
        ></div>
        
        {/* Inner arrow - background color */}
        <div 
          className="absolute w-0 h-0 border-l-3 border-r-3 border-t-3 border-transparent"
          style={{
            left: '50%',
            top: finalTop < position.y ? 'calc(100% - 1px)' : '-3px',
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

export default HTMLFeedbackArea; 