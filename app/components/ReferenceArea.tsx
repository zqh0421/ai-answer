import ReactMarkdown from 'react-markdown';
import { Reference } from '@/app/types';
import { Layers, ExternalLink, Loader2, Image as ImageIcon, ZoomIn } from 'lucide-react';
import DynamicImage from "@/app/components/DynamicImage";

interface ReferenceAreaProps {
  reference: Reference | undefined;
  isReferenceLoading: boolean;
  images: string[] | null;
  isImageLoading: boolean;
  loadedCount: number;
  totalCount: number;
  onImageClick?: (image: string, index: number) => void;
}

export default function ReferenceArea({
  reference,
  isReferenceLoading,
  images,
  isImageLoading,
  loadedCount,
  totalCount,
  onImageClick,
}: ReferenceAreaProps) {
  const validImages = images ?? [];

  return (
    <div className="z-[99]">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">Reference Material</h3>
          <p className="text-xs text-slate-600">Supporting content and slides</p>
        </div>
      </div>
      
      {isReferenceLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading reference...</span>
          </div>
        </div>
      ) : reference ? (
        <div className="space-y-6">
          <div className="p-6 bg-blue-50 rounded-xl border border-blue-200">
            {/* Slide Images - Main Character */}
            {validImages.length > 0 && !isImageLoading ? (
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-1 gap-4">
                  {validImages.map((src, index) => (
                    <div
                      key={index}
                      className="relative group cursor-pointer transition-all duration-300"
                      onClick={() => onImageClick?.(src, index)}
                    >
                      <div className="relative overflow-hidden rounded-lg border border-blue-200 hover:border-blue-400 transition-all duration-300">
                        <DynamicImage
                          src={`data:image/png;base64,${src}`}
                          alt={`Slide ${index + 1}`}
                          className="w-full h-64 object-cover"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300 flex items-center justify-center">
                          <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-300" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : isImageLoading ? (
              <div className="text-center py-6 mb-6">
                <div className="space-y-3">
                  <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
                  <p className="text-blue-600">
                    Loading slide images...
                    {totalCount > -1 && (
                      <span className="text-sm text-blue-500 block">
                        {loadedCount} of {totalCount} loaded
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ) : null}
            
            {/* Note Text - Less Prominent */}
            <div className="prose prose-sm max-w-none mb-6">
              <div className="text-xs text-slate-500 leading-relaxed italic">
                <ReactMarkdown>{reference.display}</ReactMarkdown>
              </div>
            </div>
            
            {/* Footer with page info and link */}
            <div className="mt-6 pt-4 border-t border-blue-200">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Page {reference.page_number + 1}</span>
                <a
                  href={`https://docs.google.com/presentation/d/${reference.slide_google_id}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors duration-200"
                >
                  <span>{reference.slide_title}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No reference available yet. Submit your answer to get started.</p>
        </div>
      )}
    </div>
  );
}
