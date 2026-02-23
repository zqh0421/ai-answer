'use client';

import DynamicImage from '@/app/components/DynamicImage';
import { Slide } from '@/app/types';
import { getStatusTagClass } from '../utils/jobUtils';
import { getSlideGoogleOpenUrl, getSlideProcessBadgeStatus } from '../utils/slideUtils';

type SlideCardProps = {
  moduleId: string;
  slide: Slide;
  selected: boolean;
  disabled?: boolean;
  onToggleSelect: (moduleId: string, slideId: string) => void;
};

const SlideCard = ({
  moduleId,
  slide,
  selected,
  disabled = false,
  onToggleSelect,
}: SlideCardProps) => {
  return (
    <div className="group self-start w-fit max-w-[280px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
          <input
            id={`select-slide-${moduleId}-${slide.id}`}
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(moduleId, slide.id)}
            disabled={disabled}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor={`select-slide-${moduleId}-${slide.id}`} className="text-xs font-medium text-slate-700">
            Select
          </label>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-1 text-[11px] font-medium ${getStatusTagClass(getSlideProcessBadgeStatus(slide))}`}
          >
            {getSlideProcessBadgeStatus(slide)}
          </span>
        </div>
      </div>
      <h3>
        <a
          href={getSlideGoogleOpenUrl(slide)}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-sm font-semibold text-slate-800 transition-colors hover:text-sky-700"
        >
          {slide.slide_title}
        </a>
      </h3>
      {slide.slide_cover && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
          <DynamicImage
            src={slide.slide_cover}
            alt={`${slide.slide_title} cover`}
            maxWidth={220}
            disableHoverShadow
            className="rounded-md"
          />
        </div>
      )}
    </div>
  );
};

export default SlideCard;
