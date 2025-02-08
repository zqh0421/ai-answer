"use client";

import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";

interface TestDrawerProps {
  isOpen: boolean;
  closeDrawer: () => void;
  message: string;
}

export default function TestDrawer({ isOpen, closeDrawer, message }: TestDrawerProps) {
  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[99]" onClose={closeDrawer}>
        <Transition.Child
          as={Fragment}
          enter="transition ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative w-screen max-w-md bg-white shadow-xl">
                <div className="p-6">
                  <Dialog.Title className="text-lg font-medium text-gray-900">
                    Testing Area
                  </Dialog.Title>
                  <p className="mt-2 text-gray-500">
                    Get data from /api/python to see whether the API port is working smoothly.
                  </p>
                  <pre className="mt-4 bg-gray-100 p-4 rounded-lg">{message}</pre>
                  <div className="mt-6">
                    <button
                      className="w-full bg-red-500 text-white p-2 rounded-lg"
                      onClick={closeDrawer}
                    >
                      Close Drawer
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
