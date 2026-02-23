'use client';

import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import ActionButton from '@/app/components/ActionButton';
import { Module, Slide } from '@/app/types';
import SlideCard from './SlideCard';

type ModuleSlidesSectionProps = {
  module: Module;
  slides: Slide[];
  selectedIds: string[];
  batchActionLoading: boolean;
  onModuleClick: (moduleId: string) => void;
  onRequestAddSlides: (moduleId: string) => void;
  onDeleteModule: (moduleId: string) => void;
  onToggleSlideSelection: (moduleId: string, slideId: string) => void;
};

const ModuleSlidesSection = ({
  module,
  slides,
  selectedIds,
  batchActionLoading,
  onModuleClick,
  onRequestAddSlides,
  onDeleteModule,
  onToggleSlideSelection,
}: ModuleSlidesSectionProps) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm ring-1 ring-white">
      <Disclosure>
        {({ open }) => (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <DisclosureButton
                onClick={() => onModuleClick(module.module_id)}
                className="group inline-flex min-w-0 items-center gap-3 px-1 py-2 text-left"
              >
                <span
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center text-slate-500 transition-transform ${
                    open ? 'rotate-90' : 'rotate-0'
                  }`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M7 4l7 6-7 6V4z" />
                  </svg>
                </span>
                <span className="truncate text-lg font-semibold text-slate-900 group-hover:text-sky-700">
                  {module.module_title}
                </span>
              </DisclosureButton>
              <div className="flex items-center gap-2 self-end md:self-auto">
                <ActionButton
                  onClick={() => onRequestAddSlides(module.module_id)}
                  variant="success"
                  size="sm"
                  className="rounded-xl"
                >
                  Add Slides (Google Drive Folder)
                </ActionButton>
                <ActionButton
                  onClick={() => onDeleteModule(module.module_id)}
                  variant="danger"
                  size="sm"
                  className="rounded-xl"
                >
                  Delete Module
                </ActionButton>
              </div>
            </div>
            <DisclosurePanel className="mt-4 border-t border-slate-100 pt-4">
              {slides.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-sm text-slate-500">
                  No slides available for this module.
                </div>
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  {slides.map((slide) => (
                    <SlideCard
                      key={slide.id || slide.slide_google_id}
                      moduleId={module.module_id}
                      slide={slide}
                      selected={selectedIds.includes(slide.id)}
                      disabled={batchActionLoading}
                      onToggleSelect={onToggleSlideSelection}
                    />
                  ))}
                </div>
              )}
            </DisclosurePanel>
          </>
        )}
      </Disclosure>
    </div>
  );
};

export default ModuleSlidesSection;
