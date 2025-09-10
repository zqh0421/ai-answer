import ReactMarkdown from "react-markdown";
import { Reference } from "@/app/types";
import { Layers, ExternalLink, Loader2, ZoomIn, Volume2, Mic, MicOff } from "lucide-react";
import DynamicImage from "@/app/components/DynamicImage";
import { useState, useRef, useMemo, useEffect } from "react";
import axios from "axios";

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
  question?: string | Array<{ text?: string; [key: string]: unknown }>; // The question being asked (can be text or array of content)
  options?: string[]; // Multiple choice options if applicable
  correctAnswer?: string; // The correct answer for MCQ
  course_version?: string; // Course version to determine display behavior
}

export default function ReferenceArea({
  reference,
  isReferenceLoading,
  images,
  isImageLoading,
  loadedCount,
  totalCount,
  onImageClick,
  studentAnswer,
  feedback,
  question,
  options,
  correctAnswer,
  course_version,
}: ReferenceAreaProps) {
  const validImages = useMemo(() => images ?? [], [images]);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isRealtimeSessionActive, setIsRealtimeSessionActive] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // Default to muted
  const sessionRef = useRef<{ close: () => void; sendMessage?: (message: string) => void; muteInput?: () => void; unmuteInput?: () => void } | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [showVoiceChatHint, setShowVoiceChatHint] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [showDeviceList, setShowDeviceList] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // Get audio input devices
  useEffect(() => {
    const getAudioDevices = async () => {
      try {
        // Check if we're in a browser environment with media devices support
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          console.warn('Media devices API not available in this environment');
          return;
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioDevices(audioInputs);
        
        // Set default device if none selected
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch (error) {
        console.error('Error getting audio devices:', error);
      }
    };
    
    getAudioDevices();
    
    // Listen for device changes only if available
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
      
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
      };
    }
  }, [selectedDeviceId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up session when component unmounts
      if (sessionRef.current) {
        console.log("Cleaning up voice chat session on unmount");
        try {
          sessionRef.current.close();
        } catch (error) {
          console.error("Error cleaning up session:", error);
        }
      }
      
      // Clean up media stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      // Restore original getUserMedia only if available
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && originalGetUserMedia) {
        navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      }
    };
  }, []);

  // Handle mute/unmute functionality - UNMUTE DISABLED
  const handleMuteToggle = () => {
    // Unmute functionality is disabled - always keep muted
    console.log("Unmute functionality is disabled");
    return;
  };

  // Intercept getUserMedia to capture the actual stream being used
  const originalGetUserMedia = typeof navigator !== 'undefined' && navigator.mediaDevices ? navigator.mediaDevices.getUserMedia : null;
  
  // Handle realtime session
  const handleRealtimeSession = async () => {
    try {
      if (isRealtimeSessionActive && sessionRef.current) {
        // Disconnect existing session
        console.log("Disconnecting voice chat session...");
        try {
          sessionRef.current.close();
        } catch (disconnectError) {
          console.error("Error disconnecting session:", disconnectError);
        }

        setIsRealtimeSessionActive(false);
        setIsMuted(true); // Reset to muted state when session ends
        sessionRef.current = null;
        
        // Clean up media stream
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }
        
        // Restore original getUserMedia only if available
        if (typeof navigator !== 'undefined' && navigator.mediaDevices && originalGetUserMedia) {
          navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        }
        
        setAudioError(null);
        console.log("Voice chat session ended");
        return;
      }

      // Intercept getUserMedia calls to capture the stream and use selected device
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && originalGetUserMedia) {
        navigator.mediaDevices.getUserMedia = function(constraints?: MediaStreamConstraints) {
          console.log("getUserMedia called with constraints:", constraints);
          
          // Modify constraints to use selected device and start muted
          if (constraints?.audio && selectedDeviceId) {
            constraints.audio = { 
              deviceId: selectedDeviceId,
              ...((constraints.audio as any) || {})
            };
          }
          
          return originalGetUserMedia!.call(this, constraints).then(stream => {
            console.log("Captured media stream:", stream);
            if (constraints?.audio) {
              mediaStreamRef.current = stream;
              
              // Start with all audio tracks muted by default
              stream.getAudioTracks().forEach(track => {
                track.enabled = false;
                console.log("Muted audio track by default:", track.label);
              });
              
              console.log("Media stream captured via getUserMedia interception");
            }
            return stream;
          });
        };
      } else {
        console.warn('Media devices API not available, voice features will be disabled');
        setAudioError('Voice features are not available in this environment');
        return;
      }

      // Get ephemeral client secret from API
      const tokenResponse = await axios.post("/api/realtime-agent", {
        action: "getToken",
        sessionConfig: {
          session: {
            type: "realtime",
            model: "gpt-4o-realtime-preview-2024-12-17",
            audio: {
              output: {
                voice: "alloy",
                format: { type: "audio/pcm", rate: 24000 },
              },
            },
          },
        },
      });

      if (!tokenResponse.data.clientSecret) {
        console.error("Failed to get client secret");
        setAudioError("Failed to get client secret for voice chat");
        return;
      }

      // Import the realtime SDK dynamically
      const { RealtimeAgent, RealtimeSession } = await import(
        "@openai/agents-realtime"
      );

      // Build comprehensive context for the AI assistant
      let contextInstructions = `You are a helpful teaching assistant. You have access to the following information:\n\n`;

      // Add question context
      if (question) {
        // Handle both string and array question formats
        const questionText = Array.isArray(question)
          ? question
              .map((item) =>
                typeof item === "string" ? item : item.text || ""
              )
              .join(" ")
          : question;
        contextInstructions += `QUESTION: ${questionText}\n`;

        // Add multiple choice options if available
        if (options && options.length > 0) {
          contextInstructions += `OPTIONS:\n`;
          options.forEach((option, index) => {
            contextInstructions += `${String.fromCharCode(
              65 + index
            )}. ${option}\n`;
          });

          if (correctAnswer) {
            contextInstructions += `CORRECT ANSWER: ${correctAnswer}\n`;
          }
        }
        contextInstructions += "\n";
      }

      // Add student's answer
      if (studentAnswer) {
        contextInstructions += `STUDENT'S ANSWER: ${studentAnswer}\n\n`;
      }

      // Add feedback
      if (feedback) {
        contextInstructions += `FEEDBACK PROVIDED: ${feedback}\n\n`;
      }

      // Add reference material
      if (reference) {
        contextInstructions += `REFERENCE MATERIAL:\n`;
        contextInstructions += `Slide Title: ${reference.slide_title}\n`;
        contextInstructions += `Content: ${reference.display}\n\n`;
      }

      // Add information about slide images
      if (validImages.length > 0) {
        contextInstructions += `VISUAL CONTENT: There are ${validImages.length} slide image(s) available that show relevant diagrams, charts, or visual explanations related to this topic.\n\n`;
      }

      contextInstructions += `Your role is to:
1. Start by greeting the student and immediately point out specific areas in the reference material they should focus on
2. Connect their answer to specific concepts shown in the slides
3. DO NOT repeat the feedback already provided - instead, add new insights and connections
4. Reference specific parts of the visual content (e.g., "Look at the diagram in slide image 1...")
5. Help them understand how different concepts in the slides relate to each other
6. Guide them to discover patterns and connections they might have missed

IMPORTANT: Your FIRST response should:
- Acknowledge their answer briefly
- Immediately direct them to specific parts of the slide content
- Point out key visual elements or concepts they should examine
- Suggest how to connect different pieces of information from the slides
- Be specific about WHERE to look (e.g., "Notice the relationship between X and Y in the second image")

DO NOT repeat what's already in the feedback. Focus on guiding their attention to important details in the reference material.`;

      // Create agent with comprehensive context
      const agent = new RealtimeAgent({
        name: "Teaching Assistant",
        instructions: contextInstructions,
      });

      // Create session - WebRTC will be used automatically in browser with ephemeral key
      const session = new RealtimeSession(agent, {
        model: "gpt-4o-realtime-preview-2024-12-17",
        // transport is automatically selected based on environment
      });

      sessionRef.current = session;

      // Connect to the session with the ephemeral client secret
      await session.connect({
        apiKey: tokenResponse.data.clientSecret,
      });

      // Wait a moment for the session to establish WebRTC connection
      setTimeout(async () => {
        try {
          // Try to access the session's media stream for mute control
          if ((session as any).connection && (session as any).connection.localStream) {
            mediaStreamRef.current = (session as any).connection.localStream;
            console.log("Session media stream captured for mute control");
          } else if ((session as any).pc && (session as any).pc.getLocalStreams) {
            // Try WebRTC PeerConnection approach
            const streams = (session as any).pc.getLocalStreams();
            if (streams.length > 0) {
              mediaStreamRef.current = streams[0];
              console.log("WebRTC local stream captured for mute control");
            }
          } else {
            // Last resort: try to find any active media streams
            if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
              const devices = await navigator.mediaDevices.enumerateDevices();
              const audioDevice = devices.find(device => device.kind === 'audioinput');
              if (audioDevice) {
                console.log("Found audio input device:", audioDevice.label);
                // Get the current active stream using selected device
                const stream = await navigator.mediaDevices.getUserMedia({ 
                  audio: { deviceId: selectedDeviceId || audioDevice.deviceId } 
                });
                mediaStreamRef.current = stream;
                console.log("Audio device stream captured for mute control");
              }
            }
          }
        } catch (streamError) {
          console.log("Could not capture media stream for direct control:", streamError);
        }
      }, 1000); // Wait 1 second for WebRTC to establish

      setIsRealtimeSessionActive(true);
      console.log("Realtime session connected with ephemeral key");
      
      // Debug: Log available methods on the session
      console.log("Session methods:", Object.getOwnPropertyNames(session).filter(name => typeof (session as any)[name] === 'function'));
      console.log("Session prototype methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(session)).filter(name => typeof (session as any)[name] === 'function'));

      // Show hint popup
      setShowVoiceChatHint(true);
      setTimeout(() => {
        setShowVoiceChatHint(false);
      }, 5000); // Hide after 5 seconds

      // Add a small delay to ensure session is ready, then trigger AI greeting
      setTimeout(() => {
        console.log("Triggering AI greeting");

        // Send a minimal message to trigger the AI's initial response
        try {
          if (sessionRef.current && sessionRef.current.sendMessage) {
            sessionRef.current.sendMessage("");
            console.log("Initial trigger sent to AI");
          }
        } catch (err) {
          console.log("Session may already be speaking", err);
        }
      }, 1500);
    } catch (error) {
      console.error("Realtime session error:", error);
      setIsRealtimeSessionActive(false);
      setAudioError(
        `Failed to start voice chat: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  return (
    <div className="z-[99]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              Reference Material
            </h3>
            <p className="text-xs text-slate-600">
              Supporting content and slides
            </p>
          </div>
        </div>

        {/* Voice Chat Button - Hidden for v2a */}
        {course_version !== "v2a" && (
          <div className="flex items-center gap-2">
            {/* Realtime Voice Session Button */}
            {reference && !isReferenceLoading && (
              <>
                <button
                  onClick={handleRealtimeSession}
                  className={`
                     flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200
                     ${
                       isRealtimeSessionActive
                         ? "bg-red-100 text-red-700 hover:bg-red-200"
                         : "bg-green-100 text-green-700 hover:bg-green-200"
                     }
                   `}
                  title={
                    isRealtimeSessionActive
                      ? "End audio narration"
                      : "Listen to audio narration about this slide"
                  }
                >
                  <Volume2 className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {isRealtimeSessionActive ? "End Audio Narration" : "Audio Narration"}
                  </span>
                </button>
                
                {/* Mute Button - Always shown alongside voice chat button */}
                {
                  <div className="relative">
                    <button
                      onClick={handleMuteToggle}
                      onMouseEnter={() => setShowDeviceList(true)}
                      onMouseLeave={() => setShowDeviceList(false)}
                      disabled={true}
                      className={`
                         flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 disabled:opacity-75 disabled:cursor-not-allowed
                         bg-orange-100 text-orange-700
                       `}
                      title="Audio input is disabled for now"
                  >
                    <MicOff className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Muted
                      </span>
                    </button>
                    
                    {/* Audio Device List Dropdown */}
                    {showDeviceList && audioDevices.length > 0 && (
                      <div 
                        className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-10"
                        onMouseEnter={() => setShowDeviceList(true)}
                        onMouseLeave={() => setShowDeviceList(false)}
                      >
                        <div className="p-2">
                          <div className="text-xs font-medium text-gray-700 mb-2">Audio Input Devices</div>
                          {audioDevices.map((device) => (
                            <button
                              key={device.deviceId}
                              onClick={() => {
                                setSelectedDeviceId(device.deviceId);
                                setShowDeviceList(false);
                              }}
                              className={`w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-100 transition-colors ${
                                selectedDeviceId === device.deviceId ? 'bg-blue-50 text-blue-700' : 'text-gray-600'
                              }`}
                            >
                              <div className="truncate">
                                {device.label || `Microphone ${device.deviceId.slice(0, 8)}...`}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                }
              </>
            )}
          </div>
        )}
      </div>

      {/* Voice Chat Hint Popup - Hidden for v2a */}
      {showVoiceChatHint && course_version !== "v2a" && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg animate-pulse">
          <div className="flex items-start gap-2">
            <Volume2 className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-800">
                Audio Narration Started!
              </p>
              <p className="text-xs text-blue-600 mt-1">
                The Voice Assistant will speak to you. Audio input is disabled for now.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Audio Error Message - Hidden for v2a */}
      {audioError && course_version !== "v2a" && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{audioError}</p>
          {audioError.includes("blocked by browser") && (
            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
              <p className="text-xs text-blue-700">
                <strong>Solution:</strong> Allow the audio playing for this web
                page in your browser.
              </p>
            </div>
          )}
        </div>
      )}

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
            {/* Slide Images with text as alt text - Hidden for v2a */}
            {course_version !== "v2a" && validImages.length > 0 && !isImageLoading ? (
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-1 gap-4">
                  {validImages.map((src, index) => (
                    <div
                      key={index}
                      className="relative group cursor-pointer transition-all duration-300"
                      onClick={() => onImageClick?.(src, index)}
                      title={reference.display} // Shows text on hover
                    >
                      <div className="relative overflow-hidden rounded-lg border border-blue-200 hover:border-blue-400 transition-all duration-300">
                        <DynamicImage
                          src={`data:image/png;base64,${src}`}
                          alt={reference.display} // Text content as alt text
                          className="w-full h-auto object-contain"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300 flex items-center justify-center">
                          <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-300" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : course_version !== "v2a" && isImageLoading ? (
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
            ) : (
              /* Show text content only when no images are available - Hidden for v2a */
              course_version !== "v2a" && reference.display && (
                <div className="prose prose-sm max-w-none mb-6">
                  <div className="text-xs text-slate-500 leading-relaxed italic">
                    <ReactMarkdown>{reference.display}</ReactMarkdown>
                  </div>
                </div>
              )
            )}

            {/* Footer with page info and link */}
            <div className={`${course_version === "v2a" ? "mt-6" : "mt-6 pt-4 border-t border-blue-200"}`}>
              <div className={`flex items-center ${course_version === "v2a" ? "justify-start" : "justify-between"} text-sm text-slate-600`}>
                {/* Only show page number for non-v2a versions */}
                {course_version !== "v2a" && (
                  <span>Page {reference.page_number + 1}</span>
                )}
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
          <p className="text-sm text-slate-500">
            No reference available yet. Submit your answer to get started.
          </p>
        </div>
      )}
    </div>
  );
}
