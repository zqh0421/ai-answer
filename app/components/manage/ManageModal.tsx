'use client';

import { ReactNode } from 'react';
import ActionButton from '@/app/components/ActionButton';

type ManageModalProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
  panelClassName?: string;
  bodyClassName?: string;
  disableClose?: boolean;
};

const joinClasses = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(' ');

const ManageModal = ({
  open,
  title,
  description,
  onClose,
  children,
  maxWidthClassName = 'max-w-2xl',
  panelClassName,
  bodyClassName,
  disableClose = false,
}: ManageModalProps) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={joinClasses(
          'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-white',
          maxWidthClassName,
          panelClassName
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 md:px-6">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-900 md:text-2xl">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <ActionButton
            type="button"
            variant="ghost"
            className="rounded-lg"
            onClick={onClose}
            disabled={disableClose}
          >
            Close
          </ActionButton>
        </div>
        <div className={joinClasses('min-h-0 overflow-y-auto px-5 py-4 md:px-6 md:py-5', bodyClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default ManageModal;
