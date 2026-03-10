import { Reference } from "@/app/types";
import {
  Layers,
  ExternalLink,
  Loader2,
  ZoomIn,
  Volume2,
} from "lucide-react";
import DynamicImage from "@/app/components/DynamicImage";
import {
  useState,
  useRef,
  useMemo,
  useEffect,
  useId,
  useCallback,
} from "react";
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
  recordId?: string | null;
  sessionId?: string;
  participantId?: string | null;
  debugEnabled?: boolean;
  debugData?: unknown;
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
  recordId,
  sessionId,
  participantId,
  debugEnabled = false,
  debugData,
}: ReferenceAreaProps) {
  const appendSlidePageAnchor = useCallback((url: string, pageNumber?: number | null) => {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const page = Number(pageNumber);
    if (!Number.isFinite(page) || page <= 0) return raw;
    // If backend already provided an explicit slide target (e.g. slide=id.g...),
    // do not override it with a page-based anchor.
    if (/slide=id\.[^&#\s]+/i.test(raw)) return raw;

    const hashIndex = raw.indexOf("#");
    if (hashIndex >= 0) {
      const base = raw.slice(0, hashIndex);
      const hash = raw.slice(hashIndex + 1).trim();
      if (!hash) return `${base}#slide=id.p${page}`;
      return `${base}#${hash}&slide=id.p${page}`;
    }
    return `${raw}#slide=id.p${page}`;
  }, []);

  const validImages = useMemo(() => images ?? [], [images]);
  const slideEmbedUrl = useMemo(() => {
    if (!reference) return "";
    const backendEmbedUrl = String(
      reference.most_relevant_slide_embed_url ??
      reference.slide_embed_url ??
      ""
    ).trim();
    const pageNumber = reference.most_relevant_page_number ?? reference.page_number ?? null;
    if (backendEmbedUrl) return appendSlidePageAnchor(backendEmbedUrl, pageNumber);
    if (!reference.slide_google_id) return "";
    return appendSlidePageAnchor(
      `https://docs.google.com/presentation/d/${reference.slide_google_id}/embed`,
      pageNumber
    );
  }, [appendSlidePageAnchor, reference]);
  const slideEmbedUrlError = useMemo(
    () => String(reference?.most_relevant_slide_embed_url_error ?? "").trim(),
    [reference?.most_relevant_slide_embed_url_error]
  );
  const slideOpenUrl = useMemo(() => slideEmbedUrl, [slideEmbedUrl]);
  const debugQueryParams = useMemo(() => {
    if (typeof window === "undefined") return {};
    return Object.fromEntries(new URLSearchParams(window.location.search).entries());
  }, []);
  const debugSlideUrlInfo = useMemo(() => {
    if (!slideEmbedUrl) return null;
    try {
      const parsed = new URL(slideEmbedUrl);
      return {
        href: parsed.href,
        origin: parsed.origin,
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
      };
    } catch {
      return {
        href: slideEmbedUrl,
        parse_error: "Invalid URL",
      };
    }
  }, [slideEmbedUrl]);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isRealtimeSessionActive, setIsRealtimeSessionActive] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // Default to muted
  const sessionRef = useRef<{
    close: () => void;
    sendMessage?: (message: string) => void;
    muteInput?: () => void;
    unmuteInput?: () => void;
  } | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [showVoiceChatHint, setShowVoiceChatHint] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [showDeviceList, setShowDeviceList] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isAudioTooltipVisible, setIsAudioTooltipVisible] = useState(false);
  const audioUsageIdRef = useRef<number | null>(null);

  const audioTooltipId = useId();
  const audioNarrationTooltipText =
    "May ask for microphone permission to activate the AI, but will NOT collect your audio data.";

  const logNarrationUsage = useCallback(
    async (action: "start" | "stop") => {
      if (!recordId || !sessionId) {
        return;
      }

      try {
        const payload: {
          action: "start" | "stop";
          session_id: string;
          timestamp: string;
          usage_id?: number;
        } = {
          action,
          session_id: sessionId,
          timestamp: new Date().toISOString(),
        };

        if (action === "stop" && audioUsageIdRef.current !== null) {
          payload.usage_id = audioUsageIdRef.current;
        }

        const response = await axios.post<{ usage_id?: number }>(
          `/api/record_result/${recordId}/audio-usage`,
          payload
        );

        if (action === "start") {
          const usageId = response.data?.usage_id ?? null;
          audioUsageIdRef.current = usageId;
        } else {
          audioUsageIdRef.current = null;
        }
      } catch (error) {
        console.error("Failed to log audio narration usage:", error);
      }
    },
    [recordId, sessionId]
  );

  // Get audio input devices
  useEffect(() => {
    const getAudioDevices = async () => {
      try {
        // Check if we're in a browser environment with media devices support
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.enumerateDevices
        ) {
          console.warn("Media devices API not available in this environment");
          return;
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(
          (device) => device.kind === "audioinput"
        );
        setAudioDevices(audioInputs);

        // Set default device if none selected
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch (error) {
        console.error("Error getting audio devices:", error);
      }
    };

    getAudioDevices();

    // Listen for device changes only if available
    if (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      navigator.mediaDevices.addEventListener
    ) {
      navigator.mediaDevices.addEventListener("devicechange", getAudioDevices);

      return () => {
        navigator.mediaDevices.removeEventListener(
          "devicechange",
          getAudioDevices
        );
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
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (audioUsageIdRef.current !== null) {
        void logNarrationUsage("stop");
      }

      // Restore original getUserMedia only if available
      if (
        typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        originalGetUserMedia
      ) {
        navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      }
    };
  }, [logNarrationUsage]);

  // Handle mute/unmute functionality - UNMUTE DISABLED
  const handleMuteToggle = () => {
    // Unmute functionality is disabled - always keep muted
    console.log("Unmute functionality is disabled");
    return;
  };

  // Intercept getUserMedia to capture the actual stream being used
  const originalGetUserMedia =
    typeof navigator !== "undefined" && navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia
      : null;

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

        if (audioUsageIdRef.current !== null) {
          await logNarrationUsage("stop");
        }

        // Clean up media stream
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        // Restore original getUserMedia only if available
        if (
          typeof navigator !== "undefined" &&
          navigator.mediaDevices &&
          originalGetUserMedia
        ) {
          navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        }

        setAudioError(null);
        console.log("Voice chat session ended");
        return;
      }

      // Intercept getUserMedia calls to capture the stream and use selected device
      if (
        typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        originalGetUserMedia
      ) {
        navigator.mediaDevices.getUserMedia = function (
          constraints?: MediaStreamConstraints
        ) {
          console.log("getUserMedia called with constraints:", constraints);

          // Modify constraints to use selected device and start muted
          if (constraints?.audio && selectedDeviceId) {
            constraints.audio = {
              deviceId: selectedDeviceId,
              ...((constraints.audio as any) || {}),
            };
          }

          return originalGetUserMedia!
            .call(this, constraints)
            .then((stream) => {
              console.log("Captured media stream:", stream);
              if (constraints?.audio) {
                mediaStreamRef.current = stream;

                // Start with all audio tracks muted by default
                stream.getAudioTracks().forEach((track) => {
                  track.enabled = false;
                  console.log("Muted audio track by default:", track.label);
                });

                console.log(
                  "Media stream captured via getUserMedia interception"
                );
              }
              return stream;
            });
        };
      } else {
        console.warn(
          "Media devices API not available, voice features will be disabled"
        );
        setAudioError("Voice features are not available in this environment");
        return;
      }

      // Get ephemeral client secret from API
      const tokenResponse = await axios.post("/api/realtime-agent", {
        action: "getToken",
        sessionConfig: {
          session: {
            type: "realtime",
            model: "gpt-realtime",
            audio: {
              output: {
                voice: "marin",
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
      let contextInstructions = `You are an expert instructor. Always respond in English, even if prompted otherwise. You have access to the following information:\n\n`;

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
        4. Reference specific parts of WHERE to look in this slide page(e.g., "Look at the diagram in slide image 1..., in the top right part of this slide page, ...")
        5. Help them understand how different concepts in the slides relate to each other
        6. Guide them to discover patterns and connections they might have missed

        IMPORTANT: Your FIRST response should:
        - Acknowledge their answer briefly
        - Immediately direct them to specific parts of the slide content
        - Point out key visual elements or concepts they should examine
        - Suggest how to connect different pieces of information from the slides
        
        DO NOT repeat what's already in the FEEDBACK PROVIDED. Focus on guiding their attention to important details in the reference material.`;

      // Create agent with comprehensive context
      const agent = new RealtimeAgent({
        name: "Teaching Assistant",
        instructions: contextInstructions,
      });

      const pidValue = (participantId || "").trim();
      const feedbackContent = (feedback || "").trim();
      const traceMetadataEntries = [
        ["pid", pidValue.length > 0 ? pidValue : null],
        ["feedback", feedbackContent.length > 0 ? feedbackContent : null],
      ] as const;

      const traceMetadata = traceMetadataEntries.reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (value && value.length > 0) {
            acc[key] = value;
          }
          return acc;
        },
        {}
      );

      const hasTraceMetadata = Object.keys(traceMetadata).length > 0;

      // Create session - WebRTC will be used automatically in browser with ephemeral key
      const workflowName = hasTraceMetadata ? "ai_reference_narration" : undefined;

      const session = new RealtimeSession(agent, {
        model: "gpt-realtime",
        traceMetadata: hasTraceMetadata ? traceMetadata : undefined,
        groupId: recordId ? `record-${recordId}` : undefined,
        workflowName,
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
          if (
            (session as any).connection &&
            (session as any).connection.localStream
          ) {
            mediaStreamRef.current = (session as any).connection.localStream;
            console.log("Session media stream captured for mute control");
          } else if (
            (session as any).pc &&
            (session as any).pc.getLocalStreams
          ) {
            // Try WebRTC PeerConnection approach
            const streams = (session as any).pc.getLocalStreams();
            if (streams.length > 0) {
              mediaStreamRef.current = streams[0];
              console.log("WebRTC local stream captured for mute control");
            }
          } else {
            // Last resort: try to find any active media streams
            if (typeof navigator !== "undefined" && navigator.mediaDevices) {
              const devices = await navigator.mediaDevices.enumerateDevices();
              const audioDevice = devices.find(
                (device) => device.kind === "audioinput"
              );
              if (audioDevice) {
                console.log("Found audio input device:", audioDevice.label);
                // Get the current active stream using selected device
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: { deviceId: selectedDeviceId || audioDevice.deviceId },
                });
                mediaStreamRef.current = stream;
                console.log("Audio device stream captured for mute control");
              }
            }
          }
        } catch (streamError) {
          console.log(
            "Could not capture media stream for direct control:",
            streamError
          );
        }
      }, 1000); // Wait 1 second for WebRTC to establish

      setIsRealtimeSessionActive(true);
      console.log("Realtime session connected with ephemeral key");

      await logNarrationUsage("start");

      // Debug: Log available methods on the session
      console.log(
        "Session methods:",
        Object.getOwnPropertyNames(session).filter(
          (name) => typeof (session as any)[name] === "function"
        )
      );
      console.log(
        "Session prototype methods:",
        Object.getOwnPropertyNames(Object.getPrototypeOf(session)).filter(
          (name) => typeof (session as any)[name] === "function"
        )
      );

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
      if (audioUsageIdRef.current !== null) {
        await logNarrationUsage("stop");
      }
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

        <div className="flex items-center gap-2">
          {/* Realtime Voice Session Button */}
          {reference && !isReferenceLoading && (
            <>
              <div
                className="relative"
                onMouseEnter={() => setIsAudioTooltipVisible(true)}
                onMouseLeave={() => setIsAudioTooltipVisible(false)}
              >
                <button
                  onClick={() => {
                    setIsAudioTooltipVisible(false);
                    handleRealtimeSession();
                  }}
                  className={`
                     flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200
                     ${
                       isRealtimeSessionActive
                         ? "bg-red-100 text-red-700 hover:bg-red-200"
                         : "bg-green-100 text-green-700 hover:bg-green-200"
                     }
                   `}
                  aria-label={
                    isRealtimeSessionActive
                      ? "End AI narration"
                      : "May ask for microphone permission to activate the AI, but we will NOT collect your audio data."
                  }
                  aria-describedby={
                    isAudioTooltipVisible ? audioTooltipId : undefined
                  }
                  onFocus={() => setIsAudioTooltipVisible(true)}
                  onBlur={() => setIsAudioTooltipVisible(false)}
                >
                  <Volume2 className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {isRealtimeSessionActive
                      ? "End AI Narration"
                      : "AI Narration"}
                  </span>
                </button>
                {isAudioTooltipVisible && (
                  <div
                    id={audioTooltipId}
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-[9999] mt-3 min-w-60 -translate-x-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
                  >
                    <span className="block text-left">
                      {audioNarrationTooltipText}
                    </span>
                    <div className="pointer-events-none absolute left-3/4 -top-[6px] -translate-x-1/2">
                      <div className="h-0 w-0 border-x-4 border-b-[6px] border-x-transparent border-b-slate-300"></div>
                      <div className="absolute left-1/2 top-[1px] -translate-x-1/2 h-0 w-0 border-x-[3px] border-b-[5px] border-x-transparent border-b-white"></div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showVoiceChatHint && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg animate-pulse">
          <div className="flex items-start gap-2">
            <Volume2 className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-800">
                Audio Narration Started!
              </p>
              <p className="text-xs text-blue-600 mt-1">
                The Voice Assistant will speak to you. Audio input is disabled
                for now.
              </p>
            </div>
          </div>
        </div>
      )}

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
            ) : null}

            {/* Footer with page info and link */}
            {/* Inline slide file preview (anchored to most relevant page when available) */}
              {slideEmbedUrl ? (
                <div className="mt-4 rounded-lg border border-blue-200 bg-white p-2">
                  <iframe
                    key={`slide-preview-${reference.slide_google_id}-${reference.most_relevant_page_number ?? "na"}`}
                    src={slideEmbedUrl}
                    title={reference.slide_title || "Reference slide preview"}
                    className="h-[420px] w-full rounded"
                    allowFullScreen
                  />
              </div>
            ) : null}

            <div className="mt-6 pt-4 border-t border-blue-200">
              <div
                className="flex items-center justify-between text-sm text-slate-600"
              >
                <div className="flex flex-wrap items-center gap-3">
                  {slideEmbedUrlError ? (
                    <span className="text-rose-600">
                      Embed URL error: {slideEmbedUrlError}
                    </span>
                  ) : null}
                </div>
                {reference.slide_google_id ? (
                  <a
                    href={slideOpenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors duration-200"
                  >
                    <span>{reference.slide_title || "Open slide"}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-slate-500">Resource unavailable</span>
                )}
              </div>

            </div>
            {debugEnabled ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Debug Params
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-all rounded border border-amber-200 bg-white p-2 text-[11px] text-slate-700">
{JSON.stringify(
  {
    query_params: debugQueryParams,
    reference,
    computed_slide_embed_url: slideEmbedUrl,
    computed_slide_open_url: slideOpenUrl,
    parsed_slide_url: debugSlideUrlInfo,
    feedback_payload: debugData,
  },
  null,
  2
)}
                </pre>
              </div>
            ) : null}
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
