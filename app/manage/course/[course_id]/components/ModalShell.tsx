'use client';

import { ReactNode } from 'react';

type ModalShellProps = {
  children: ReactNode;
  maxWidthClass?: string;
};

const ModalShell = ({ children, maxWidthClass = 'max-w-md' }: ModalShellProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
      <div className={`w-full ${maxWidthClass} rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl ring-1 ring-white`}>
        {children}
      </div>
    </div>
  );
};

export default ModalShell;
