"use client";

import { X, ChevronLeft, ChevronRight } from "lucide-react";
import DynamicImage from "@/app/components/DynamicImage";

interface ImageModalProps {
  enlargedImage: string | null;
  setEnlargedImage: (image: string | null) => void;
  currentImageIndex: number;
  images: string[] | null;
  onPrevious: () => void;
  onNext: () => void;
}

export default function ImageModal({
  enlargedImage,
  setEnlargedImage,
  currentImageIndex,
  images,
  onPrevious,
  onNext,
}: ImageModalProps) {
  if (!enlargedImage) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 z-[999999] flex items-center justify-center p-4"
      style={{
        position: "fixed",
        top: "45px",
        left: 0,
        right: 0,
        bottom: 0,
      }}
      onClick={() => setEnlargedImage(null)}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={() => setEnlargedImage(null)}
          className="absolute -top-12 right-0 bg-white bg-opacity-90 p-2 rounded-full shadow-lg hover:bg-opacity-100 transition-all duration-200 z-10"
        >
          <X className="w-5 h-5 text-slate-700" />
        </button>

        {/* Navigation Buttons */}
        {currentImageIndex > 0 && (
          <button
            onClick={onPrevious}
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-white bg-opacity-90 p-3 rounded-full shadow-lg hover:bg-opacity-100 transition-all duration-200 z-10"
          >
            <ChevronLeft className="w-5 h-5 text-slate-700" />
          </button>
        )}

        {currentImageIndex < (images?.length || 0) - 1 && (
          <button
            onClick={onNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-white bg-opacity-90 p-3 rounded-full shadow-lg hover:bg-opacity-100 transition-all duration-200 z-10"
          >
            <ChevronRight className="w-5 h-5 text-slate-700" />
          </button>
        )}

        {/* Image */}
        <DynamicImage
          src={`data:image/png;base64,${enlargedImage}`}
          alt={`Slide ${currentImageIndex + 1}`}
          className="max-w-full max-h-[85vh] object-contain rounded-lg"
        />
      </div>
    </div>
  );
}
