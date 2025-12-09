// import { BookOpen, Sparkles } from 'lucide-react';

export default function Header() {
  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center justify-center">
          <h1 className="text-lg font-bold">
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              SlideItRight
            </span>
            <span className="text-slate-600 font-normal ml-1">
              Feedback System
            </span>
          </h1>
        </div>
      </div>
    </header>
  );
}
