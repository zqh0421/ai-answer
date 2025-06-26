"use client";

import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, TestTube, CheckCircle, AlertCircle } from "lucide-react";

interface TestDrawerProps {
  isOpen: boolean;
  closeDrawer: () => void;
  message: string;
}

export default function TestDrawer({ isOpen, closeDrawer, message }: TestDrawerProps) {
  const isSuccess = message.includes("success") || message.includes("connected");
  const isError = message.includes("error") || message.includes("failed");

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
          <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm" />
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
              <Dialog.Panel className="relative w-screen max-w-md bg-white shadow-2xl">
                <div className="flex flex-col h-full">
                  {/* Header */}
                  <div className="flex items-center justify-between p-6 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl">
                        <TestTube className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <Dialog.Title className="text-lg font-semibold text-slate-800">
                          System Status
                        </Dialog.Title>
                        <p className="text-sm text-slate-500">API and service health check</p>
                      </div>
                    </div>
                    <button
                      onClick={closeDrawer}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-gradient-to-r hover:from-slate-100 hover:to-slate-200 rounded-lg transition-all duration-300"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-6 space-y-4">
                    {/* Status Indicator */}
                    <div className={`flex items-center gap-3 p-4 rounded-lg border transition-all duration-300 ${
                      isSuccess 
                        ? 'bg-gradient-to-r from-emerald-50 to-emerald-100 border-emerald-200' 
                        : isError 
                        ? 'bg-gradient-to-r from-red-50 to-red-100 border-red-200' 
                        : 'bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200'
                    }`}>
                      {isSuccess ? (
                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                      ) : isError ? (
                        <AlertCircle className="w-5 h-5 text-red-600" />
                      ) : (
                        <TestTube className="w-5 h-5 text-blue-600" />
                      )}
                      <div>
                        <p className={`font-medium transition-all duration-300 ${
                          isSuccess ? 'text-emerald-800' : isError ? 'text-red-800' : 'text-blue-800'
                        }`}>
                          {isSuccess ? 'System Healthy' : isError ? 'System Error' : 'Checking Status'}
                        </p>
                        <p className={`text-sm transition-all duration-300 ${
                          isSuccess ? 'text-emerald-600' : isError ? 'text-red-600' : 'text-blue-600'
                        }`}>
                          {isSuccess ? 'All services are running properly' : isError ? 'Some services may be down' : 'Verifying system components'}
                        </p>
                      </div>
                    </div>

                    {/* Message Display */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-slate-700">Response Details</h4>
                      <div className="bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-200 rounded-lg p-4 transition-all duration-300">
                        <pre className="text-sm text-slate-700 whitespace-pre-wrap font-mono">
                          {message || "No response data available"}
                        </pre>
                      </div>
                    </div>

                    {/* Instructions */}
                    <div className="bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4 transition-all duration-300">
                      <h4 className="text-sm font-medium text-blue-800 mb-2">What this means:</h4>
                      <p className="text-sm text-blue-700">
                        This panel shows the current status of your API connections and system health. 
                        A successful response indicates that all backend services are functioning properly.
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="p-6 border-t border-slate-200">
                    <button
                      onClick={closeDrawer}
                      className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300 shadow-lg"
                    >
                      Close Panel
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
