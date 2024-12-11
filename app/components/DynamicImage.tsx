'use client'
"use client";

import Image from "next/image";
import { useState, useEffect } from "react";

interface DynamicImageProps {
  src: string;
  alt: string;
  maxWidth?: number;
  className?: string;
}

export default function DynamicImage({ src, alt, className, maxWidth }: DynamicImageProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const img = new window.Image(); // Corrected type issue with "Image"
    img.src = src; // Set the image source
    img.onload = () => {
      setDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      }); // Fetch the original dimensions
    };
    img.onerror = () => {
      console.error("Failed to load image:", src); // Log error if image fails
    };
  }, [src]);

  if (!dimensions) {
    return <p>Loading image...</p>; // Placeholder while the image is loading
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={maxWidth && dimensions.width > maxWidth ? maxWidth : dimensions.width}
      height={maxWidth && dimensions.width > maxWidth ? dimensions.height / dimensions.width * maxWidth: dimensions.height}
      className={className}
      layout="intrinsic" // Preserve the original aspect ratio
    />
  );
}
