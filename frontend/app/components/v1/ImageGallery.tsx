"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ZoomIn, X } from "lucide-react";
import DynamicImage from "@/app/components/v1/DynamicImage";

interface ImageGalleryProps {
  images: string[] | null;
  isImageLoading: boolean;
  loadedCount: number;
  totalCount: number;
}

export default function ImageGallery({ images, isImageLoading, loadedCount, totalCount }: ImageGalleryProps) {
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const validImages = images ?? []; // Ensure it's always an array

  return (
    <div>
      {/* Image Scrollable Gallery */}
      {validImages.length > 0 && !isImageLoading ? (
        <div className="flex space-x-4 overflow-x-scroll w-[70vw] p-4" style={{ scrollBehavior: "smooth" }}>
          {validImages.map((src, index) => (
            <div key={index} className="relative flex-shrink-0 flex justify-center items-center max-w-[80%]">
              <DynamicImage
                src={`data:image/png;base64,${src}`}
                alt={`PDF Page ${index}`}
                className="w-auto h-[90%] rounded-lg shadow-md mb-4"
                maxWidth={200}
              />

              {/* Enlarge Button (Top Right) */}
              <button
                className="absolute top-2 right-2 bg-white bg-opacity-80 p-2 rounded-full shadow-md hover:bg-opacity-100 transition z-20"
                onClick={() => setEnlargedImage(src)}
              >
                <ZoomIn size={20} className="text-gray-700" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <motion.p>
          {isImageLoading
            ? `Loading slide page...${totalCount > -1 ? `${loadedCount}/${totalCount}` : ``}`
            : "No slide page available"}
        </motion.p>
      )}
      
      {/* Enlarged Full-Screen Image Modal */}
      {enlargedImage && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center">
          <div className="relative max-w-[95vw] max-h-[95vh] flex justify-center items-center">
            {/* Enlarged Image */}
            <DynamicImage
              src={`data:image/png;base64,${enlargedImage}`}
              alt="Enlarged View"
              className="w-auto max-h-[90vh] rounded-lg shadow-lg"
            />

            {/* Close Button */}
            <button
              className="absolute top-4 right-4 bg-white bg-opacity-90 p-3 rounded-full shadow-lg hover:bg-opacity-100 transition"
              onClick={() => setEnlargedImage(null)}
            >
              <X size={24} className="text-gray-700" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
