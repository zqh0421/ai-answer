"use client";

import { useState, useEffect, Suspense, useCallback, useMemo, use } from "react";
import axios from "axios";
import { debounce } from "lodash";
import { useSelector, useDispatch } from "react-redux";

import { RootState, AppDispatch } from "@/app/store/store";
import { saveAnswer, saveDraftAnswer, saveDraftQuestion } from "@/app/slices/userSlice";
import { Question, QuestionContent } from "@/app/manage/question/page";

import ParticipantModal from "@/app/components/ParticipantModal";
import AndrewIdModal from "@/app/components/AndrewIdModal";
import ImageModal from "@/app/components/ImageModal";
import LeftFeedbackPanel from "@/app/components/LeftFeedbackPanel";
import RightInputPanel from "@/app/components/RightInputPanel";
import { Reference, Course, Module, Slide, RecordResultInput, FeedbackResult } from "@/app/types";
import { buildDocumentTitle, buildQuestionResourceTitle } from "@/app/utils/title";
import { getAndrewIdFromCookie, setAndrewIdCookie } from "@/app/utils/andrewIdCookie";

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

const toFiniteNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const extractFeedbackFromUnknown = (
  value: unknown,
  depth = 0
): {
  feedbackText?: string;
  structuredFeedback?: string;
  textFeedback?: string;
  isStructured?: boolean;
  score?: number;
  maxScore?: number;
} => {
  if (value === null || value === undefined || depth > 3) return {};

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    const parsed = parseJsonLikeFeedback(trimmed);
    if (parsed) return extractFeedbackFromUnknown(parsed, depth + 1);
    return { feedbackText: trimmed, textFeedback: trimmed };
  }

  if (typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const nestedCandidates = [record.text_feedback, record.feedback, record.output, record.result, record.message];
  const nestedExtracted = nestedCandidates
    .map((candidate) => extractFeedbackFromUnknown(candidate, depth + 1))
    .find((candidate) => Object.keys(candidate).length > 0);

  const directFeedbackText = readFirstString(
    record.feedback,
    record.output,
    record.result,
    record.text,
    record.static_feedback_text,
    record.question_feedback_text,
    record.message
  );
  const directStructuredFeedback = readFirstString(
    record.structured_feedback,
    record.feedback_html,
    record.static_feedback_text,
    record.question_feedback_text
  );
  const directTextFeedback = readFirstString(
    record.text_feedback,
    record.feedback,
    record.output,
    record.result,
    record.text,
    record.static_feedback_text,
    record.question_feedback_text
  );

  return {
    feedbackText: readFirstString(directFeedbackText, nestedExtracted?.feedbackText),
    structuredFeedback: readFirstString(directStructuredFeedback, nestedExtracted?.structuredFeedback),
    textFeedback: readFirstString(directTextFeedback, nestedExtracted?.textFeedback),
    isStructured:
      typeof record.is_structured === "boolean"
        ? record.is_structured
        : nestedExtracted?.isStructured,
    score: toFiniteNumber(record.score) ?? nestedExtracted?.score,
    maxScore: toFiniteNumber(record.max_score) ?? nestedExtracted?.maxScore,
  };
};

