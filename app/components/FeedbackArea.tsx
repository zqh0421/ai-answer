import { StructuredFeedback } from "@/app/types";
import { MessageSquare, Loader2 } from 'lucide-react';

export default function FeedbackArea({ result, isFeedbackLoading }: { result: string | StructuredFeedback, isFeedbackLoading: boolean }) {
  const renderContent = () => {
    if (typeof result === "string") {
      return <p className="text-slate-700 leading-relaxed">{result}</p>;
    } else {
      return (
        <div className="space-y-6">
          <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
            <p className="text-slate-700 leading-relaxed">{result.concised_feedback}</p>
          </div>

          {result.terms.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                Key Terms
              </h4>
              <div className="grid gap-2">
                {result.terms.map((termObj, idx) => {
                  const term = Object.keys(termObj)[0];
                  const tooltip = termObj[term];
                  return (
                    <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <strong className="text-blue-600">{term}:</strong>
                      <span className="text-slate-700 ml-2">{tooltip}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {result.quotes.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                Key Phrases
              </h4>
              {result.quotes.map((sectionObj, idx) => (
                <div key={idx} className="space-y-2">
                  <p className="font-medium text-purple-600">{sectionObj.section}:</p>
                  <div className="space-y-1">
                    {sectionObj.quotes.map((quote, qIdx) => (
                      <div key={qIdx} className="p-2 bg-purple-50 rounded-lg border border-purple-200">
                        <span className="text-slate-700">"{quote}"</span>
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

  return (
    <div className="p-4">
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