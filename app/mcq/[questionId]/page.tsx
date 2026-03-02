"use client";

import { useState, useEffect, Suspense, useCallback, useMemo, use } from "react";
import axios from "axios";
import { debounce } from "lodash";
import { useSelector, useDispatch } from "react-redux";

import { RootState, AppDispatch } from "@/app/store/store";
import { saveAnswer, saveDraftAnswer, saveDraftQuestion } from "@/app/slices/userSlice";
import { Question, QuestionContent } from "@/app/manage/question/page";

import ParticipantModal from "@/app/components/ParticipantModal";
import ImageModal from "@/app/components/ImageModal";
import LeftFeedbackPanel from "@/app/components/LeftFeedbackPanel";
import RightInputPanel from "@/app/components/RightInputPanel";
import { Reference, Course, Module, Slide, RecordResultInput, FeedbackResult } from "@/app/types";
import { buildDocumentTitle, buildQuestionResourceTitle } from "@/app/utils/title";

const parseJsonLikeFeedback = (value: unknown) => {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value.trim().replace(/^```json\s*/, "").replace(/\s*```$/, "")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const extractExplicitScore = (value: unknown): Pick<RecordResultInput, "score_given" | "score_maximum"> => {
  const parsed = parseJsonLikeFeedback(value);
  const rawScore = parsed?.score;
  const numericScore =
    typeof rawScore === "number" ? rawScore : typeof rawScore === "string" ? Number(rawScore) : NaN;
  if (!Number.isFinite(numericScore)) return {};
  return { score_given: numericScore, score_maximum: 1 };
};

const scoreFromIsCorrect = (isCorrect: unknown): Pick<RecordResultInput, "score_given" | "score_maximum"> => {
  if (typeof isCorrect !== "boolean") return {};
  return { score_given: isCorrect ? 1 : 0, score_maximum: 1 };
};

const extractQuestionPayload = (raw: any) => {
  if (!raw || typeof raw !== "object") return raw;
  const hasTopLevelQuestionData =
    Array.isArray(raw.content_blocks) ||
    Array.isArray(raw.interactions) ||
    Array.isArray(raw.options) ||
    Array.isArray(raw.content) ||
    typeof raw.question_type === "string" ||
    typeof raw.type === "string";
  if (hasTopLevelQuestionData) return raw;
  if (raw.question && typeof raw.question === "object") return { ...raw.question, ...raw };
  if (raw.item && typeof raw.item === "object") return { ...raw.item, ...raw };
  if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) return { ...raw.data, ...raw };
  return raw;
};

const normalizeQuestionPresetFromApi = (raw: any): Question => {
  const payload = extractQuestionPayload(raw);
  const normalizeOption = (option: any) => {
    if (typeof option === "string") {
      return { text: option, isCorrect: false };
    }
    return {
      text: String(
        option?.text ??
          option?.option_text ??
          option?.option_label ??
          option?.option_value ??
          option?.label ??
          ""
      ).trim(),
      isCorrect: Boolean(option?.isCorrect ?? option?.is_correct ?? option?.correct),
    };
  };
  const contentFromBlocks = Array.isArray(payload?.content_blocks)
    ? payload.content_blocks
        .map((block: any) => ({
          type: String(block?.type ?? block?.block_type ?? "text"),
          content: String(block?.content ?? block?.text_content ?? block?.media_url ?? ""),
        }))
        .filter((item: { content: string }) => Boolean(item.content))
    : [];
  const optionsFromInteractions = Array.isArray(payload?.interactions)
    ? payload.interactions
        .flatMap((interaction: any) =>
          Array.isArray(interaction?.options)
            ? interaction.options
            : Array.isArray(interaction?.interaction_options)
              ? interaction.interaction_options
              : []
        )
        .map((option: any) => normalizeOption(option))
        .filter((option: { text: string }) => Boolean(option.text))
    : [];
  const optionsFromTopLevel = Array.isArray(payload?.options)
    ? payload.options.map((option: any) => normalizeOption(option)).filter((option: { text: string }) => Boolean(option.text))
    : [];

  return {
    ...payload,
    type: String(payload?.type ?? payload?.question_type ?? ""),
    content: Array.isArray(payload?.content) && payload.content.length > 0 ? payload.content : contentFromBlocks,
    options: optionsFromTopLevel.length > 0 ? optionsFromTopLevel : optionsFromInteractions,
  };
};

