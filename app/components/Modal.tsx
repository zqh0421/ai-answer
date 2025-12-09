import React from 'react';

interface ModalProps {
  isVisible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isVisible, title, onClose, children, footer }) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50">
      <div className="bg-white p-6 rounded-lg shadow-lg w-96">
        <h2 className="text-2xl font-semibold mb-4">{title}</h2>
        <div>{children}</div>
        <div className="flex justify-end space-x-4 mt-4">
          <button
            onClick={onClose}
            className="p-2 bg-gray-400 text-white rounded hover:bg-gray-500"
          >
            Cancel
          </button>
          {footer}
        </div>
      </div>
    </div>
  );
};

export default Modal;
