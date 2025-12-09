import { Mail, Calendar } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-white/60 backdrop-blur-md border-t border-slate-200 mt-auto">
      <div className="container mx-auto px-4 py-3">
        <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4 text-sm text-slate-600">
            <div className="flex items-center space-x-1">
              <Calendar className="w-4 h-4" />
              <span>Updated Jun 26, 2025</span>
            </div>
            <div className="flex items-center space-x-1">
              <Mail className="w-4 h-4" />
              <span>qianhuiz@cs.cmu.edu</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