type CompositionFeedbackMode = "use_latest_version" | "runtime_generate";
type CompositionResolveResponse = {
  composition_id?: string;
  matched_rule_id?: string | null;
  feedback_mode?: CompositionFeedbackMode;
  slide_mode?: string;
};
const createFallbackLearnerId = () => `test_learner_${Math.random().toString(36).slice(2, 10)}`;

function PageChildren({ 
  questionId, 
  searchParams 
}: { 
  questionId?: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Dynamic route param: /mcq/[questionId]
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
  const ltiLaunchId = (searchParams?.lti_launch_id as string) || undefined;
  const ltiUserId = (searchParams?.lti_user_id as string) || undefined;
  const launchId = (searchParams?.launch_id as string) || undefined;
  const compositionId = (searchParams?.composition_id as string) || undefined;
  const learnerIdFromUrl = (searchParams?.learner_id as string) || undefined;

  const dispatch = useDispatch<AppDispatch>();

  const participantId = useSelector((state: RootState) => state.user.participantId);
  const answers = useSelector((state: RootState) => state.user.answers);
  const draftAnswer = useSelector((state: RootState) => state.user.draftAnswer);
  const draftQuestion = useSelector((state: RootState) => state.user.draftQuestion);

  const base_question = "";

  const [, setMessage] = useState("Loading...");

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
  const [fallbackLearnerId] = useState(() => createFallbackLearnerId());
  const effectiveLearnerId = learnerIdFromUrl || prolificPid || participantId || fallbackLearnerId;

  const resolveCompositionForQuestion = useCallback(async (resolvedQuestionId?: string) => {
    if (!compositionId || !resolvedQuestionId) return null;
    try {
      const res = await axios.get<CompositionResolveResponse>(
        `/api/feedback-compositions/${encodeURIComponent(compositionId)}/resolve`,
        {
          params: {
            question_id: resolvedQuestionId,
            learner_id: effectiveLearnerId,
          },
        }
      );
      return res.data;
    } catch (error) {
      console.error("Error resolving composition:", error);
      return null;
    }
  }, [compositionId, effectiveLearnerId]);

  useEffect(() => {
    const resourceTitle = buildQuestionResourceTitle({
      questionId: questionPreset?.question_id || question_id,
      type: questionPreset?.type,
      content: questionPreset?.content,
    });
    document.title = buildDocumentTitle(resourceTitle);
  }, [questionPreset, question_id]);

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
    const normalizedType = String((questionPreset as any)?.question_type ?? questionPreset?.type ?? "").toLowerCase();
    const isMcqLikeType =
      normalizedType.includes("choice") ||
      normalizedType.includes("dropdown") ||
      normalizedType.includes("true_false") ||
      normalizedType.includes("mcq");
    console.log("MCQ Check - Question type:", normalizedType, "Has options:", !!questionPreset?.options);
    if (isMcqLikeType && questionPreset?.options) {
      // Find the index of the selected option
      const selectedIndex = questionPreset.options.findIndex((opt: any) => {
        const optionText =
          typeof opt === 'string'
            ? opt
            : (opt.text ?? opt.option_text ?? opt.option_label ?? opt.option_value ?? opt.label ?? "");
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
    
    // learner_id should come from URL; fallback is generated with test_learner_* prefix.
    const effectiveParticipantId = effectiveLearnerId;
    
    setIsFeedbackLoading(true);
    setIsReferenceLoading(true);
    
    // Record start time for MCQ interaction
    const startTime = Date.now();
    
    try {
      const selectedOption = questionPreset.options?.[optionIndex];
      const selectedText = typeof selectedOption === 'string' ? selectedOption : selectedOption?.text || "";
      const feedbackResponse = await axios.post(
        `/api/questions/${questionPreset.question_id}/feedback-runtime`,
        {
          composition_id: compositionId || null,
          learner_id: effectiveParticipantId,
          selected_option_index: optionIndex,
          answer_text: selectedText,
          launch_id: launchId || null,
          lti_launch_id: ltiLaunchId || null,
        }
      );
      const feedbackData = feedbackResponse.data || {};
      
      // Format the result for display in the feedback panel
      // The feedback is already structured from backend
      const formattedResult = {
        feedback: feedbackData.feedback || "",
        score: "",
        structured_feedback: feedbackData.structured_feedback || feedbackData.feedback || ""
      };
      
      setResult(formattedResult);
      
      // Set prompt label based on unified runtime feedback mode.
      if (feedbackData.feedback_mode === 'runtime_generate') {
        setPromptVersion("prompt_corrective");
      } else {
        setPromptVersion("human_feedback");
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
      const isCorrect =
        typeof selectedOption === 'object'
          ? Boolean((selectedOption as any).isCorrect ?? (selectedOption as any).is_correct ?? (selectedOption as any).correct)
          : false;
      
      const recordPayload: RecordResultInput = {
        learner_id: effectiveParticipantId,
        study_id: studyId || "unidentifiable_study",
        session_id: sessionId || "unidentifiable_session",
        ...scoreFromIsCorrect(isCorrect),
        question_id: questionPreset.question_id,
        answer: selectedText,
        feedback: typeof feedbackData.feedback === 'string' ? feedbackData.feedback : JSON.stringify(feedbackData.feedback || ""),
        prompt_engineering_method: "rag_cot",
        preferred_info_type: preferredInfoType,
        feedback_framework: selectedFeedbackFramework,
        submission_time: startTime,
        system_total_response_time: endTime - startTime,
      };
      
      await recordResultToDatabase(recordPayload);
      console.log("MCQ result recorded:", {
        option_index: optionIndex,
        is_correct: isCorrect,
        feedback_mode: feedbackData.feedback_mode,
        matched_rule_id: feedbackData.matched_rule_id,
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
      .get(`/api/questions/${question_id}`)
      .then((res) => {
        const normalizedQuestion = normalizeQuestionPresetFromApi(res.data);
        setQuestionPreset(normalizedQuestion);
        // Debug log to check AI feedback structure
        console.log("MCQ Question Data:", {
          question_id: normalizedQuestion.question_id,
          has_human_feedback: !!(normalizedQuestion as any).mcq_human_feedback,
          has_ai_feedback: !!(normalizedQuestion as any).mcq_ai_feedback,
          ai_feedback_type: (normalizedQuestion as any).mcq_ai_feedback ? typeof (normalizedQuestion as any).mcq_ai_feedback : 'none',
          ai_feedback_structure: (normalizedQuestion as any).mcq_ai_feedback ? 
            (Array.isArray((normalizedQuestion as any).mcq_ai_feedback) ? 'array' : 
             ((normalizedQuestion as any).mcq_ai_feedback.corrective_feedback ? 'structured' : 'unknown')) : 'none',
          slide_ids: normalizedQuestion.slide_ids
        });
        // Set slide IDs if available from the question data
        if (normalizedQuestion.slide_ids && normalizedQuestion.slide_ids.length > 0) {
          setSlide(normalizedQuestion.slide_ids);
        }
        // If needed, prefill question input for non-preset usage
        if (!normalizedQuestion?.content?.length) return;
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
      const response = await axios.post("/api/record_result", {
        ...payload,
        lti_launch_id: ltiLaunchId,
        lti_user_id: ltiUserId,
      }, {
        headers: {
          ...(ltiLaunchId ? { "x-lti-launch-id": ltiLaunchId } : {}),
          ...(ltiUserId ? { "x-lti-user-id": ltiUserId } : {}),
        },
      });
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
    if (!questionPreset?.question_id || !Array.isArray(questionPreset.options)) return;
    const selectedOptionIndex = questionPreset.options.findIndex((option: any) => {
      const optionText =
        typeof option === "string"
          ? option
          : (option?.text ?? option?.option_text ?? option?.option_label ?? option?.option_value ?? option?.label ?? "");
      return optionText === answer;
    });
    if (selectedOptionIndex < 0) {
      setResult("Please select an option first.");
      return;
    }
    await fetchMCQFeedback(selectedOptionIndex);
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
    await handleStreamingSubmit();
  };

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

  const questionDisplayText = useMemo(() => {
    const source = (questionPreset?.content?.length ? questionPreset.content : question) || [];
    const text = source
      .filter((item) => item?.type === "text" && typeof item?.content === "string")
      .map((item) => item.content.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
    return questionLoading ? "Question is loading..." : "No question content available.";
  }, [questionPreset?.content, question, questionLoading]);

  return (
    <div className="px-3 pb-3 pt-4 md:px-4 md:pb-4 md:pt-5">
      {/* If you only want to show the participant modal for Prolific flows, you can also gate this by prolificPid */}
      <ParticipantModal isOpen={!prolificPid && !participantId && !!course_version} />

      <section className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question</p>
        <p className="mt-1 text-sm text-slate-900">{questionDisplayText}</p>
      </section>

      <div className="grid h-full grid-cols-11 gap-2">
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