const resolveRuntimeFeedbackContent = (
  raw: any
): {
  isStructured: boolean | null;
  feedbackText: string;
  structuredFeedback: string;
  textFeedback: string;
  score?: number;
  maxScore?: number;
} => {
  const extracted = extractFeedbackFromUnknown(raw);
  const baseFeedbackText = readFirstString(
    extracted.feedbackText,
    raw?.feedback,
    raw?.output,
    raw?.result,
    raw?.text,
    raw?.static_feedback_text,
    raw?.question_feedback_text,
    raw?.message
  );
  const structuredFeedbackRaw = readFirstString(
    extracted.structuredFeedback,
    raw?.structured_feedback,
    raw?.feedback_html,
    raw?.static_feedback_text,
    raw?.question_feedback_text
  );
  const textFeedbackRaw = readFirstString(
    extracted.textFeedback,
    raw?.text_feedback,
    raw?.feedback,
    raw?.output,
    raw?.result,
    raw?.text,
    raw?.static_feedback_text,
    raw?.question_feedback_text
  );
  const fallbackFeedback = stringifyIfObject(raw?.feedback || raw?.output || raw?.result || raw);
  const isStructured =
    typeof raw?.is_structured === "boolean"
      ? raw.is_structured
      : typeof extracted.isStructured === "boolean"
      ? extracted.isStructured
      : structuredFeedbackRaw && !textFeedbackRaw
      ? true
      : textFeedbackRaw && !structuredFeedbackRaw
      ? false
      : null;
  const scoreCandidate =
    toFiniteNumber(raw?.score) ?? extracted.score ?? NaN;
  const maxScoreCandidate =
    toFiniteNumber(raw?.max_score) ?? extracted.maxScore ?? NaN;
  const aiScoreResult =
    raw?.ai_score_result && typeof raw.ai_score_result === "object" ? raw.ai_score_result : null;
  const aiHasScore = Boolean(aiScoreResult?.has_score);
  const aiScoreRaw = aiScoreResult?.score;
  const aiMaxScoreRaw = aiScoreResult?.max_score;
  const aiScoreCandidate =
    typeof aiScoreRaw === "number" ? aiScoreRaw : typeof aiScoreRaw === "string" ? Number(aiScoreRaw) : NaN;
  const aiMaxScoreCandidate =
    typeof aiMaxScoreRaw === "number"
      ? aiMaxScoreRaw
      : typeof aiMaxScoreRaw === "string"
      ? Number(aiMaxScoreRaw)
      : NaN;
  const effectiveScoreCandidate = Number.isFinite(scoreCandidate)
    ? scoreCandidate
    : aiHasScore
    ? aiScoreCandidate
    : NaN;
  const effectiveMaxScoreCandidate = Number.isFinite(maxScoreCandidate)
    ? maxScoreCandidate
    : aiHasScore
    ? aiMaxScoreCandidate
    : NaN;
  const feedbackText = baseFeedbackText || textFeedbackRaw || structuredFeedbackRaw || fallbackFeedback;
  const resolvedStructuredFeedback = structuredFeedbackRaw || feedbackText || fallbackFeedback;
  const resolvedTextFeedback = textFeedbackRaw || feedbackText || fallbackFeedback;
  return {
    isStructured,
    feedbackText,
    structuredFeedback: resolvedStructuredFeedback,
    textFeedback: resolvedTextFeedback,
    ...(Number.isFinite(effectiveScoreCandidate) ? { score: effectiveScoreCandidate } : {}),
    ...(Number.isFinite(effectiveMaxScoreCandidate) ? { maxScore: effectiveMaxScoreCandidate } : {}),
  };
};

const extractExplicitOeqScore = (value: unknown): Pick<RecordResultInput, "score_given" | "score_maximum"> => {
  const parsed = parseJsonLikeFeedback(value);
  const rawScore = parsed?.score;
  const rawMaxScore = parsed?.max_score;
  const numericScore =
    typeof rawScore === "number" ? rawScore : typeof rawScore === "string" ? Number(rawScore) : NaN;
  const numericMaxScore =
    typeof rawMaxScore === "number" ? rawMaxScore : typeof rawMaxScore === "string" ? Number(rawMaxScore) : NaN;

  if (!Number.isFinite(numericScore)) return {};
  if (!Number.isFinite(numericMaxScore) || numericMaxScore <= 0) {
    return {
      score_given: numericScore,
      score_maximum: 1,
    };
  }
  return {
    score_given: numericScore,
    score_maximum: numericMaxScore,
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
  const rawSlideScope = payload?.slide_scope ?? payload?.current_version?.slide_scope;
  const normalizedSlideScope = Array.isArray(rawSlideScope)
    ? rawSlideScope
        .map((entry: any) => {
          const slideId = String(entry?.slide_id ?? entry?.id ?? "").trim();
          if (!slideId) return null;
          const pageStartRaw = entry?.page_start ?? entry?.start_page;
          const pageEndRaw = entry?.page_end ?? entry?.end_page;
          const pageStart = typeof pageStartRaw === "number" ? pageStartRaw : Number(pageStartRaw);
          const pageEnd = typeof pageEndRaw === "number" ? pageEndRaw : Number(pageEndRaw);
          return {
            ...entry,
            slide_id: slideId,
            slide_google_id: String(
              entry?.slide_google_id ??
              (entry?.slide && typeof entry.slide === "object" ? (entry.slide as any)?.slide_google_id : "") ??
              ""
            ).trim() || undefined,
            page_start: Number.isFinite(pageStart) ? pageStart : null,
            page_end: Number.isFinite(pageEnd) ? pageEnd : null,
          };
        })
        .filter(Boolean)
    : [];
  const normalizedSlideIds = (() => {
    const directIds = Array.isArray(payload?.slide_ids)
      ? payload.slide_ids.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (directIds.length > 0) return directIds;
    if (normalizedSlideScope.length > 0) {
      return normalizedSlideScope
        .map((entry: any) => String(entry?.slide_id ?? "").trim())
        .filter(Boolean);
    }
    return [];
  })();

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
    slide_ids: normalizedSlideIds,
    slide_scope: normalizedSlideScope as any,
  };
};

