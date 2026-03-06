"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";

interface AndrewIdModalProps {
  isOpen: boolean;
  initialValue?: string;
  isRequired?: boolean;
  onSave: (andrewId: string) => void;
  onClose?: () => void;
}

export default function AndrewIdModal({
  isOpen,
  initialValue = "",
  isRequired = false,
  onSave,
  onClose,
}: AndrewIdModalProps) {
  const [input, setInput] = useState(initialValue);

  useEffect(() => {
    if (!isOpen) return;
    setInput(initialValue);
  }, [isOpen, initialValue]);

  const handleSave = () => {
    const normalized = input.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") handleSave();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
              <User className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Andrew ID</h2>
              <p className="text-sm text-slate-500">Please enter your Andrew ID to continue to help us match ur learning record</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div className="space-y-2">
            <label htmlFor="andrew-id-input" className="block text-sm font-medium text-slate-700">
              Andrew ID
            </label>
            <input
              id="andrew-id-input"
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. qianhuiz"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div className="flex gap-3 pt-1">
            {!isRequired && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSave}
              disabled={!input.trim()}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
