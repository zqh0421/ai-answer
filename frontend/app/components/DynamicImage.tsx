'use client'

import Image from "next/image";
import { useState, useEffect } from "react";
import { Image as ImageIcon, AlertCircle } from "lucide-react";

interface DynamicImageProps {
  src: string;
  alt: string;
  maxWidth?: number;
  className?: string;
}

export default function DynamicImage({ src, alt, className, maxWidth }: DynamicImageProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!src) {
      setHasError(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    
    const img = new window.Image();
    img.src = src;
    
    img.onload = () => {
      setDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      setIsLoading(false);
    };
    
    img.onerror = () => {
      console.error("Failed to load image:", src);
      setHasError(true);
      setIsLoading(false);
    };
  }, [src]);

  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-r from-slate-100 to-slate-200 rounded-lg border border-slate-200 transition-all duration-300 ${className}`}>
        <div className="text-center p-4">
          <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Failed to load image</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div 
        className={`flex items-center justify-center bg-gradient-to-r from-slate-100 to-slate-200 rounded-lg border border-slate-200 transition-all duration-300 ${className}`}
      >
        <div className="text-center p-4">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-sm text-slate-500">Loading image...</p>
        </div>
      </div>
    );
  }

  if (!dimensions) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-r from-slate-100 to-slate-200 rounded-lg border border-slate-200 transition-all duration-300 ${className}`}>
        <div className="text-center p-4">
          <ImageIcon className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Processing image...</p>
        </div>
      </div>
    );
  }

  const finalWidth = maxWidth && dimensions.width > maxWidth ? maxWidth : dimensions.width;
  const finalHeight = maxWidth && dimensions.width > maxWidth 
    ? (dimensions.height / dimensions.width) * maxWidth 
    : dimensions.height;

  return (
    <div className="relative transition-all duration-300">
      <Image
        src={src}
        alt={alt}
        width={finalWidth}
        height={finalHeight}
        className={`${className} transition-all duration-300 hover:shadow-lg`}
        style={{
          maxWidth: '100%',
          height: 'auto',
        }}
        onLoad={() => setIsLoading(false)}
        onError={() => setHasError(true)}
      />
    </div>
  );
}
