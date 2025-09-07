import ReactMarkdown from "react-markdown";
import { Reference } from "@/app/types";
import { Layers, ExternalLink, Loader2, ZoomIn, Volume2 } from "lucide-react";
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
}: ReferenceAreaProps) {
  const validImages = useMemo(() => images ?? [], [images]);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isRealtimeSessionActive, setIsRealtimeSessionActive] = useState(false);
  const sessionRef = useRef<{ close: () => void; sendMessage?: (message: string) => void } | null>(null);
  const [showVoiceChatHint, setShowVoiceChatHint] = useState(false);

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
    };
  }, []);

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
        sessionRef.current = null;
        setAudioError(null);
        console.log("Voice chat session ended");
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
              input: {
                format: { type: "audio/pcm", rate: 24000 },
              },
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

      setIsRealtimeSessionActive(true);
      console.log("Realtime session connected with ephemeral key");

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

        {/* Voice Chat Button */}
        <div className="flex items-center gap-2">
          {/* Realtime Voice Session Button */}
          {reference && !isReferenceLoading && (
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
                  ? "End voice conversation"
                  : "Chat about this slide to better understand connections with your answer"
              }
            >
              <Volume2 className="w-4 h-4" />
              <span className="text-sm font-medium">
                {isRealtimeSessionActive ? "End Voice Chat" : "Voice Chat"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Voice Chat Hint Popup */}
      {showVoiceChatHint && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg animate-pulse">
          <div className="flex items-start gap-2">
            <Volume2 className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-800">
                Voice Chat Started!
              </p>
              <p className="text-xs text-blue-600 mt-1">
                If the Voice Assistant is NOT triggered, speak to start the
                conversation. The real-time Voice Assistant is listening and
                will respond to your follow-up questions about the slide.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Audio Error Message */}
      {audioError && (
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
            {/* Slide Images with text as alt text */}
            {validImages.length > 0 && !isImageLoading ? (
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
            ) : (
              /* Show text content only when no images are available */
              reference.display && (
                <div className="prose prose-sm max-w-none mb-6">
                  <div className="text-xs text-slate-500 leading-relaxed italic">
                    <ReactMarkdown>{reference.display}</ReactMarkdown>
                  </div>
                </div>
              )
            )}

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
          <p className="text-sm text-slate-500">
            No reference available yet. Submit your answer to get started.
          </p>
        </div>
      )}
    </div>
  );
}
