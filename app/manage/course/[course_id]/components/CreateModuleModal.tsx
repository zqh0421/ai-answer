'use client';

import ActionButton from '@/app/components/ActionButton';
import ModalShell from './ModalShell';

type CreateModuleModalProps = {
  isOpen: boolean;
  newModuleTitle: string;
  onChangeTitle: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
};

const CreateModuleModal = ({
  isOpen,
  newModuleTitle,
  onChangeTitle,
  onCancel,
  onCreate,
}: CreateModuleModalProps) => {
  if (!isOpen) return null;

  return (
    <ModalShell maxWidthClass="max-w-md">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Course Structure</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-900">Create New Module</h2>
      </div>
      <input
        type="text"
        value={newModuleTitle}
        onChange={(e) => onChangeTitle(e.target.value)}
        placeholder="Module Title"
        className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
      />
      <div className="flex justify-end gap-3">
        <ActionButton onClick={onCancel} variant="ghost">
          Cancel
        </ActionButton>
        <ActionButton onClick={onCreate} variant="primary">
          Create
        </ActionButton>
      </div>
    </ModalShell>
  );
};

export default CreateModuleModal;
