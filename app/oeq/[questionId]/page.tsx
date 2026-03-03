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
    return JSON.parse(
      value.trim().replace(/^```json\s*/, "").replace(/\s*```$/, "")
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const readFirstString = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
};

const stringifyIfObject = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
};

const resolveRuntimeFeedbackContent = (raw: any): { feedbackText: string; structuredFeedback: string } => {
  const feedbackText = readFirstString(
    raw?.feedback,
    raw?.output,
    raw?.result,
    raw?.text,
    raw?.static_feedback_text,
    raw?.question_feedback_text,
    raw?.message
  );
  const structuredFeedback = readFirstString(
    raw?.structured_feedback,
    raw?.feedback_html,
    raw?.feedback,
    raw?.output,
    raw?.result,
    raw?.static_feedback_text,
    raw?.question_feedback_text
  );
  const fallbackFeedback = stringifyIfObject(raw?.feedback || raw?.output || raw?.result);
  return {
    feedbackText: feedbackText || fallbackFeedback,
    structuredFeedback: structuredFeedback || feedbackText || fallbackFeedback,
  };
};

const extractExplicitOeqScore = (value: unknown): Pick<RecordResultInput, "score_given" | "score_maximum"> => {
  const parsed = parseJsonLikeFeedback(value);
  const rawScore = parsed?.score;
  const numericScore =
    typeof rawScore === "number" ? rawScore : typeof rawScore === "string" ? Number(rawScore) : NaN;

  if (!Number.isFinite(numericScore)) return {};
  return {
    score_given: numericScore,
    score_maximum: 1,
  };
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
  const contentFromBlocks = Array.isArray(payload?.content_blocks)
    ? payload.content_blocks
        .map((block: any) => ({
          type: String(block?.type ?? block?.block_type ?? "text"),
          content: String(block?.content ?? block?.text_content ?? block?.media_url ?? ""),
        }))
        .filter((item: { content: string }) => Boolean(item.content))
    : [];

  return {
    ...payload,
    type: String(payload?.type ?? payload?.question_type ?? ""),
    content: Array.isArray(payload?.content) && payload.content.length > 0 ? payload.content : contentFromBlocks,
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
  // Dynamic route param: /oeq/[questionId]
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
  const isLtiMode = Boolean(searchParams?.lti_mode || launchId || ltiLaunchId);

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

  const [selectedPromptEngineering] = useState<string>("rag_cot");
  const [selectedFeedbackFramework] = useState<string>("feature");
  const [, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();
  const [courses, setCourses] = useState<Course[]>([]);
  const [module, setModule] = useState<string[]>([]);
  const [slide, setSlide] = useState<string[]>([]);

  const [, setAvailableModules] = useState<Module[]>([]);
  const [, setAvailableSlides] = useState<Slide[]>([]);

  const [preferredInfoType] = useState<string>("vision");

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
  const [testLearnerId, setTestLearnerId] = useState(() => learnerIdFromUrl || fallbackLearnerId);
  const normalizedTestLearnerId = testLearnerId.trim() || fallbackLearnerId;
  const effectiveLearnerId = isLtiMode
    ? learnerIdFromUrl || prolificPid || participantId || normalizedTestLearnerId
    : normalizedTestLearnerId;

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
      .get(`/api/questions/${question_id}`)
      .then((res) => {
        const normalizedQuestion = normalizeQuestionPresetFromApi(res.data);
        setQuestionPreset(normalizedQuestion);
        // If needed, prefill question input for non-preset usage
        if (!normalizedQuestion?.content?.length) return;
        // Keep the original behavior of showing preset content and no free-input box
      })
      .catch((err) => {
        console.error("Error fetching question:", err);
      })
      .finally(() => setQuestionLoading(false));
  }, [question_id]);

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

  const applyReferenceFromRuntimeResponse = async (feedbackData: any) => {
    const preferred = String(feedbackData?.preferred_info_type ?? preferredInfoType ?? "text").toLowerCase();
    const runtimeReference = feedbackData?.reference && typeof feedbackData.reference === "object" ? feedbackData.reference : null;
    const slideId = String(
      runtimeReference?.slide_google_id ??
      runtimeReference?.slide_id ??
      feedbackData?.reference_slide_id ??
      ""
    ).trim();
    const pageNumberRaw =
      runtimeReference?.page_number ??
      runtimeReference?.reference_slide_page_number ??
      feedbackData?.reference_slide_page_number;
    const pageNumber = typeof pageNumberRaw === "number" ? pageNumberRaw : Number(pageNumberRaw);
    const imageText = String(
      runtimeReference?.image_text ??
      (preferred === "vision" ? feedbackData?.reference_slide_content : "") ??
      ""
    );
    const text = String(runtimeReference?.text ?? feedbackData?.reference_slide_content ?? "");
    const displayText = imageText.trim() || text.trim();

    if (!slideId || !Number.isFinite(pageNumber) || pageNumber <= 0 || !displayText) {
      setReference(undefined);
      setImages(null);
      setSlideTextArr([""]);
      setTotalCount(-1);
      setLoadedCount(-1);
      setIsImageLoading(false);
      return;
    }

    const nextReference: Reference = {
      ...(runtimeReference ?? {}),
      page_number: pageNumber,
      slide_google_id: slideId,
      text,
      image_text: imageText,
      display: displayText,
    };
    setReference(nextReference);

    const retrievalRange = Array.isArray(feedbackData?.slide_retrieval_range)
      ? feedbackData.slide_retrieval_range.filter((item: unknown): item is string => typeof item === "string")
      : [];
    setSlideTextArr(retrievalRange.length > 0 ? retrievalRange : [displayText]);

    setIsImageLoading(true);
    setTotalCount(1);
    setLoadedCount(0);
    const image = await handlePdfImage(pageNumber, slideId);
    if (image) {
      setImages([image]);
      setLoadedCount(1);
    } else {
      setImages(null);
      setLoadedCount(0);
    }
    setIsImageLoading(false);
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

  const runOeqRuntimeFeedback = useCallback(async () => {
    if (!questionPreset?.question_id) return;
    const normalizedAnswer = isValidInput(answer) ? answer : "The student haven't provided any answer yet.";
    const startTime = Date.now();
    setIsFeedbackLoading(true);
    setIsReferenceLoading(true);
    setIsImageLoading(true);
    setIsStreaming(false);
    setStreamingContent("");
    setResult("");

    try {
      const resolvedComposition = await resolveCompositionForQuestion(questionPreset.question_id);
      const resolvedCompositionId = resolvedComposition?.composition_id || null;
      const feedbackResponse = await axios.post(
        `/api/questions/${questionPreset.question_id}/feedback-runtime`,
        {
          composition_id: resolvedCompositionId,
          learner_id: effectiveLearnerId,
          answer_text: normalizedAnswer,
          launch_id: launchId || null,
          lti_launch_id: ltiLaunchId || null,
        }
      );
      const feedbackData = feedbackResponse.data || {};
      const { feedbackText, structuredFeedback } = resolveRuntimeFeedbackContent(feedbackData);
      const displayFeedback = feedbackText || "No feedback is available for this question yet.";
      const displayStructuredFeedback = structuredFeedback || displayFeedback;

      setResult({
        feedback: displayFeedback,
        score: "",
        structured_feedback: displayStructuredFeedback,
      });

      const effectiveFeedbackMode =
        feedbackData.feedback_mode ??
        (resolvedComposition?.matched_rule_id ? resolvedComposition.feedback_mode : undefined);
      if (effectiveFeedbackMode === "runtime_generate") {
        setPromptVersion("prompt_corrective");
      } else if (effectiveFeedbackMode === "use_latest_version") {
        setPromptVersion("human_feedback");
      } else {
        setPromptVersion(null);
      }

      await applyReferenceFromRuntimeResponse(feedbackData);

      const runtimeReference = feedbackData?.reference && typeof feedbackData.reference === "object" ? feedbackData.reference : null;
      const retrievalRange = Array.isArray(feedbackData?.slide_retrieval_range)
        ? feedbackData.slide_retrieval_range.filter((item: unknown): item is string => typeof item === "string")
        : undefined;
      const referencePageNumberRaw =
        runtimeReference?.page_number ??
        runtimeReference?.reference_slide_page_number ??
        feedbackData?.reference_slide_page_number;
      const referencePageNumber =
        typeof referencePageNumberRaw === "number" ? referencePageNumberRaw : Number(referencePageNumberRaw);
      const referenceContent = String(
        runtimeReference?.image_text ??
        runtimeReference?.text ??
        feedbackData?.reference_slide_content ??
        ""
      );
      const referenceSlideId = String(
        runtimeReference?.slide_google_id ??
        runtimeReference?.slide_id ??
        feedbackData?.reference_slide_id ??
        ""
      );

      const endTime = Date.now();
      const recordPayload: RecordResultInput = {
        learner_id: effectiveLearnerId,
        study_id: studyId || "unidentifiable_study",
        session_id: sessionId || "unidentifiable_session",
        ...extractExplicitOeqScore(displayFeedback),
        question_id: questionPreset.question_id,
        answer: answer,
        feedback: displayFeedback,
        prompt_engineering_method: selectedPromptEngineering,
        preferred_info_type: preferredInfoType,
        feedback_framework: selectedFeedbackFramework,
        slide_retrieval_range: retrievalRange,
        reference_slide_page_number: Number.isFinite(referencePageNumber) ? referencePageNumber : undefined,
        reference_slide_content: referenceContent || undefined,
        reference_slide_id: referenceSlideId || undefined,
        submission_time: startTime,
        system_total_response_time: endTime - startTime,
      };
      await recordResultToDatabase(recordPayload);
    } catch (error: any) {
      console.error("Error generating OEQ runtime feedback:", error);
      const errorMessage = error?.response?.data?.detail || error?.message || "Failed to get feedback";
      setResult({
        feedback: String(errorMessage),
        score: "",
        structured_feedback: `<div class=\"error-feedback\"><statement>Error</statement><explanation>${String(errorMessage)}</explanation></div>`,
      });
      setReference(undefined);
      setImages(null);
    } finally {
      setIsFeedbackLoading(false);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
      setAbortController(null);
    }
  }, [
    answer,
    effectiveLearnerId,
    launchId,
    ltiLaunchId,
    preferredInfoType,
    questionPreset?.question_id,
    resolveCompositionForQuestion,
    selectedFeedbackFramework,
    selectedPromptEngineering,
    studyId,
    sessionId,
  ]);

  const stopStreaming = () => {
    if (abortController) {
      abortController.abort();
      setIsStreaming(false);
      setIsFeedbackLoading(false);
    }
  };

  const handleSmartSubmit = async () => {
    await runOeqRuntimeFeedback();
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question</p>
          {!isLtiMode ? (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Test Learner ID</label>
              <input
                type="text"
                value={testLearnerId}
                onChange={(e) => setTestLearnerId(e.target.value)}
                onBlur={() => setTestLearnerId((prev) => prev.trim() || fallbackLearnerId)}
                className="w-64 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 outline-none focus:border-slate-300"
                placeholder="test_learner_xxx"
              />
            </div>
          ) : null}
        </div>
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
