'use client';

import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { User, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { setParticipantId } from '@/app/slices/userSlice';

export default function ParticipantModal({ isOpen }: { isOpen: boolean }) {
  const [input, setInput] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const dispatch = useDispatch();

  const handleSave = () => {
    if (input.trim()) {
      dispatch(setParticipantId(input.trim()));
      setIsSubmitted(true);
      // Auto-close after showing success message
      setTimeout(() => {
        setIsSubmitted(false);
        setInput('');
      }, 2000);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm z-[98] p-4 transition-all duration-300">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden transition-all duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl">
              <User className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Participant Setup</h2>
              <p className="text-sm text-slate-500">Enter your Prolific ID to continue</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {!isSubmitted ? (
            <>
              {/* Warning Message */}
              <div className="flex items-start gap-3 p-4 bg-gradient-to-r from-amber-50 to-amber-100 border border-amber-200 rounded-lg transition-all duration-300">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 mb-1">Important Notice</p>
                  <p className="text-sm text-amber-700">
                    This ID will be used to link your learning record. Once saved, it cannot be changed.
                  </p>
                </div>
              </div>

              {/* Input Field */}
              <div className="space-y-2">
                <label htmlFor="prolific-id" className="block text-sm font-medium text-slate-700">
                  Prolific User ID
                </label>
                <input
                  id="prolific-id"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Paste your Prolific User ID here..."
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300"
                  autoFocus
                />
                <p className="text-xs text-slate-500">
                  This helps us track your progress and provide personalized feedback
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={!input.trim()}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all duration-300 ${
                    input.trim()
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-lg'
                      : 'bg-gradient-to-r from-slate-100 to-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  Save & Continue
                </button>
              </div>
            </>
          ) : (
            /* Success Message */
            <div className="text-center py-8 transition-all duration-300">
              <div className="w-16 h-16 bg-gradient-to-r from-emerald-100 to-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Setup Complete!</h3>
              <p className="text-slate-600">
                Your Prolific ID has been saved successfully. You can now start using the system.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