type CompositionFeedbackMode = "use_latest_version" | "runtime_generate";
type CompositionResolveResponse = {
  composition_id?: string;
  matched_rule_id?: string | null;
  feedback_mode?: CompositionFeedbackMode;
  slide_mode?: string;
};

type CompositionSlideMode = "slide_file" | "no_slide" | "most_relevant_slide_page" | "";
const normalizeCompositionSlideMode = (raw?: string): CompositionSlideMode => {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "";
  if (value === "no_slide" || value === "no-slide") return "no_slide";
  if (value === "slide_file" || value === "full_slide" || value === "slide-file" || value === "slidefile") {
    return "slide_file";
  }
  return "most_relevant_slide_page";
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
  const compositionDebugEnabled =
    String(searchParams?.debug_composition ?? "").toLowerCase() === "1" ||
    String(searchParams?.debug_composition ?? "").toLowerCase() === "true";
  const debugModeEnabled = String(searchParams?.debug ?? "").trim() === "1";

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
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);

  const [preferredInfoType] = useState<string>("vision");

  const [questionPreset, setQuestionPreset] = useState<Question>({
    question_id: "",
    type: "",
    content: [],
  });
  const [questionLoading, setQuestionLoading] = useState(false);
  const [compositionDebugInfo, setCompositionDebugInfo] = useState<any>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
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
  const [andrewId, setAndrewId] = useState("");
  const [isAndrewModalOpen, setIsAndrewModalOpen] = useState(false);
  const normalizedTestLearnerId = testLearnerId.trim() || fallbackLearnerId;
  const normalizedAndrewId = andrewId.trim();
  const effectiveLearnerId = isLtiMode
    ? learnerIdFromUrl || prolificPid || participantId || (debugModeEnabled ? normalizedTestLearnerId : normalizedAndrewId)
    : debugModeEnabled
      ? normalizedTestLearnerId
      : normalizedAndrewId;

  useEffect(() => {
    if (debugModeEnabled) {
      setIsAndrewModalOpen(false);
      return;
    }
    const savedAndrewId = getAndrewIdFromCookie();
    if (savedAndrewId) {
      setAndrewId(savedAndrewId);
      setIsAndrewModalOpen(false);
      return;
    }
    setAndrewId("");
    setIsAndrewModalOpen(true);
  }, [debugModeEnabled]);

  const handleSaveAndrewId = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setAndrewId(normalized);
    setAndrewIdCookie(normalized);
    setIsAndrewModalOpen(false);
  }, []);

  const ensureLearnerIdReady = useCallback(() => {
    if (debugModeEnabled) return true;
    if (normalizedAndrewId) return true;
    setIsAndrewModalOpen(true);
    return false;
  }, [debugModeEnabled, normalizedAndrewId]);

  useEffect(() => {
    const handleOpenAndrewIdModal = () => {
      if (debugModeEnabled) return;
      setIsAndrewModalOpen(true);
    };
    window.addEventListener("open-andrew-id-modal", handleOpenAndrewIdModal);
    return () => {
      window.removeEventListener("open-andrew-id-modal", handleOpenAndrewIdModal);
    };
  }, [debugModeEnabled]);

  useEffect(() => {
    if (!effectiveLearnerId) return;
    window.dispatchEvent(new CustomEvent("learner-id-updated", { detail: { learnerId: effectiveLearnerId } }));
  }, [effectiveLearnerId]);

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

  const buildQuestionLevelReference = useCallback((): Reference | undefined => {
    const slideScopeEntry = Array.isArray((questionPreset as any)?.slide_scope)
      ? (questionPreset as any).slide_scope[0]
      : undefined;
    const rawSlideId = String(
      slideScopeEntry?.slide_id ??
      questionPreset?.slide_ids?.[0] ??
      ""
    ).trim();
    if (!rawSlideId) return undefined;

    const questionSlides = Array.isArray((questionPreset as any)?.slides)
      ? (questionPreset as any).slides
      : Array.isArray((questionPreset as any)?.current_version?.slides)
        ? (questionPreset as any).current_version.slides
        : [];
    const matchedQuestionSlide = questionSlides.find((item: any) => {
      const candidateId = String(item?.id ?? item?.slide_id ?? "").trim();
      const candidateGoogleId = String(item?.slide_google_id ?? "").trim();
      return candidateId === rawSlideId || candidateGoogleId === rawSlideId;
    });
    const matchedSlide = availableSlides.find((item) => item.id === rawSlideId || item.slide_google_id === rawSlideId);
    const scopedSlideRecord =
      slideScopeEntry?.slide && typeof slideScopeEntry.slide === "object"
        ? (slideScopeEntry.slide as Record<string, unknown>)
        : undefined;
    const slideGoogleId = String(
      matchedSlide?.slide_google_id ??
      matchedQuestionSlide?.slide_google_id ??
      slideScopeEntry?.slide_google_id ??
      scopedSlideRecord?.slide_google_id ??
      ""
    ).trim();

    const pageStartRaw = slideScopeEntry?.page_start;
    const pageEndRaw = slideScopeEntry?.page_end;
    const pageStart =
      pageStartRaw === null || pageStartRaw === undefined
        ? null
        : typeof pageStartRaw === "number"
          ? pageStartRaw
          : Number.isFinite(Number(pageStartRaw))
            ? Number(pageStartRaw)
            : null;
    const pageEnd =
      pageEndRaw === null || pageEndRaw === undefined
        ? null
        : typeof pageEndRaw === "number"
          ? pageEndRaw
          : Number.isFinite(Number(pageEndRaw))
            ? Number(pageEndRaw)
            : null;
    const mostRelevantPageRaw = slideScopeEntry?.most_relevant_page_number;
    const mostRelevantPage =
      mostRelevantPageRaw === null || mostRelevantPageRaw === undefined
        ? null
        : typeof mostRelevantPageRaw === "number"
          ? mostRelevantPageRaw
          : Number.isFinite(Number(mostRelevantPageRaw))
            ? Number(mostRelevantPageRaw)
            : null;
    const slideTotalPagesRaw = slideScopeEntry?.slide_total_pages;
    const slideTotalPages =
      slideTotalPagesRaw === null || slideTotalPagesRaw === undefined
        ? null
        : typeof slideTotalPagesRaw === "number"
          ? slideTotalPagesRaw
          : Number.isFinite(Number(slideTotalPagesRaw))
            ? Number(slideTotalPagesRaw)
            : null;
    const slideEmbedUrl = String(
      slideScopeEntry?.most_relevant_slide_embed_url ??
      scopedSlideRecord?.most_relevant_slide_embed_url ??
      slideScopeEntry?.slide_embed_url ??
      scopedSlideRecord?.slide_embed_url ??
      slideScopeEntry?.most_relevant_slide_url ??
      scopedSlideRecord?.most_relevant_slide_url ??
      ""
    ).trim();
    const slideEmbedUrlError = String(
      slideScopeEntry?.most_relevant_slide_embed_url_error ??
      scopedSlideRecord?.most_relevant_slide_embed_url_error ??
      ""
    ).trim();
    const hasMostRelevantPage = Number.isFinite(mostRelevantPage as number) && Number(mostRelevantPage) > 0;

    return {
      text: "",
      image_text: "",
      display: "",
      page_number: hasMostRelevantPage ? Number(mostRelevantPage) : -1,
      page_start: pageStart,
      page_end: pageEnd,
      most_relevant_page_number: hasMostRelevantPage ? Number(mostRelevantPage) : null,
      slide_total_pages: slideTotalPages,
      slide_id: rawSlideId,
      slide_google_id: slideGoogleId,
      most_relevant_slide_embed_url: slideEmbedUrl || null,
      slide_embed_url: slideEmbedUrl || null,
      most_relevant_slide_embed_url_error: slideEmbedUrlError || null,
      slide_title: String(
        matchedSlide?.slide_title ??
        matchedQuestionSlide?.slide_title ??
        slideScopeEntry?.slide_title ??
        scopedSlideRecord?.slide_title ??
        "Open slide"
      ),
    };
  }, [availableSlides, questionPreset]);

  useEffect(() => {
    if (!hasSubmitted) return;
    if (!compositionId || !questionPreset?.question_id) return;
    let active = true;

    const hydrateCompositionSlideReference = async () => {
      const resolved = await resolveCompositionForQuestion(questionPreset.question_id);
      if (!active) return;

      const normalizedSlideMode = normalizeCompositionSlideMode(resolved?.slide_mode);
      const questionLevelReference = buildQuestionLevelReference();
      if (compositionDebugEnabled) {
        setCompositionDebugInfo({
          composition_id: compositionId,
          question_id: questionPreset.question_id,
          raw_slide_mode: resolved?.slide_mode ?? null,
          normalized_slide_mode: normalizedSlideMode,
          resolved,
          question_slide_ids: questionPreset?.slide_ids ?? [],
          question_slide_scope_first:
            Array.isArray((questionPreset as any)?.slide_scope) && (questionPreset as any)?.slide_scope?.length > 0
              ? (questionPreset as any).slide_scope[0]
              : null,
        });
      }

      if (normalizedSlideMode === "no_slide") {
        return;
      }
    };

    void hydrateCompositionSlideReference();
    return () => {
      active = false;
    };
  }, [buildQuestionLevelReference, compositionId, hasSubmitted, questionPreset?.question_id, resolveCompositionForQuestion]);

  useEffect(() => {
    setHasSubmitted(false);
    setReference(undefined);
    setImages(null);
    setSlideTextArr([""]);
    setTotalCount(-1);
    setLoadedCount(-1);
  }, [question_id, questionPreset?.question_id]);

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
    if (!hasSubmitted) return;
    axios
      .get("/api/courses/public")
      .then((response) => setCourses(response.data))
      .catch((error) => {
        console.error("Error fetching the courses:", error);
        setMessage("Failed to load courses.");
      });
  }, [hasSubmitted]);

  // Auto-pick the first course when courses arrive
  useEffect(() => {
    if (!hasSubmitted) return;
    if (courses.length > 0 && !course) setCourse(courses[0].course_id);
  }, [courses, course, hasSubmitted]);

  // Load modules for the selected course
  useEffect(() => {
    if (!hasSubmitted) return;
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
  }, [course, hasSubmitted]);

  // Load slides for selected modules
  useEffect(() => {
    if (!hasSubmitted) {
      setAvailableSlides([]);
      return;
    }
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
  }, [hasSubmitted, module]);

  // 🔑 Fetch question data from DB using dynamic route param question_id
  useEffect(() => {
    if (!question_id) return;
    setQuestionLoading(true);
    axios
      .get(`/api/questions/${question_id}`, {
        params: {
          include: "current_version,content_blocks,interactions,options,interaction_options",
        },
      })
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

  const applyReferenceFromRuntimeResponse = async (feedbackData: any): Promise<boolean> => {
    const preferred = String(feedbackData?.preferred_info_type ?? preferredInfoType ?? "text").toLowerCase();
    const runtimeReference = feedbackData?.reference && typeof feedbackData.reference === "object" ? feedbackData.reference : null;
    const slideGoogleId = String(
      runtimeReference?.slide_google_id ??
      feedbackData?.reference_slide_google_id ??
      feedbackData?.slide_google_id ??
      ""
    ).trim();
    const slideId = String(
      runtimeReference?.slide_id ??
      feedbackData?.reference_slide_id ??
      feedbackData?.slide_id ??
      ""
    ).trim();
    const slideTitle = String(
      runtimeReference?.slide_title ??
      feedbackData?.reference_slide_title ??
      feedbackData?.slide_title ??
      "Open slide"
    ).trim();
    const pageStartRaw =
      runtimeReference?.page_start ??
      feedbackData?.reference_page_start ??
      feedbackData?.page_start;
    const pageEndRaw =
      runtimeReference?.page_end ??
      feedbackData?.reference_page_end ??
      feedbackData?.page_end;
    const pageStart =
      pageStartRaw === null || pageStartRaw === undefined
        ? null
        : typeof pageStartRaw === "number"
          ? pageStartRaw
          : Number.isFinite(Number(pageStartRaw))
            ? Number(pageStartRaw)
            : null;
    const pageEnd =
      pageEndRaw === null || pageEndRaw === undefined
        ? null
        : typeof pageEndRaw === "number"
          ? pageEndRaw
          : Number.isFinite(Number(pageEndRaw))
            ? Number(pageEndRaw)
            : null;
    const mostRelevantPageRaw =
      runtimeReference?.most_relevant_page_number ??
      feedbackData?.most_relevant_page_number ??
      runtimeReference?.page_number ??
      runtimeReference?.reference_slide_page_number ??
      feedbackData?.reference_slide_page_number;
    const mostRelevantPage =
      mostRelevantPageRaw === null || mostRelevantPageRaw === undefined
        ? null
        : typeof mostRelevantPageRaw === "number"
          ? mostRelevantPageRaw
          : Number.isFinite(Number(mostRelevantPageRaw))
            ? Number(mostRelevantPageRaw)
            : null;
    const hasMostRelevantPage = Number.isFinite(mostRelevantPage as number) && (mostRelevantPage as number) > 0;
    const imageText = String(
      runtimeReference?.image_text ??
      (preferred === "vision" ? feedbackData?.reference_slide_content : "") ??
      ""
    );
    const text = String(runtimeReference?.text ?? feedbackData?.reference_slide_content ?? "");
    const displayText = imageText.trim() || text.trim();

    if (!slideGoogleId && !slideId && !displayText) {
      setReference(undefined);
      setImages(null);
      setSlideTextArr([""]);
      setTotalCount(-1);
      setLoadedCount(-1);
      setIsImageLoading(false);
      return false;
    }

    const nextReference: Reference = {
      ...(runtimeReference ?? {}),
      page_number: hasMostRelevantPage ? Number(mostRelevantPage) : -1,
      page_start: pageStart,
      page_end: pageEnd,
      most_relevant_page_number: hasMostRelevantPage ? Number(mostRelevantPage) : null,
      slide_total_pages:
        runtimeReference?.slide_total_pages ??
        feedbackData?.slide_total_pages ??
        null,
      slide_id: slideId || undefined,
      slide_google_id: slideGoogleId,
      most_relevant_slide_embed_url:
        String(
          runtimeReference?.most_relevant_slide_embed_url ??
          feedbackData?.most_relevant_slide_embed_url ??
          runtimeReference?.slide_embed_url ??
          feedbackData?.slide_embed_url ??
          runtimeReference?.most_relevant_slide_url ??
          feedbackData?.most_relevant_slide_url ??
          ""
        ).trim() || null,
      slide_embed_url:
        String(
          runtimeReference?.most_relevant_slide_embed_url ??
          feedbackData?.most_relevant_slide_embed_url ??
          runtimeReference?.slide_embed_url ??
          feedbackData?.slide_embed_url ??
          runtimeReference?.most_relevant_slide_url ??
          feedbackData?.most_relevant_slide_url ??
          ""
        ).trim() || null,
      most_relevant_slide_embed_url_error:
        String(
          runtimeReference?.most_relevant_slide_embed_url_error ??
          feedbackData?.most_relevant_slide_embed_url_error ??
          ""
        ).trim() || null,
      slide_title: slideTitle,
      text,
      image_text: imageText,
      display: displayText,
    };
    setReference(nextReference);

    const retrievalRange = Array.isArray(feedbackData?.slide_retrieval_range)
      ? feedbackData.slide_retrieval_range.filter((item: unknown): item is string => typeof item === "string")
      : [];
    setSlideTextArr(retrievalRange.length > 0 ? retrievalRange : (displayText ? [displayText] : [""]));

    if (!hasMostRelevantPage) {
      setImages(null);
      setTotalCount(-1);
      setLoadedCount(-1);
      setIsImageLoading(false);
      return true;
    }

    setIsImageLoading(true);
    setTotalCount(1);
    setLoadedCount(0);
    const image = await handlePdfImage(Number(mostRelevantPage), slideGoogleId);
    if (image) {
      setImages([image]);
      setLoadedCount(1);
    } else {
      setImages(null);
      setLoadedCount(0);
    }
    setIsImageLoading(false);
    return true;
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
    if (!ensureLearnerIdReady()) return;
    if (!questionPreset?.question_id) return;
    const normalizedAnswer = isValidInput(answer) ? answer : "The student haven't provided any answer yet.";
    const startTime = Date.now();
    setHasSubmitted(true);
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
      const { feedbackText, structuredFeedback, textFeedback, isStructured, score, maxScore } =
        resolveRuntimeFeedbackContent(feedbackData);
      const displayFeedback = feedbackText || "No feedback is available for this question yet.";
      const displayStructuredFeedback = structuredFeedback || displayFeedback;
      const displayTextFeedback = textFeedback || displayFeedback;

      setResult(
        isStructured === false
          ? {
              feedback: displayFeedback,
              is_structured: false,
              text_feedback: displayTextFeedback,
              ...(Number.isFinite(score) ? { score } : {}),
              ...(Number.isFinite(maxScore) ? { max_score: maxScore } : {}),
            }
          : {
              feedback: displayFeedback,
              ...(isStructured === true ? { is_structured: true } : {}),
              structured_feedback: displayStructuredFeedback,
              ...(Number.isFinite(score) ? { score } : {}),
              ...(Number.isFinite(maxScore) ? { max_score: maxScore } : {}),
            }
      );

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

      const hasRuntimeReference = await applyReferenceFromRuntimeResponse(feedbackData);
      if (!hasRuntimeReference) {
        const normalizedSlideMode = normalizeCompositionSlideMode(resolvedComposition?.slide_mode);
        if (normalizedSlideMode !== "no_slide") {
          const questionLevelReference = buildQuestionLevelReference();
          if (questionLevelReference) {
            setReference(questionLevelReference);
            setImages(null);
            setIsImageLoading(false);
            setTotalCount(-1);
            setLoadedCount(-1);
          }
        }
      }

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
      const explicitScore = extractExplicitOeqScore({ score, max_score: maxScore });
      const recordPayload: RecordResultInput = {
        learner_id: effectiveLearnerId,
        study_id: studyId || "unidentifiable_study",
        session_id: sessionId || "unidentifiable_session",
        ...explicitScore,
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
        text_feedback: String(errorMessage),
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
    ensureLearnerIdReady,
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
    return "No question content available.";
  }, [questionPreset?.content, question]);

  return (
    <div className="px-3 pb-3 pt-4 md:px-4 md:pb-4 md:pt-5">
      {/* If you only want to show the participant modal for Prolific flows, you can also gate this by prolificPid */}
      <ParticipantModal isOpen={!prolificPid && !participantId && !!course_version} />
      <AndrewIdModal
        isOpen={isAndrewModalOpen}
        initialValue={andrewId}
        isRequired={!normalizedAndrewId}
        onSave={handleSaveAndrewId}
        onClose={normalizedAndrewId ? () => setIsAndrewModalOpen(false) : undefined}
      />

      <section className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question</p>
        {questionLoading ? (
          <div className="mt-2 space-y-2">
            <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-900">{questionDisplayText}</p>
        )}
      </section>

      {compositionDebugEnabled && compositionId ? (
        <section className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Composition Debug</p>
          <pre className="mt-2 max-h-56 overflow-auto text-xs text-amber-900">
            {JSON.stringify(compositionDebugInfo, null, 2)}
          </pre>
        </section>
      ) : null}

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
          showFeedback={hasSubmitted}
          showReference={hasSubmitted}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          isFeedbackLoading={isFeedbackLoading}
          promptVersion={promptVersion}
          recordId={currentRecordId}
          sessionId={sessionId}
          participantId={prolificPid || participantId || effectiveLearnerId || null}
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
    <Suspense
      fallback={
        <div className="px-3 pb-3 pt-4 md:px-4 md:pb-4 md:pt-5">
          <section className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 space-y-2">
              <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
            </div>
          </section>
          <div className="grid h-full grid-cols-11 gap-2">
            <div className="col-span-11 h-56 animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-6" />
            <div className="col-span-11 h-56 animate-pulse rounded-xl border border-slate-200 bg-white md:col-span-5" />
          </div>
        </div>
      }
    >
      <PageChildren 
        questionId={resolvedParams?.questionId} 
        searchParams={resolvedSearchParams}
      />
    </Suspense>
  );
}
