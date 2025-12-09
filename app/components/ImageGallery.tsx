"use client";

import { useState } from "react";
import { ZoomIn, X, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2 } from "lucide-react";
import DynamicImage from "@/app/components/DynamicImage";

interface ImageGalleryProps {
  images: string[] | null;
  isImageLoading: boolean;
  loadedCount: number;
  totalCount: number;
}

export default function ImageGallery({ images, isImageLoading, loadedCount, totalCount }: ImageGalleryProps) {
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
  const validImages = images ?? [];

  const handleImageClick = (image: string, index: number) => {
    setEnlargedImage(image);
    setCurrentImageIndex(index);
  };

  const handlePrevious = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
      setEnlargedImage(validImages[currentImageIndex - 1]);
    }
  };

  const handleNext = () => {
    if (currentImageIndex < validImages.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
      setEnlargedImage(validImages[currentImageIndex + 1]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (enlargedImage) {
      if (e.key === 'Escape') {
        setEnlargedImage(null);
      } else if (e.key === 'ArrowLeft') {
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    }
  };

  // Add keyboard event listener
  useState(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="space-y-4">
      {/* Gallery Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-emerald-600" />
          Slide Images
        </h4>
        {validImages.length > 0 && (
          <span className="text-sm text-slate-500">
            {validImages.length} image{validImages.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Image Gallery */}
      {validImages.length > 0 && !isImageLoading ? (
        <div className="relative">
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
            {validImages.map((src, index) => (
              <div
                key={index}
                className="relative flex-shrink-0 group cursor-pointer transition-all duration-300"
                onClick={() => handleImageClick(src, index)}
              >
                <div className="relative overflow-hidden rounded-lg border border-slate-200 hover:border-emerald-300 transition-all duration-300">
                  <DynamicImage
                    src={`data:image/png;base64,${src}`}
                    alt={`Slide ${index + 1}`}
                    className="w-48 h-32 object-cover"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300 flex items-center justify-center">
                    <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-300" />
                  </div>
                </div>
                <div className="absolute -top-2 -right-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-xs px-2 py-1 rounded-full">
                  {index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          {isImageLoading ? (
            <div className="space-y-3">
              <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto" />
              <p className="text-slate-600">
                Loading slide images...
                {totalCount > -1 && (
                  <span className="text-sm text-slate-500 block">
                    {loadedCount} of {totalCount} loaded
                  </span>
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <ImageIcon className="w-12 h-12 text-slate-300 mx-auto" />
              <p className="text-slate-500">No slide images available</p>
            </div>
          )}
        </div>
      )}
      
      {/* Enlarged Image Modal */}
      {enlargedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4 transition-all duration-300"
          onClick={() => setEnlargedImage(null)}
        >
          <div
            className="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center transition-all duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Navigation Buttons */}
            {currentImageIndex > 0 && (
              <button
                onClick={handlePrevious}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-gradient-to-r from-white to-slate-50 bg-opacity-90 p-3 rounded-full shadow-lg hover:from-slate-50 hover:to-white transition-all duration-300 z-10"
              >
                <ChevronLeft className="w-6 h-6 text-slate-700" />
              </button>
            )}
            
            {currentImageIndex < validImages.length - 1 && (
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-gradient-to-r from-white to-slate-50 bg-opacity-90 p-3 rounded-full shadow-lg hover:from-slate-50 hover:to-white transition-all duration-300 z-10"
              >
                <ChevronRight className="w-6 h-6 text-slate-700" />
              </button>
            )}

            {/* Image */}
            <DynamicImage
              src={`data:image/png;base64,${enlargedImage}`}
              alt={`Slide ${currentImageIndex + 1}`}
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />

            {/* Close Button */}
            <button
              onClick={() => setEnlargedImage(null)}
              className="absolute top-4 right-4 bg-gradient-to-r from-white to-slate-50 bg-opacity-90 p-3 rounded-full shadow-lg hover:from-slate-50 hover:to-white transition-all duration-300"
            >
              <X className="w-6 h-6 text-slate-700" />
            </button>

            {/* Image Counter */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-black to-slate-800 bg-opacity-70 text-white px-4 py-2 rounded-full text-sm">
              {currentImageIndex + 1} of {validImages.length}
            </div>

            {/* Keyboard Instructions */}
            <div className="absolute bottom-4 right-4 bg-gradient-to-r from-black to-slate-800 bg-opacity-70 text-white px-3 py-1 rounded text-xs">
              Use ← → to navigate, ESC to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
