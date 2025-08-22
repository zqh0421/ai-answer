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
        <h2 className="text-lg font-bold mb-2">Enter Prolific User ID</h2>
        <p className='text-grey-500 opacity-75 mb-4'>This is for linking your learning record.</p>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste your Prolific User ID here."
          className="border p-2 w-80 mb-4"
        />
        <p className='text-red-500 opacity-75 mb-4'>Once saved, it CANNOT be edited!</p>
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
