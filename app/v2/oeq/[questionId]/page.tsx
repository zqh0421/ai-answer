"use client";

import { useState, useEffect, Suspense, useCallback, useMemo, use } from "react";
import axios from "axios";
import { debounce } from "lodash";
import { useSelector, useDispatch } from "react-redux";

import { RootState, AppDispatch } from "@/app/store/store";
import { saveAnswer, saveDraftAnswer, saveDraftQuestion } from "@/app/slices/userSlice";
import { Question, QuestionContent } from "@/app/manage/question/page";

import TestDrawer from "@/app/components/TestDrawer";
import ParticipantModal from "@/app/components/ParticipantModal";
import ImageModal from "@/app/components/v2/ImageModal";
import LeftFeedbackPanel from "@/app/components/v2/LeftFeedbackPanel";
import RightInputPanel from "@/app/components/v2/RightInputPanel";
import { Reference, Course, Module, Slide, RecordResultInput, FeedbackResult } from "@/app/types";

function PageChildren({ 
  questionId, 
  searchParams 
}: { 
  questionId?: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Dynamic route param: /v2/oeq/[questionId]
  const question_id = questionId || "";

  // Optional query params (still supported)
  const course_version = searchParams?.version as string | undefined;

  // 🔎 Collect Prolific params from the URL if present
  const { prolificPid, studyId, sessionId } = useMemo(() => ({
    prolificPid: (searchParams?.PROLIFIC_PID as string) || undefined,
    studyId: (searchParams?.STUDY_ID as string) || undefined,
    sessionId: (searchParams?.SESSION_ID as string) || undefined,
  }), [searchParams]);

  const dispatch = useDispatch<AppDispatch>();

  const participantId = useSelector((state: RootState) => state.user.participantId);
  const answers = useSelector((state: RootState) => state.user.answers);
  const draftAnswer = useSelector((state: RootState) => state.user.draftAnswer);
  const draftQuestion = useSelector((state: RootState) => state.user.draftQuestion);

  const base_question = "";

  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);

  const [result, setResult] = useState<FeedbackResult | string>("");
  const [reference, setReference] = useState<Reference>();
  const [images, setImages] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(-1);
  const [loadedCount, setLoadedCount] = useState(-1);
  const [activeTab, setActiveTab] = useState("input");

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [useStreaming, setUseStreaming] = useState(true);
  const [promptVersion, setPromptVersion] = useState<string | null>(null);
  const [currentRecordId, setCurrentRecordId] = useState<number | null>(null);

  const [selectedPromptEngineering, setSelectedPromptEngineering] = useState<string>("rag_cot");
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] = useState<string>("feature");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();
  const [courses, setCourses] = useState<Course[]>([]);
  const [module, setModule] = useState<string[]>([]);
  const [slide, setSlide] = useState<string[]>([]);

  const [availableModules, setAvailableModules] = useState<Module[]>([]);
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);

  const [preferredInfoType, setPreferredInfoType] = useState<string>("vision");

  const [questionPreset, setQuestionPreset] = useState<Question>({
    question_id: "",
    type: "",
    content: [],
  });
  const [questionLoading, setQuestionLoading] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

  const [answer, setAnswer] = useState(
    question_id ? (answers[question_id] || "") : (draftAnswer || "")
  );
  const [question, setQuestion] = useState<QuestionContent[]>(
    draftQuestion ? [{ type: "text", content: draftQuestion }] : [{ type: "text", content: base_question }]
  );
  const [saveStatus, setSaveStatus] = useState("Saved");

  const debouncedSaveAnswer = useCallback(
    debounce((temp_answer: string) => {
      if (question_id) {
        dispatch(saveAnswer({ questionId: question_id, answer: temp_answer }));
      } else {
        dispatch(saveDraftAnswer(temp_answer));
      }
      setSaveStatus("Saved");
    }, 500),
    [dispatch, question_id]
  );

  const onSaveDraftQuestion = useCallback(
    (text: string) => {
      dispatch(saveDraftQuestion(text));
    },
    [dispatch]
  );

  const handleAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAnswer(e.target.value);
    setSaveStatus("Saving...");
    debouncedSaveAnswer(e.target.value);
  };

  // Load initial courses (for selectors)
  useEffect(() => {
    axios
      .get("/api/courses/public")
      .then((response) => setCourses(response.data))
      .catch((error) => {
        console.error("Error fetching the courses:", error);
        setMessage("Failed to load courses.");
      });
  }, []);

  // Auto-pick the first course when courses arrive
  useEffect(() => {
    if (courses.length > 0 && !course) setCourse(courses[0].course_id);
  }, [courses, course]);

  // Load modules for the selected course
  useEffect(() => {
    if (!course) return;
    axios
      .get(`/api/courses/by_id/${course}/modules`)
      .then((response) => {
        setAvailableModules(response.data.modules);
        setModule(response.data.modules.map((mod: Module) => mod.module_id));
      })
      .catch((error) => {
        console.error("Error fetching modules:", error);
        setMessage("Failed to load courses.");
      });
  }, [course]);

  // Load slides for selected modules
  useEffect(() => {
    if (!module.length) {
      setAvailableSlides([]);
      return;
    }
    const fetchSlides = async () => {
      try {
        const slideRequests = module.map((modId) => axios.get(`/api/modules/${modId}/slides`));
        const slideResponses = await Promise.all(slideRequests);
        const allSlides = slideResponses.flatMap((res) => res.data.slides);
        setAvailableSlides(allSlides);
        setSlide(allSlides.map((sld: Slide) => sld.id));
      } catch (error) {
        console.error("Error fetching the slides:", error);
      }
    };
    fetchSlides();
  }, [module]);

  // 🔑 Fetch question data from DB using dynamic route param question_id
  useEffect(() => {
    if (!question_id) return;
    setQuestionLoading(true);
    axios
      .get(`/api/questions/by_id/${question_id}`)
      .then((res) => {
        setQuestionPreset(res.data);
        // If needed, prefill question input for non-preset usage
        if (!res.data?.content?.length) return;
        // Keep the original behavior of showing preset content and no free-input box
      })
      .catch((err) => {
        console.error("Error fetching question:", err);
      })
      .finally(() => setQuestionLoading(false));
  }, [question_id]);

  // Connectivity ping (unchanged)
  useEffect(() => {
    axios
      .get("/api/test")
      .then((response) => {
        setMessage(response.data.message);
        setIsDrawerOpen(false);
      })
      .catch((error) => {
        console.error("Error fetching the API:", error);
        setMessage("Failed to load message.");
      });
  }, []);

  const handlePdfImage = async (pageNumber: number, slideId: string) => {
    try {
      const response = await axios.post(
        "/api/pdf-to-image",
        { slide_id: slideId, page_number: pageNumber },
        { timeout: 60000 }
      );
    
      return response.data.img_base64 as string | null;
    } catch (error) {
      console.error("Error fetching image:", error);
      return null;
    }
  };

  useEffect(() => {
    if (!isImageLoading) setLoadedCount(-1);
  }, [isImageLoading]);

  function handleInputResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  const handleRetrieve = async () => {
    try {
      const response = await axios.post("/api/embed", {
        question_id: question_id || null,
        question: questionPreset?.content?.length ? questionPreset.content : question,
        slideIds: slide,
        preferredInfoType: preferredInfoType,
      });
      const res = typeof response.data === "string" ? JSON.parse(response.data).result : response.data.result;
      setReference(res[0]);

      if (preferredInfoType === "vision" && res[0].image_text) {
        setReference({ ...res[0], display: res[0].image_text.replace(/\n\s*\n+/g, "\n") });
      } else if (res[0].text) {
        setReference({ ...res[0], display: res[0].text });
      } else {
        setReference({ ...res[0], display: "EMPTY REFERENCE" });
      }

      setSlideTextArr(
        res.map((item: Reference) => {
          if (preferredInfoType === "vision" && item.image_text) return item.image_text;
          if (item.text) return item.text;
          alert(`${item.slide_title} unpublished!`);
          return "";
        })
      );

      let temp: string[] = [];
      const page_number = res[0].page_number;
      const startPage = page_number;
      const endPage = page_number;
      setTotalCount(endPage - startPage + 1);
      setLoadedCount(0);

      for (let i = startPage; i <= endPage; i++) {
        const image: string | null = await handlePdfImage(i, res[0].slide_id);
        if (image !== null) {
          setLoadedCount((prevCount) => prevCount + 1);
          temp = [...temp, image];
        }
      }

      setImages(temp);
      setIsImageLoading(false);
      setIsReferenceLoading(false);

      return {
        slide_text_arr: res.map((item: Reference) => {
          if (preferredInfoType === "vision" && item.image_text) return item.image_text;
          if (item.text) return item.text;
          alert(`${item.slide_title} unpublished!`);
          return "";
        }),
        reference: res[0] as Reference,
      };
    } catch (error) {
      console.error("Error fetching the result:", error);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
    }
  };

  const recordResultToDatabase = async (payload: RecordResultInput) => {
    try {
      const response = await axios.post("/api/record_result", payload);
      if (response.data?.id) {
        setCurrentRecordId(response.data.id);
        console.log("Record created with ID:", response.data.id);
      }
    } catch (error) {
      console.error("Error recording result to database:", error);
    }
  };

  function isValidInput(input: string): boolean {
    const alphanumericRegex = /[a-zA-Z0-9]/;
    return input.trim() !== "" && alphanumericRegex.test(input);
  }

  const handleStreamingSubmit = async () => {
    if (!question && !questionPreset) return;
    
    // Handle v2a - use human feedback only but still get reference for slide link
    if (course_version === "v2a") {
      if (questionPreset) {
        try {
          setIsFeedbackLoading(true);
          setIsReferenceLoading(true);
          
          // Get human feedback
          const response = await axios.get(`/api/v2/get_human_feedback_oeq/${questionPreset.question_id}`);
          setResult(response.data.human_feedback);
          
          // Get reference data for slide link (but won't display content)
          const retrievalResult = await handleRetrieve();
          
          setIsFeedbackLoading(false);
          setIsReferenceLoading(false);
        } catch (error) {
          console.error("Failed to get human feedback:", error);
          setIsFeedbackLoading(false);
          setIsReferenceLoading(false);
        }
      }
      return;
    }
    
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);
    setIsStreaming(true);
    setStreamingContent("");
    setResult("");

    const startTime = Date.now();
    let retrievalResult: any = null;

    // Create abort controller for canceling the request
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Handle retrieval for reference content and images
      if (["rag_zero", "rag_few", "rag_cot", "graph_rag"].includes(selectedPromptEngineering)) {
        retrievalResult = await handleRetrieve();
      }

      // Prepare the request payload
      const requestPayload = {
        participant_id: prolificPid || participantId || null,
        question_id: questionPreset.question_id || null,
        promptEngineering: selectedPromptEngineering,
        feedbackFramework: selectedFeedbackFramework,
        question: questionPreset.content || question,
        answer: isValidInput(answer) ? answer : "The student haven't provided any answer yet.",
        slide_text_arr: slideTextArr,
        isStructured: true,
        course_version: course_version || null,  // Include course_version
      };

      // Start streaming fetch
      const response = await fetch('/api/v2/generate_feedback_rag_stream_oeq', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      const decoder = new TextDecoder();
      let accumulatedText = "";
      let buffer = "";

      // Read the streaming response
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append new chunk to buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          
          // Handle [DONE] signal
          if (data === '[DONE]') {
            console.log(accumulatedText)
            setIsStreaming(false);
            setIsFeedbackLoading(false);
            
            // Try to parse as JSON, otherwise keep as plain text
            try {
              const cleanedText = accumulatedText.trim()
                .replace(/^```json\s*/, '')
                .replace(/\s*```$/, '');
              
              const parsed = JSON.parse(cleanedText);
              setResult(parsed?.structured_feedback || parsed?.feedback ? parsed : accumulatedText);
            } catch {
              setResult(accumulatedText);
            }
            
            const endTime = Date.now();

            // Record result to database
            if (questionPreset) {
              let feedbackForDB = accumulatedText;
              try {
                const parsed = JSON.parse(accumulatedText.trim().replace(/^```json\s*/, '').replace(/\s*```$/, ''));
                if (parsed?.structured_feedback) {
                  feedbackForDB = parsed.structured_feedback;
                }
              } catch {
                // Keep original text
              }
              
              const recordPayload: RecordResultInput = {
                learner_id: prolificPid || participantId || "unidentifiable_learner",
                study_id: studyId || "unidentifiable_study",
                session_id: sessionId || "unidentifiable_session",
                question_id: questionPreset.question_id,
                answer: answer,
                feedback: feedbackForDB,
                prompt_engineering_method: selectedPromptEngineering,
                preferred_info_type: preferredInfoType === "vision" && reference?.image_text ? "vision" : "text",
                feedback_framework: selectedFeedbackFramework,
                slide_retrieval_range: retrievalResult?.slide_text_arr,
                reference_slide_page_number: retrievalResult?.reference?.page_number,
                reference_slide_content:
                  preferredInfoType === "vision" && retrievalResult?.reference?.image_text
                    ? retrievalResult?.reference?.image_text
                    : reference?.text || "",
                reference_slide_id: retrievalResult?.reference?.slide_google_id,
                submission_time: startTime,
                system_total_response_time: endTime - startTime,
              };
              await recordResultToDatabase(recordPayload);
              
            }
            break;
          }
          
          // Check if it's metadata - handle it separately
          if (data) {
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'metadata' && parsed.prompt_version) {
                // Store prompt version but don't add to accumulated text
                setPromptVersion(parsed.prompt_version);
                console.log('Received prompt version:', parsed.prompt_version);
                // Don't add metadata to accumulatedText - skip to next iteration
                continue;
              }
            } catch {
              // Not JSON metadata, it's actual feedback content
            }
            
            // Only add non-metadata data to accumulated text
            accumulatedText += data;
            // Update streaming content immediately after appending data
            setStreamingContent(accumulatedText);
          }
        }
        
        // Also update streaming content with partial data in buffer if we have accumulated text
        // This ensures smoother streaming even if server sends partial chunks
        if (accumulatedText.length > 0 && buffer.length > 0) {
          setStreamingContent(accumulatedText + buffer);
        }
      }

    } catch (error: any) {
      console.error("Error in streaming:", error);
      setIsStreaming(false);
      setIsFeedbackLoading(false);
      
      if (error.name === 'AbortError') {
        console.log('Streaming request was aborted');
        setResult("Request was cancelled");
      } else {
        setResult(`Error: ${error.message}`);
      }
    } finally {
      setAbortController(null);
    }
  };

  const stopStreaming = () => {
    if (abortController) {
      abortController.abort();
      setIsStreaming(false);
      setIsFeedbackLoading(false);
    }
  };

  const handleSmartSubmit = async () => {
    // Use streaming for rag_cot method, regular for others
    if (useStreaming && selectedPromptEngineering === "rag_cot") {
      await handleStreamingSubmit();
    } else {
      await handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!question && !questionPreset) return;
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);

    const startTime = Date.now();
    let retrievalResult: any = null;

    if (course_version === "v2a") {
      if (questionPreset) {
        try {
          // Get human feedback
          const response = await axios.get(`/api/v2/get_human_feedback_oeq/${questionPreset.question_id}`);
          
          // Get reference data for slide link (but won't display content)
          retrievalResult = await handleRetrieve();
          
          const endTime = Date.now();
          const recordPayload: RecordResultInput = {
            learner_id: prolificPid || participantId || "unidentifiable_learner",
            study_id: studyId || "unidentifiable_study",
            session_id: sessionId || "unidentifiable_session",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.human_feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type: preferredInfoType === "vision" && reference?.image_text ? "vision" : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: retrievalResult?.slide_text_arr ? [retrievalResult.slide_text_arr.length] : [],
            reference_slide_page_number: retrievalResult?.reference?.page_number || -1,
            reference_slide_content: retrievalResult?.reference?.display || "",
            reference_slide_id: retrievalResult?.reference?.slide_google_id || "",
            submission_time: startTime,
            system_total_response_time: endTime - startTime,
          };
          await recordResultToDatabase(recordPayload);
          
          setResult(response.data.human_feedback);
          setIsFeedbackLoading(false);
          setIsImageLoading(false);
          setIsReferenceLoading(false);
        } catch (error) {
          console.error("Failed to record result:", error);
          setIsFeedbackLoading(false);
          setIsImageLoading(false);
          setIsReferenceLoading(false);
        }
      }
    } else {
      try {
        let response;
        if (["rag_zero", "rag_few", "rag_cot", "graph_rag"].includes(selectedPromptEngineering)) {
          retrievalResult = await handleRetrieve();
          response = await axios.post("/api/v2/generate_feedback_rag_oeq", {
            participant_id: prolificPid || participantId || null,
            question_id: questionPreset.question_id || null,
            promptEngineering: selectedPromptEngineering,
            feedbackFramework: selectedFeedbackFramework,
            question: questionPreset.content || question,
            answer: isValidInput(answer) ? answer : "The student haven't provided any answer yet.",
            slide_text_arr: slideTextArr,
            isStructured: true,
            course_version: course_version || null,  // Include course_version
          });
        } else {
          const [retrieval, feedbackResponse] = await Promise.all([
            handleRetrieve(),
            axios.post("/api/v2/generate_feedback_oeq", {
              promptEngineering: selectedPromptEngineering,
              feedbackFramework: selectedFeedbackFramework,
              question: questionPreset.content || question,
              answer: isValidInput(answer) ? answer : "The student haven't provided any answer yet.",
            }),
          ]);
          response = feedbackResponse;
          retrievalResult = retrieval;
        }

        const endTime = Date.now();

        if (questionPreset) {
          const recordPayload: RecordResultInput = {
            learner_id: prolificPid || participantId || "unidentifiable_learner",
            study_id: studyId || "unidentifiable_study",
            session_id: sessionId || "unidentifiable_session",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type: preferredInfoType === "vision" && reference?.image_text ? "vision" : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: retrievalResult?.slide_text_arr,
            reference_slide_page_number: retrievalResult?.reference?.page_number,
            reference_slide_content:
              preferredInfoType === "vision" && retrievalResult?.reference?.image_text
                ? retrievalResult?.reference?.image_text
                : reference?.text || "",
            reference_slide_id: retrievalResult?.reference?.slide_google_id,
            submission_time: startTime,
            system_total_response_time: endTime - startTime,
          };
          await recordResultToDatabase(recordPayload);
          
        }

        // Handle the response which might be structured or plain text
        const feedbackData = response.data.feedback || response.data;
        if (typeof feedbackData === 'string') {
          // Try to parse as JSON if it's a string
          try {
            const parsed = JSON.parse(feedbackData);
            if (parsed && typeof parsed === 'object' && ('structured_feedback' in parsed || 'feedback' in parsed)) {
              setResult(parsed);
            } else {
              setResult(feedbackData);
            }
          } catch {
            setResult(feedbackData);
          }
        } else {
          // Already an object
          setResult(feedbackData);
        }
        setIsFeedbackLoading(false);
      } catch (error) {
        console.error("Error generating feedback:", error);
        setIsFeedbackLoading(false);
      }
    }
  };

  const closeDrawer = () => setIsDrawerOpen(false);

  const handleImageClick = (image: string, index: number) => {
    setEnlargedImage(image);
    setCurrentImageIndex(index);
  };

  const handlePrevious = () => {
    if (currentImageIndex > 0 && images) {
      setCurrentImageIndex((idx) => idx - 1);
      setEnlargedImage(images[currentImageIndex - 1]);
    }
  };

  const handleNext = () => {
    if (images && currentImageIndex < images.length - 1) {
      setCurrentImageIndex((idx) => idx + 1);
      setEnlargedImage(images[currentImageIndex + 1]);
    }
  };

  return (
    <div className="">
      {/* If you only want to show the participant modal for Prolific flows, you can also gate this by prolificPid */}
      <ParticipantModal isOpen={!prolificPid && !participantId && !!course_version} />

      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />

      <div className="grid grid-cols-11 gap-2 h-full">
        <LeftFeedbackPanel
          result={result}
          reference={reference}
          isReferenceLoading={isReferenceLoading}
          images={images}
          isImageLoading={isImageLoading}
          loadedCount={loadedCount}
          totalCount={totalCount}
          onImageClick={handleImageClick}
          studentAnswer={answer}
          showFeedback={true}
          showReference={true}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          isFeedbackLoading={isFeedbackLoading}
          promptVersion={promptVersion}
          course_version={course_version}
          recordId={currentRecordId}
          sessionId={sessionId}
          participantId={prolificPid || participantId || null}
        />

        <RightInputPanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          course={course}
          setCourse={setCourse}
          module={module}
          setModule={setModule}
          slide={slide}
          setSlide={setSlide}
          question={question}
          setQuestion={setQuestion}
          answer={answer}
          setAnswer={setAnswer}
          questionPreset={questionPreset}
          questionLoading={questionLoading}
          isFeedbackLoading={isFeedbackLoading}
          isImageLoading={isImageLoading}
          isReferenceLoading={isReferenceLoading}
          saveStatus={saveStatus}
          onSubmit={handleSmartSubmit}
          onSaveDraftQuestion={onSaveDraftQuestion}
          questionId={question_id || undefined}
          onAnswerChange={handleAnswerChange}
          onInputResize={handleInputResize}
          useStreaming={useStreaming}
          setUseStreaming={setUseStreaming}
          isStreaming={isStreaming}
          stopStreaming={stopStreaming}
        />
      </div>

      <ImageModal
        enlargedImage={enlargedImage}
        setEnlargedImage={setEnlargedImage}
        currentImageIndex={currentImageIndex}
        images={images}
        onPrevious={handlePrevious}
        onNext={handleNext}
      />
    </div>
  );
}

export default function Page({ 
  params, 
  searchParams 
}: { 
  params: Promise<{ questionId?: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Unwrap the promises using React.use()
  const resolvedParams = use(params);
  const resolvedSearchParams = use(searchParams);
  
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PageChildren 
        questionId={resolvedParams?.questionId} 
        searchParams={resolvedSearchParams}
      />
    </Suspense>
  );
}
