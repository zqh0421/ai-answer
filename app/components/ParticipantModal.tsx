'use client';

import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { setParticipantId } from '@/app/slices/userSlice';

export default function ParticipantModal({ isOpen }: { isOpen: boolean }) {
  const [input, setInput] = useState('');
  const dispatch = useDispatch();

  const handleSave = () => {
    if (input.trim()) {
      dispatch(setParticipantId(input.trim()));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[98]">
      <div className="bg-white p-4 rounded shadow-lg z-[99]">
        <h2 className="text-lg font-bold mb-2">Enter Participant ID</h2>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Participant ID"
          className="border p-2 w-full mb-4"
        />
        <button
          onClick={handleSave}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          Save
        </button>
      </div>
    </div>
  );
}
