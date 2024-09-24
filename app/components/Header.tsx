import React from 'react';

export default function Header() {
  return (
    <header className="bg-blue-600 text-white p-4 shadow-md">
      <div className="container mx-auto flex justify-between items-center">
        {/* Title Section */}
        <h1 className="text-2xl font-bold">MuFIN: Information Retrieval</h1>

        {/* Button Section */}
        <button
          className="p-2 bg-white text-blue-600 rounded-lg hover:bg-gray-100"
          onClick={openDrawer}
        >
          Open Test Drawer
        </button>
      </div>
    </header>
  );
}