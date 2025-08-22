import ReactMarkdown from 'react-markdown';
import { Reference } from '@/app/types';
import { Layers, ExternalLink, Loader2, ZoomIn, Volume2, VolumeX } from 'lucide-react';
import DynamicImage from "@/app/components/DynamicImage";
import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface ReferenceAreaProps {
  reference: Reference | undefined;
  isReferenceLoading: boolean;
  images: string[] | null;
  isImageLoading: boolean;
  loadedCount: number;
  totalCount: number;
  onImageClick?: (image: string, index: number) => void;
  autoPlayNarration?: boolean; // Optional: auto-play narration when reference loads
  studentAnswer?: string; // Student's answer for contextual guidance
  feedback?: string; // Feedback to guide attention to specific areas
}

export default function ReferenceArea({
  reference,
  isReferenceLoading,
  images,
  isImageLoading,
  loadedCount,
  totalCount,
  onImageClick,
  autoPlayNarration = false,
  studentAnswer,
  feedback,
}: ReferenceAreaProps) {
  const validImages = images ?? [];
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioContextInitialized, setAudioContextInitialized] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Generate interactive teaching assistant narration using GPT-4o
  const generateNarration = async () => {
    if (!reference) return;

    setIsAudioLoading(true);
    setAudioError(null);

    try {
      console.log('Generating interactive narration with GPT-4o...');

      // Use the new interactive narration API
      const response = await axios.post('/api/interactive-narration', {
        student_answer: studentAnswer || "No answer provided",
        feedback: feedback || "No feedback provided",
        reference_content: reference.display,
        slide_title: reference.slide_title,
        page_number: reference.page_number + 1,
        has_images: validImages.length > 0,
        voice: 'alloy',
        slide_images: validImages // Pass the slide images for visual analysis
      });

      console.log('Interactive narration API response received:', response.status);

      if (response.data.audio_base64) {
        console.log('Interactive audio base64 received, length:', response.data.audio_base64.length);
        // Create audio blob and play it
        const audioBlob = new Blob([
          Uint8Array.from(atob(response.data.audio_base64), c => c.charCodeAt(0))
        ], { type: 'audio/mpeg' });
        
        const audioUrl = URL.createObjectURL(audioBlob);
        
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          
          // Add event listeners for better debugging
          audioRef.current.onloadeddata = () => {
            console.log('Audio loaded successfully');
          };
          
          audioRef.current.oncanplay = () => {
            console.log('Audio can play');
          };
          
          // Try to play with error handling and user interaction
          try {
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  console.log('Audio started playing');
                  setIsPlaying(true);
                })
                .catch((error) => {
                  console.error('Audio play failed:', error);
                  
                  // Handle autoplay policy errors
                  if (error.name === 'NotAllowedError' || error.message.includes('user agent') || error.message.includes('permission')) {
                    setAudioError('Audio blocked by browser. Please click the button again to enable audio playback.');
                  } else {
                    setAudioError(`Audio playback failed: ${error.message}`);
                  }
                  setIsPlaying(false);
                });
            }
          } catch (error) {
            console.error('Audio play error:', error);
            setAudioError(`Audio playback error: ${error}`);
            setIsPlaying(false);
          }
        }
      }
    } catch (error) {
      console.error('Audio generation error:', error);
      setAudioError('Failed to generate audio narration');
    } finally {
      setIsAudioLoading(false);
    }
  };

  // Initialize audio context on first user interaction
  const initializeAudioContext = () => {
    if (!audioContextInitialized) {
      try {
        // Create and resume audio context to enable audio playback
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const audioContext = new AudioContext();
          if (audioContext.state === 'suspended') {
            audioContext.resume();
          }
        }
        setAudioContextInitialized(true);
      } catch (error) {
        console.log('Audio context initialization:', error);
      }
    }
  };

  // Handle audio play/pause
  const handleAudioToggle = () => {
    // Initialize audio context on first click
    initializeAudioContext();
    
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else if (!isPlaying) {
      generateNarration();
    }
  };

  // Handle audio ended
  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  // Auto-play narration when reference loads (if enabled)
  useEffect(() => {
    if (autoPlayNarration && reference && !isReferenceLoading && !isAudioLoading && !isPlaying) {
      generateNarration();
    }
  }, [reference, isReferenceLoading, autoPlayNarration]);

  return (
    <div className="z-[99]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">Reference Material</h3>
            <p className="text-xs text-slate-600">Supporting content and slides</p>
          </div>
        </div>
        
                 {/* Audio Narration Buttons */}
         <div className="flex items-center gap-2">
           
           {/* Main Audio Narration Button */}
           {reference && !isReferenceLoading && (
             <button
               onClick={handleAudioToggle}
               disabled={isAudioLoading}
               aria-label={isAudioLoading ? 'Generating interactive narration...' : isPlaying ? 'Stop audio narration' : 'Play interactive teaching assistant narration'}
               className={`
                 flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200
                 ${isAudioLoading 
                   ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                   : isPlaying 
                     ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                     : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                 }
               `}
               title="Listen to interactive teaching assistant narration"
             >
               {isAudioLoading ? (
                 <Loader2 className="w-4 h-4 animate-spin" />
               ) : isPlaying ? (
                 <VolumeX className="w-4 h-4" />
               ) : (
                 <Volume2 className="w-4 h-4" />
               )}
               <span className="text-sm font-medium">
                 {isAudioLoading ? 'Generating...' : isPlaying ? 'Stop' : 'Listen'}
               </span>
             </button>
           )}
         </div>
      </div>
      
      {/* Audio Error Message */}
      {audioError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{audioError}</p>
          {audioError.includes('blocked by browser') && (
            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
              <p className="text-xs text-blue-700">
                <strong>解决方案:</strong> 点击浏览器地址栏左侧的锁图标 → 网站设置 → 声音 → 允许
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        onError={(e) => {
          console.error('Audio element error:', e);
          setIsPlaying(false);
          setAudioError('Audio playback failed');
        }}
        onLoadStart={() => console.log('Audio loading started')}
        onLoadedMetadata={() => console.log('Audio metadata loaded')}
        onCanPlay={() => console.log('Audio can play')}
        onPlay={() => console.log('Audio play event fired')}
        onPause={() => console.log('Audio pause event fired')}
        style={{ display: 'none' }}
        controls={false}
        preload="auto"
      />
      
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
