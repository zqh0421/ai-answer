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
  const isDeepLinkMode = searchParams?.lti_mode === "deep_link";

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedPromptEngineering, setSelectedPromptEngineering] = useState<string>("rag_cot");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] = useState<string>("feature");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();
  const [courses, setCourses] = useState<Course[]>([]);
  const [module, setModule] = useState<string[]>([]);
  const [slide, setSlide] = useState<string[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [availableModules, setAvailableModules] = useState<Module[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  const handleAnswerChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const selectedAnswer = e.target.value;
    setAnswer(selectedAnswer);
    setSaveStatus("Saving...");
    debouncedSaveAnswer(selectedAnswer);
    
    // For MCQ, automatically fetch feedback when option is selected
    console.log("MCQ Check - Question type:", questionPreset?.type, "Has options:", !!questionPreset?.options);
    if (questionPreset?.type === "multiple choice" && questionPreset?.options) {
      // Find the index of the selected option
      const selectedIndex = questionPreset.options.findIndex((opt: any) => {
        const optionText = typeof opt === 'string' ? opt : opt.text;
        return optionText === selectedAnswer;
      });
      
      if (selectedIndex !== -1) {
        await fetchMCQFeedback(selectedIndex);
      }
    }
  };
  
  const fetchMCQFeedback = async (optionIndex: number) => {
    if (!questionPreset?.question_id) {
      console.log("Missing questionId for fetching MCQ feedback");
      return;
    }
    
    // Use prolificPid if available, otherwise use participantId from Redux, otherwise use a default
    const effectiveParticipantId = prolificPid || participantId || "anonymous_user";
    
    setIsFeedbackLoading(true);
    setIsReferenceLoading(true);
    
    // Record start time for MCQ interaction
    const startTime = Date.now();
    
    try {
      let feedbackResponse;
      
      // Handle v2a - use human feedback only
      if (course_version === "v2a") {
        feedbackResponse = await axios.post('/api/v2/mcq/get_human_feedback', {
          question_id: questionPreset.question_id,
          selected_option_index: optionIndex
        });
        
        console.log("MCQ Human Feedback Response:", {
          course_version: course_version,
          selected_option_index: optionIndex,
          feedback: feedbackResponse.data.feedback?.substring(0, 100) + '...',
          isCorrect: feedbackResponse.data.isCorrect
        });
      } else {
        // Fetch MCQ AI feedback (using the new AI-specific endpoint)
        feedbackResponse = await axios.post('/api/v2/mcq/get_ai_feedback', {
          question_id: questionPreset.question_id,
          participant_id: effectiveParticipantId,
          selected_option_index: optionIndex,
          course_version: course_version
        });
        
        console.log("MCQ AI Feedback Response:", {
          participant_id: effectiveParticipantId,
          course_version: course_version,
          feedbackType: feedbackResponse.data.feedbackType,
          attemptCount: feedbackResponse.data.attemptCount,
          feedback: feedbackResponse.data.feedback?.substring(0, 100) + '...',
          isCorrect: feedbackResponse.data.isCorrect
        });
      }
      
      const feedbackData = feedbackResponse.data;
      
      // Format the result for display in the feedback panel
      // The feedback is already structured from backend
      const formattedResult = {
        feedback: feedbackData.feedback,
        score: feedbackData.isCorrect ? "1" : "0",
        structured_feedback: feedbackData.structured_feedback || feedbackData.feedback
      };
      
      setResult(formattedResult);
      
      // Set prompt version based on feedback type (only for AI feedback)
      if (course_version !== "v2a") {
        const version = feedbackData.feedbackType === 'learner' ? 'prompt_learner' : 'prompt_corrective';
        setPromptVersion(version);
        console.log("Setting prompt version:", version, "based on feedbackType:", feedbackData.feedbackType);
      } else {
        // For v2a (human feedback), no prompt version needed
        setPromptVersion("human_feedback");
        console.log("Using human feedback for v2a");
      }
      
      // Find correct option(s) for embedding
      const correctOptions = questionPreset.options
        ?.map((opt: any, idx: number) => ({
          index: idx,
          text: typeof opt === 'string' ? opt : opt.text,
          isCorrect: typeof opt === 'object' ? opt.isCorrect : false
        }))
        .filter((opt: any) => opt.isCorrect)
        .map((opt: any) => opt.text);
      
      // Fetch relevant slides using embed API with correct answer context
      await handleRetrieveForMCQ(correctOptions || []);
      
      // Record MCQ result to database
      const endTime = Date.now();
      const selectedOption = questionPreset.options?.[optionIndex];
      const selectedText = typeof selectedOption === 'string' ? selectedOption : selectedOption?.text || "";
      
      const recordPayload: RecordResultInput = {
        learner_id: effectiveParticipantId,
        study_id: studyId || "unidentifiable_study",
        session_id: sessionId || "unidentifiable_session",
        question_id: questionPreset.question_id,
        answer: selectedText,
        feedback: typeof feedbackData.feedback === 'string' ? feedbackData.feedback : JSON.stringify(feedbackData.feedback),
        prompt_engineering_method: "rag_cot",
        preferred_info_type: preferredInfoType,
        feedback_framework: selectedFeedbackFramework,
        submission_time: startTime,
        system_total_response_time: endTime - startTime,
      };
      
      await recordResultToDatabase(recordPayload);
      console.log("MCQ result recorded:", {
        option_index: optionIndex,
        is_correct: feedbackData.isCorrect,
        feedback_type: feedbackData.feedbackType,
        response_time: endTime - startTime
      });
      
    } catch (error) {
      console.error("Error fetching MCQ feedback:", error);
      
      // Show error message instead of fallback
      const errorMessage = (error as any).response?.data?.detail || "Failed to get feedback";
      
      setResult({
        feedback: errorMessage,
        score: "",
        structured_feedback: `<div class="error-feedback">
          <statement>Error</statement>
          <explanation>${errorMessage}</explanation>
        </div>`
      });
      
      console.log("MCQ feedback error:", {
        status: (error as any).response?.status,
        message: errorMessage
      });
    } finally {
      setIsFeedbackLoading(false);
      setIsReferenceLoading(false);
    }
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
        // Debug log to check AI feedback structure
        console.log("MCQ Question Data:", {
          question_id: res.data.question_id,
          has_human_feedback: !!res.data.mcq_human_feedback,
          has_ai_feedback: !!res.data.mcq_ai_feedback,
          ai_feedback_type: res.data.mcq_ai_feedback ? typeof res.data.mcq_ai_feedback : 'none',
          ai_feedback_structure: res.data.mcq_ai_feedback ? 
            (Array.isArray(res.data.mcq_ai_feedback) ? 'array' : 
             (res.data.mcq_ai_feedback.corrective_feedback ? 'structured' : 'unknown')) : 'none',
          slide_ids: res.data.slide_ids
        });
        // Set slide IDs if available from the question data
        if (res.data.slide_ids && res.data.slide_ids.length > 0) {
          setSlide(res.data.slide_ids);
        }
        // If needed, prefill question input for non-preset usage
        if (!res.data?.content?.length) return;
        // Keep the original behavior of showing preset content and no free-input box
      })
      .catch((err) => {
        console.error("Error fetching question:", err);
      })
      .finally(() => setQuestionLoading(false));
  }, [question_id]);

  // 🔄 Fetch latest feedback AND reference materials for the participant when page loads
  useEffect(() => {
    if (!question_id || !questionPreset) return;
    
    const effectiveParticipantId = prolificPid || participantId;
    if (!effectiveParticipantId) return;
    
    const fetchLatestFeedbackAndReferences = async () => {
      try {
        // Fetch the latest feedback from database (not cache)
        const response = await axios.get(`/api/v2/mcq/get_latest_feedback/${question_id}/${effectiveParticipantId}`);
        
        if (response.data.hasLatestFeedback) {
          console.log("Loading latest feedback for participant:", {
            participant_id: effectiveParticipantId,
            has_feedback: true,
            selected_option_index: response.data.selectedOptionIndex,
            submission_time: response.data.submission_time,
            has_reference: !!response.data.reference_slide_id
          });
          
          // Set the result to display the latest feedback
          const formattedResult = {
            feedback: response.data.feedback,
            score: response.data.isCorrect ? "1" : "0",
            structured_feedback: response.data.feedback
          };
          setResult(formattedResult);
          
          // If we have the selected option index, also select that answer
          if (response.data.selectedOptionIndex >= 0 && questionPreset?.options) {
            const selectedOption = questionPreset.options[response.data.selectedOptionIndex];
            const selectedText = typeof selectedOption === 'string' 
              ? selectedOption 
              : selectedOption?.text || "";
            if (selectedText) {
              setAnswer(selectedText);
            }
          } else if (response.data.answer) {
            // Fallback to the stored answer text
            setAnswer(response.data.answer);
          }
          
          // Set prompt version if available
          if (response.data.prompt_engineering_method) {
            const version = response.data.prompt_engineering_method === 'rag_cot' 
              ? 'prompt_corrective' 
              : 'prompt_learner';
            setPromptVersion(version);
          }
          
          // Set reference material if available
          if (response.data.reference_slide_id && response.data.reference_slide_content) {
            const referenceData: Reference = {
              text: response.data.reference_slide_content,
              image_text: response.data.preferred_info_type === "vision" ? response.data.reference_slide_content : "",
              page_number: response.data.reference_slide_page_number || 1,
              slide_google_id: response.data.reference_slide_id,
              slide_title: "", // This might not be stored, but that's okay
              display: response.data.reference_slide_content
            };
            setReference(referenceData);
            
            // Also set the slide text array if available
            if (response.data.slide_retrieval_range) {
              setSlideTextArr(response.data.slide_retrieval_range);
            }
            
            // Fetch the slide images if we have the reference slide
            if (response.data.reference_slide_id && response.data.reference_slide_page_number) {
              setIsImageLoading(true);
              try {
                const pageNumber = response.data.reference_slide_page_number;
                const image = await handlePdfImage(pageNumber, response.data.reference_slide_id);
                if (image) {
                  setImages([image]);
                }
              } catch (error) {
                console.error("Error loading reference image:", error);
              } finally {
                setIsImageLoading(false);
              }
            }
          } else {
            // No reference stored in latest feedback, but we have a cached answer
            // Fetch reference materials for the current cached answer
            const cachedAnswer = question_id ? (answers[question_id] || "") : "";
            if (cachedAnswer && questionPreset?.options) {
              console.log("No stored reference, fetching for cached answer:", cachedAnswer);
              
              // Find which option was selected
              const selectedIndex = questionPreset.options.findIndex((opt: any) => {
                const optionText = typeof opt === 'string' ? opt : opt.text;
                return optionText === cachedAnswer;
              });
              
              if (selectedIndex !== -1) {
                // Find correct options for embedding
                const correctOptions = questionPreset.options
                  ?.map((opt: any, idx: number) => ({
                    index: idx,
                    text: typeof opt === 'string' ? opt : opt.text,
                    isCorrect: typeof opt === 'object' ? opt.isCorrect : false
                  }))
                  .filter((opt: any) => opt.isCorrect)
                  .map((opt: any) => opt.text);
                
                // Fetch relevant slides for the cached answer
                setIsReferenceLoading(true);
                setIsImageLoading(true);
                await handleRetrieveForMCQ(correctOptions || []);
              }
            }
          }
        } else {
          console.log("No previous feedback found for participant:", effectiveParticipantId);
          
          // Check if there's a cached answer even without feedback
          const cachedAnswer = question_id ? (answers[question_id] || "") : "";
          if (cachedAnswer && questionPreset?.options) {
            console.log("Loading reference for cached answer (no feedback):", cachedAnswer);
            
            // Find which option was selected
            const selectedIndex = questionPreset.options.findIndex((opt: any) => {
              const optionText = typeof opt === 'string' ? opt : opt.text;
              return optionText === cachedAnswer;
            });
            
            if (selectedIndex !== -1) {
              // Find correct options for embedding
              const correctOptions = questionPreset.options
                ?.map((opt: any, idx: number) => ({
                  index: idx,
                  text: typeof opt === 'string' ? opt : opt.text,
                  isCorrect: typeof opt === 'object' ? opt.isCorrect : false
                }))
                .filter((opt: any) => opt.isCorrect)
                .map((opt: any) => opt.text);
              
              // Fetch relevant slides for the cached answer
              setIsReferenceLoading(true);
              setIsImageLoading(true);
              await handleRetrieveForMCQ(correctOptions || []);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching latest feedback:", error);
      }
    };
    
    fetchLatestFeedbackAndReferences();
  }, [question_id, participantId, prolificPid, questionPreset]);

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

  const handleRetrieveForMCQ = async (correctOptions: string[]) => {
    try {
      // For MCQ, append the correct answer(s) to the question for better embedding
      const questionWithAnswer = [
        ...(questionPreset?.content || question),
        { 
          type: "text", 
          content: correctOptions.length > 0 
            ? `The correct answer is: ${correctOptions.join(', ')}`
            : ""
        }
      ];
      
      const response = await axios.post("/api/embed", {
        question_id: question_id || null,
        question: questionWithAnswer,
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

      // Fetch slide images for MCQ
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
    } catch (error) {
      console.error("Error during retrieval:", error);
      setIsImageLoading(false);
      setIsReferenceLoading(false);
    }
  };

  const handleRetrieve = async (): Promise<{ slide_text_arr: string[]; reference: Reference } | null> => {
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
      return null;
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
    
    // Handle v2a - use human feedback only
    if (course_version === "v2a") {
      if (questionPreset) {
        try {
          setIsFeedbackLoading(true);
          
          // Find the selected option index from the answer text
          let selectedOptionIndex = -1;
          if (questionPreset.options && answer) {
            for (let i = 0; i < questionPreset.options.length; i++) {
              const option = questionPreset.options[i];
              const optionText = typeof option === 'string' ? option : option?.text || "";
              if (optionText === answer) {
                selectedOptionIndex = i;
                break;
              }
            }
          }
          
          if (selectedOptionIndex >= 0) {
            const response = await axios.post('/api/v2/mcq/get_human_feedback', {
              question_id: questionPreset.question_id,
              selected_option_index: selectedOptionIndex
            });
            setResult(response.data.feedback);
          } else {
            setResult("Please select an option first.");
          }
          setIsFeedbackLoading(false);
        } catch (error) {
          console.error("Failed to get human feedback:", error);
          setResult("Failed to get human feedback for this option.");
          setIsFeedbackLoading(false);
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
    let retrievalResult: { slide_text_arr?: string[]; reference?: { page_number?: number; image_text?: string; text?: string; slide_google_id?: string } } | null = null;

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
      const response = await fetch('/api/generate_feedback_rag_stream', {
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

    } catch (error) {
      console.error("Error in streaming:", error);
      setIsStreaming(false);
      setIsFeedbackLoading(false);
      
      if ((error as Error).name === 'AbortError') {
        console.log('Streaming request was aborted');
        setResult("Request was cancelled");
      } else {
        setResult(`Error: ${(error as Error).message}`);
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
    let retrievalResult: { slide_text_arr?: string[]; reference?: { page_number?: number; image_text?: string; text?: string; slide_google_id?: string } } | null = null;

    if (course_version === "v2a") {
      if (questionPreset) {
        try {
          // Find the selected option index from the answer text
          let selectedOptionIndex = -1;
          if (questionPreset.options && answer) {
            for (let i = 0; i < questionPreset.options.length; i++) {
              const option = questionPreset.options[i];
              const optionText = typeof option === 'string' ? option : option?.text || "";
              if (optionText === answer) {
                selectedOptionIndex = i;
                break;
              }
            }
          }
          
          if (selectedOptionIndex < 0) {
            throw new Error("Please select an option first");
          }
          
          const response = await axios.post('/api/v2/mcq/get_human_feedback', {
            question_id: questionPreset.question_id,
            selected_option_index: selectedOptionIndex
          });
          const endTime = Date.now();
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
            slide_retrieval_range: [],
            reference_slide_page_number: -1,
            reference_slide_content: "",
            reference_slide_id: "",
            submission_time: startTime,
            system_total_response_time: endTime - startTime,
          };
          await recordResultToDatabase(recordPayload);

          setResult(response.data.feedback);
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
          response = await axios.post("/api/generate_feedback_rag", {
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
            axios.post("/api/generate_feedback", {
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
          question={questionPreset?.content || question}
          options={questionPreset?.options}
          correctAnswer={questionPreset?.options?.filter((opt: { text: string; isCorrect: boolean } | string) => typeof opt === 'object' && opt.isCorrect).map((opt: { text: string; isCorrect: boolean } | string) => typeof opt === 'string' ? opt : opt.text).join(', ')}
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
          isMCQ={true}
          promptVersion={promptVersion}
          showQuestion={isDeepLinkMode}
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
