import ReactMarkdown from 'react-markdown';
import ImageGallery from '@/app/components/ImageGallery';
import { Reference } from '@/app/types';
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';

interface ReferenceAreaProps {
  reference: Reference | undefined;
  isReferenceLoading: boolean;
  images: string[] | null;
  isImageLoading: boolean;
  loadedCount: number;
  totalCount: number;
}

export default function ReferenceArea({
  reference,
  isReferenceLoading,
  images,
  isImageLoading,
  loadedCount,
  totalCount,
}: ReferenceAreaProps) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg">
          <BookOpen className="w-4 h-4 text-white" />
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
          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown>{reference.display}</ReactMarkdown>
            </div>
            <div className="mt-4 pt-4 border-t border-emerald-200">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Page {reference.page_number + 1}</span>
                <a
                  href={`https://docs.google.com/presentation/d/${reference.slide_google_id}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-emerald-600 hover:text-emerald-700 transition-colors duration-200"
                >
                  <span>{reference.slide_title}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
          
          <ImageGallery 
            images={images} 
            isImageLoading={isImageLoading} 
            loadedCount={loadedCount} 
            totalCount={totalCount} 
          />
        </div>
      ) : (
        <div className="text-center py-8">
          <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No reference available yet. Submit your answer to get started.</p>
        </div>
      )}
    </div>
  );
}
