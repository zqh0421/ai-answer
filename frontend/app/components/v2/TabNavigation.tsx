"use client";

interface TabNavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  questionId?: string | null;
}

export default function TabNavigation({
  activeTab,
  setActiveTab,
  questionId,
}: TabNavigationProps) {
  // Don't show tabs if there's a question ID (preset question)
  if (questionId) return null;

  return (
    <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
      <button
        className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeTab === "selection"
            ? "bg-white text-blue-600 shadow-sm"
            : "text-slate-600 hover:text-slate-900"
        }`}
        onClick={() => setActiveTab("selection")}
      >
        Content Selection
      </button>
      <button
        className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeTab === "input"
            ? "bg-white text-blue-600 shadow-sm"
            : "text-slate-600 hover:text-slate-900"
        }`}
        onClick={() => setActiveTab("input")}
      >
        Question & Answer
      </button>
    </div>
  );
}
