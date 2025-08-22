import ReactMarkdown from 'react-markdown';
import ImageGallery from '@/app/components/v1/ImageGallery';
import { Reference } from '@/app/types';

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
    <div className="mb-4 p-4 bg-gray-100 rounded-lg shadow-md h-fit w-full flex flex-col overflow-hidden">
      <h3 className="text-xl font-semibold">Reference:</h3>
      {reference && !isReferenceLoading ? (
        <div className="prose prose-sm">
          <ReactMarkdown>{reference.display}</ReactMarkdown>
          <p>(page {reference.page_number + 1})</p>
          <p>
            For full slide:{" "}
            <a
              href={`https://docs.google.com/presentation/d/${reference.slide_google_id}/edit`}
              target="_blank"
              className="text-blue-500"
            >
              {reference.slide_title}
            </a>
          </p>
        </div>
      ) : (
        <p>{isReferenceLoading ? "Loading reference..." : "No reference available"}</p>
      )}
      <ImageGallery images={images} isImageLoading={isImageLoading} loadedCount={loadedCount} totalCount={totalCount} />
    </div>
  );
}
