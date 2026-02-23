'use client';

import ActionButton from '@/app/components/ActionButton';
import { Slide } from '@/app/types';
import ModalShell from './ModalShell';

type ConfirmUploadModalProps = {
  isOpen: boolean;
  slides: Slide[];
  onCancel: () => void;
  onUpload: () => void;
};

const ConfirmUploadModal = ({
  isOpen,
  slides,
  onCancel,
  onUpload,
}: ConfirmUploadModalProps) => {
  if (!isOpen) return null;

  return (
    <ModalShell maxWidthClass="max-w-xl">
      {slides.length > 0 ? (
        <>
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Module Import</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">Confirm Upload</h2>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            The following {slides.length} files were fetched from the Google Drive folder. Do you want to upload them?
          </p>
          <ul className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
            {slides.map((slide) => (
              <li key={slide.slide_google_id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                {slide.slide_title}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-3">
            <ActionButton onClick={onCancel} variant="ghost">
              Cancel
            </ActionButton>
            <ActionButton onClick={onUpload} variant="success">
              Upload
            </ActionButton>
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-4 text-2xl font-semibold text-slate-900">Confirm Upload</h2>
          <div className="mt-4 flex justify-end gap-3">
            <ActionButton onClick={onCancel} variant="ghost">
              Cancel
            </ActionButton>
          </div>
        </>
      )}
    </ModalShell>
  );
};

export default ConfirmUploadModal;
