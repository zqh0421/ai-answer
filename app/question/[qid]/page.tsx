"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { debounce } from "lodash";
import { useDispatch, useSelector } from "react-redux";

import LeftFeedbackPanel from "@/app/components/LeftFeedbackPanel";
import DynamicImage from "@/app/components/DynamicImage";
import ParticipantModal from "@/app/components/ParticipantModal";
import AndrewIdModal from "@/app/components/AndrewIdModal";
import { AppDispatch, RootState } from "@/app/store/store";
import { saveAnswer, saveDraftAnswer } from "@/app/slices/userSlice";
import { getAndrewIdFromCookie, setAndrewIdCookie } from "@/app/utils/andrewIdCookie";
import { Course, Module, RecordResultInput, Reference, Slide } from "@/app/types";

/*
Legacy routing (commented out on purpose per request):
import McqQuestionPage from "@/app/mcq/[questionId]/page";
import OeqQuestionPage from "@/app/oeq/[questionId]/page";

type RouteMode = "mcq" | "oeq";
...
if (mode === "mcq") return <McqQuestionPage ... />;
return <OeqQuestionPage ... />;
*/

type QuestionContentItem = {
  type: string;
  content: string;
};

type NormalizedQuestion = {
  questionId: string;
  questionType: "single_choice" | "free_text" | "unknown";
  content: QuestionContentItem[];
  options: Array<{ text: string; isCorrect: boolean }>;
  slideIds: string[];
  slideScope: Array<Record<string, unknown>>;
};

type QuestionPayload = Record<string, any>;
type FeedbackResultPayload =
  | string
  | {
      feedback?: string;
      is_structured?: boolean;
      hide_structured_feedback_in_ui?: boolean;
      scoring_only?: boolean;
      score?: string | number;
      max_score?: string | number;
      structured_feedback?: string;
      text_feedback?: string;
    };

const readFirstString = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
};

const resolveStoredPromptText = (payload: any): string => {
  const renderedPrompt = payload?.rendered_prompt && typeof payload.rendered_prompt === "object"
    ? payload.rendered_prompt
    : null;

  const resolvedSystemPrompt = readFirstString(
    renderedPrompt?.system_prompt,
    payload?.resolved_system_prompt,
    payload?.resolvedSystemPrompt,
    payload?.system_prompt,
    payload?.llm_system_prompt
  );

  const resolvedUserPrompt = readFirstString(
    renderedPrompt?.user_text,
    payload?.resolved_user_text,
    payload?.resolvedUserText,
    payload?.prompt_text,
    renderedPrompt?.prompt_text
  );

  if (resolvedSystemPrompt && resolvedUserPrompt) {
    return `SYSTEM:\n${resolvedSystemPrompt}\n\nUSER:\n${resolvedUserPrompt}`;
  }

  return readFirstString(resolvedSystemPrompt, resolvedUserPrompt);
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
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

const parseJsonLikeFeedback = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value.trim().replace(/^```json\s*/, "").replace(/\s*```$/, "")) as Record<string, unknown>;
  } catch {
    return null;
  }
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
  if (value === null || value === undefined || depth > 4) return {};

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

  const directFeedbackText = readFirstString(record.feedback, record.output, record.result, record.text, record.message);
  const directStructuredFeedback = readFirstString(record.structured_feedback, record.feedback_html);
  const directTextFeedback = readFirstString(record.text_feedback, record.feedback, record.output, record.result, record.text);

  return {
    feedbackText: readFirstString(directFeedbackText, nestedExtracted?.feedbackText),
    structuredFeedback: readFirstString(directStructuredFeedback, nestedExtracted?.structuredFeedback),
    textFeedback: readFirstString(directTextFeedback, nestedExtracted?.textFeedback),
    isStructured:
      typeof record.is_structured === "boolean" ? record.is_structured : nestedExtracted?.isStructured,
    score: toFiniteNumber(record.score) ?? nestedExtracted?.score,
    maxScore: toFiniteNumber(record.max_score) ?? nestedExtracted?.maxScore,
  };
};

const formatErrorDetail = (detail: unknown): string => {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const message = typeof record.message === "string" ? record.message.trim() : "";
    const mode = typeof record.mode === "string" ? record.mode.trim() : "";
    const questionId = typeof record.question_id === "string" ? record.question_id.trim() : "";
    const agentId = typeof record.agent_id === "string" ? record.agent_id.trim() : "";
    const agentName = typeof record.agent_name === "string" ? record.agent_name.trim() : "";
    const compositionId = typeof record.composition_id === "string" ? record.composition_id.trim() : "";
    const feedbackAgentName =
      typeof record.feedback_agent_name === "string" ? record.feedback_agent_name.trim() : "";

    if (code || message) {
      const lines = [
        code ? `code: ${code}` : "",
        message ? `message: ${message}` : "",
        mode ? `mode: ${mode}` : "",
        questionId ? `question_id: ${questionId}` : "",
        agentId ? `agent_id: ${agentId}` : "",
        agentName ? `agent_name: ${agentName}` : "",
        compositionId ? `composition_id: ${compositionId}` : "",
        feedbackAgentName ? `feedback_agent_name: ${feedbackAgentName}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    }
  }
  if (typeof detail === "string") return detail;
  if (detail === null || detail === undefined) return "";
  if (typeof detail === "object") {
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return String(detail);
    }
  }
  return String(detail);
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const normalizeFeedbackResult = (raw: any): FeedbackResultPayload => {
  const extracted = extractFeedbackFromUnknown(raw);
  const hideStructuredFeedbackInUI = Boolean(raw?.hide_structured_feedback_in_ui);
  const scoringOnly = Boolean(raw?.scoring_only);
  const feedback = readFirstString(
    extracted.feedbackText,
    raw?.feedback,
    raw?.text_feedback,
    raw?.output,
    raw?.result,
    raw?.message
  );
  const structuredFeedback = readFirstString(extracted.structuredFeedback, raw?.structured_feedback, raw?.feedback_html);
  const textFeedback = readFirstString(extracted.textFeedback, raw?.text_feedback, raw?.feedback, raw?.output, raw?.result);
  const scoreCandidate = toFiniteNumber(raw?.score) ?? extracted.score;
  const maxScoreCandidate = toFiniteNumber(raw?.max_score) ?? extracted.maxScore;
  const aiHasScore = Boolean(raw?.ai_score_result?.has_score);
  const aiScore = toFiniteNumber(raw?.ai_score_result?.score);
  const aiMaxScore = toFiniteNumber(raw?.ai_score_result?.max_score);
  const effectiveScore = scoreCandidate ?? (aiHasScore ? aiScore : undefined);
  const effectiveMaxScore = maxScoreCandidate ?? (aiHasScore ? aiMaxScore : undefined);
  const uiStructuredFeedback = structuredFeedback;
  const uiTextFeedback = textFeedback;
  const uiFeedback = hideStructuredFeedbackInUI
    ? readFirstString(uiTextFeedback)
    : readFirstString(feedback, uiTextFeedback, uiStructuredFeedback);

  if (!uiFeedback && !uiStructuredFeedback && !uiTextFeedback && effectiveScore === undefined) {
    return stringifyIfObject(raw) || "No feedback is available.";
  }

  return {
    ...(uiFeedback ? { feedback: uiFeedback } : {}),
    ...(typeof raw?.is_structured === "boolean"
      ? { is_structured: raw.is_structured }
      : typeof extracted.isStructured === "boolean"
      ? { is_structured: extracted.isStructured }
      : {}),
    ...(hideStructuredFeedbackInUI ? { hide_structured_feedback_in_ui: true } : {}),
    ...(scoringOnly ? { scoring_only: true } : {}),
    ...(uiStructuredFeedback ? { structured_feedback: uiStructuredFeedback } : {}),
    ...(uiTextFeedback ? { text_feedback: uiTextFeedback } : {}),
    ...(effectiveScore !== undefined ? { score: effectiveScore } : {}),
    ...(effectiveMaxScore !== undefined ? { max_score: effectiveMaxScore } : {}),
  };
};

const normalizeQuestionType = (value: unknown): NormalizedQuestion["questionType"] => {
  const normalized = String(value ?? "").trim();
  if (normalized === "single_choice") return "single_choice";
  if (normalized === "free_text") return "free_text";
  return "unknown";
};

const extractQuestionPayload = (raw: QuestionPayload): QuestionPayload => {
  const hasTopLevelQuestionData =
    Array.isArray(raw?.content_blocks) ||
    Array.isArray(raw?.content) ||
    Array.isArray(raw?.options) ||
    Array.isArray(raw?.interactions) ||
    typeof raw?.question_type === "string" ||
    typeof raw?.type === "string";
  if (hasTopLevelQuestionData) return raw;
  if (raw?.question && typeof raw.question === "object") return { ...raw.question, ...raw };
  if (raw?.item && typeof raw.item === "object") return { ...raw.item, ...raw };
  if (raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data)) return { ...raw.data, ...raw };
  return raw;
};

const normalizeQuestion = (raw: QuestionPayload, fallbackQuestionId: string): NormalizedQuestion => {
  const payload = extractQuestionPayload(raw ?? {});
  const questionId = readFirstString(payload?.question_id, payload?.id, fallbackQuestionId);

  const normalizedTypeFromPayload = normalizeQuestionType(
    payload?.question_type ?? payload?.type ?? payload?.interaction_type ?? payload?.current_version?.question_type
  );

  const mapContent = (source: any[]) =>
    source
      .map((item: any) => {
        if (typeof item === "string") {
          return { type: "text", content: item.trim() };
        }
        return {
          type: String(item?.type ?? item?.block_type ?? "text").trim() || "text",
          content: String(item?.content ?? item?.text_content ?? item?.text ?? item?.media_url ?? "").trim(),
        };
      })
      .filter((item: QuestionContentItem) => Boolean(item.content));

  const contentFromBlocks = Array.isArray(payload?.content_blocks) ? mapContent(payload.content_blocks) : [];
  const contentFromCurrentVersionBlocks = Array.isArray(payload?.current_version?.content_blocks)
    ? mapContent(payload.current_version.content_blocks)
    : [];
  const contentFromTopLevel = Array.isArray(payload?.content) ? mapContent(payload.content) : [];
  const contentFromCurrentVersionTopLevel = Array.isArray(payload?.current_version?.content)
    ? mapContent(payload.current_version.content)
    : [];

  const content =
    contentFromTopLevel.length > 0
      ? contentFromTopLevel
      : contentFromCurrentVersionTopLevel.length > 0
      ? contentFromCurrentVersionTopLevel
      : contentFromBlocks.length > 0
      ? contentFromBlocks
      : contentFromCurrentVersionBlocks;

  const fallbackContentText = readFirstString(
    payload?.question_text,
    payload?.question,
    payload?.stem,
    payload?.prompt_text,
    payload?.prompt,
    payload?.current_version?.question_text,
    payload?.current_version?.question,
    payload?.current_version?.stem,
    payload?.current_version?.prompt_text
  );

  const normalizedContent =
    content.length > 0 ? content : fallbackContentText ? [{ type: "text", content: fallbackContentText }] : [];

  const collectOptions = (source: any[]): Array<{ text: string; isCorrect: boolean }> =>
    source
      .map((option: any) => {
        if (typeof option === "string") return { text: option.trim(), isCorrect: false };
        const text = readFirstString(
          option?.text,
          option?.option_text,
          option?.option_label,
          option?.option_value,
          option?.label
        );
        return {
          text,
          isCorrect: Boolean(option?.isCorrect ?? option?.is_correct ?? option?.correct),
        };
      })
      .filter((item) => Boolean(item.text));

  const directOptions = Array.isArray(payload?.options) ? collectOptions(payload.options) : [];
  const interactionOptions = Array.isArray(payload?.interactions)
    ? collectOptions(
        payload.interactions.flatMap((interaction: any) =>
          Array.isArray(interaction?.options)
            ? interaction.options
            : Array.isArray(interaction?.interaction_options)
            ? interaction.interaction_options
            : []
        )
      )
    : [];
  const fallbackInteractionOptions = Array.isArray(payload?.interaction_options)
    ? collectOptions(payload.interaction_options)
    : [];

  const options =
    directOptions.length > 0
      ? directOptions
      : interactionOptions.length > 0
      ? interactionOptions
      : fallbackInteractionOptions;

  const questionType = normalizedTypeFromPayload;

  const rawSlideScope = payload?.slide_scope ?? payload?.current_version?.slide_scope;
  const normalizedSlideScope = Array.isArray(rawSlideScope)
    ? rawSlideScope
        .map((entry: any) => {
          const slideId = String(entry?.slide_id ?? entry?.id ?? "").trim();
          if (!slideId) return null;
          return {
            ...entry,
            slide_id: slideId,
            slide_google_id: String(
              entry?.slide_google_id ??
                (entry?.slide && typeof entry.slide === "object" ? (entry.slide as any)?.slide_google_id : "") ??
                ""
            ).trim(),
          };
        })
        .filter(Boolean)
    : [];

  const slideIds = (() => {
    const directIds = Array.isArray(payload?.slide_ids)
      ? payload.slide_ids.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (directIds.length > 0) return directIds;
    return normalizedSlideScope
      .map((entry: any) => String(entry?.slide_id ?? "").trim())
      .filter(Boolean);
  })();

  return {
    questionId,
    questionType,
    content: normalizedContent,
    options,
    slideIds,
    slideScope: normalizedSlideScope as Array<Record<string, unknown>>,
  };
};

const createFallbackLearnerId = () => `test_learner_${Math.random().toString(36).slice(2, 10)}`;

type ScoringAttemptStats = {
  attemptCount: number | null;
  maxAttempts: number | null;
  isUnlimited: boolean | null;
  bestScore: number | null;
  bestScoreMax: number | null;
};

const parseSubmissionStats = (raw: unknown): ScoringAttemptStats => {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const attemptCount = toFiniteNumber(record.attempt_count);
  const maxAttempts = toFiniteNumber(record.max_attempts);
  const bestScore = toFiniteNumber(record.best_score);
  const isUnlimited = typeof record.is_unlimited === "boolean" ? record.is_unlimited : null;
  return {
    attemptCount: Number.isFinite(attemptCount as number) ? Math.max(0, Math.floor(attemptCount as number)) : null,
    maxAttempts: Number.isFinite(maxAttempts as number) ? Math.max(0, Math.floor(maxAttempts as number)) : null,
    isUnlimited,
    bestScore: Number.isFinite(bestScore as number) ? (bestScore as number) : null,
    bestScoreMax: (() => {
      const maxScore =
        toFiniteNumber(record.best_score_max) ??
        toFiniteNumber(record.max_score) ??
        toFiniteNumber(record.score_maximum);
      return Number.isFinite(maxScore as number) ? (maxScore as number) : null;
    })(),
  };
};

function QuestionWorkspace({
  qid,
  searchParams,
}: {
  qid: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const dispatch = useDispatch<AppDispatch>();
  const answers = useSelector((state: RootState) => state.user.answers);
  const draftAnswer = useSelector((state: RootState) => state.user.draftAnswer);
  const participantId = useSelector((state: RootState) => state.user.participantId);

  const [questionLoading, setQuestionLoading] = useState(false);
  const [question, setQuestion] = useState<NormalizedQuestion>({
    questionId: qid,
    questionType: "unknown",
    content: [],
    options: [],
    slideIds: [],
    slideScope: [],
  });
  const [loadError, setLoadError] = useState<string>("");

  const learnerIdFromUrl = (searchParams?.learner_id as string) || undefined;
  const compositionId = (searchParams?.composition_id as string) || undefined;
  const launchId = (searchParams?.launch_id as string) || undefined;
  const ltiLaunchId = (searchParams?.lti_launch_id as string) || undefined;
  const ltiUserId = (searchParams?.lti_user_id as string) || undefined;
  const courseVersion = (searchParams?.version as string) || undefined;
  const studyId = (searchParams?.STUDY_ID as string) || "unidentifiable_study";
  const sessionId = (searchParams?.SESSION_ID as string) || "unidentifiable_session";
  const prolificPid = (searchParams?.PROLIFIC_PID as string) || undefined;
  const debugModeEnabled = String(searchParams?.debug ?? "").trim() === "1";

  const [fallbackLearnerId] = useState(() => createFallbackLearnerId());
  const [testLearnerId] = useState(() => learnerIdFromUrl || fallbackLearnerId);
  const [andrewId, setAndrewId] = useState("");
  const [isAndrewModalOpen, setIsAndrewModalOpen] = useState(false);

  const [answerText, setAnswerText] = useState(() => (qid ? answers[qid] || "" : draftAnswer || ""));
  const [saveStatus, setSaveStatus] = useState("Saved");

  const [result, setResult] = useState<FeedbackResultPayload>("");
  const [promptVersion, setPromptVersion] = useState<string | null>(null);
  const [reference, setReference] = useState<Reference | undefined>(undefined);
  const [images, setImages] = useState<string[] | null>(null);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(-1);
  const [totalCount, setTotalCount] = useState(-1);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);
  const [currentRecordId, setCurrentRecordId] = useState<number | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [debugLastFeedbackPayload, setDebugLastFeedbackPayload] = useState<unknown>(null);
  const [scoringStats, setScoringStats] = useState<ScoringAttemptStats>({
    attemptCount: null,
    maxAttempts: null,
    isUnlimited: null,
    bestScore: null,
    bestScoreMax: null,
  });
  const [isScoringStatsLoading, setIsScoringStatsLoading] = useState(false);

  const [course, setCourse] = useState<string>();
  const [courses, setCourses] = useState<Course[]>([]);
  const [module, setModule] = useState<string[]>([]);
  const [availableModules, setAvailableModules] = useState<Module[]>([]);
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);

  const [preferredInfoType] = useState<string>("vision");
  const [selectedFeedbackFramework] = useState<string>("feature");
  const [selectedPromptEngineering] = useState<string>("rag_cot");

  const normalizedTestLearnerId = testLearnerId.trim() || fallbackLearnerId;
  const normalizedAndrewId = andrewId.trim();
  const effectiveLearnerId = learnerIdFromUrl || prolificPid || participantId || (debugModeEnabled ? normalizedTestLearnerId : normalizedAndrewId);

  useEffect(() => {
    if (debugModeEnabled) {
      setIsAndrewModalOpen(false);
      return;
    }
    const normalizedLearnerIdFromUrl = (learnerIdFromUrl || "").trim();
    if (normalizedLearnerIdFromUrl) {
      setAndrewId(normalizedLearnerIdFromUrl);
      setAndrewIdCookie(normalizedLearnerIdFromUrl);
      setIsAndrewModalOpen(false);
      return;
    }
    if (prolificPid || participantId) {
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
  }, [debugModeEnabled, learnerIdFromUrl, participantId, prolificPid]);

  const handleSaveAndrewId = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setAndrewId(normalized);
    setAndrewIdCookie(normalized);
    setIsAndrewModalOpen(false);
  }, []);

  const ensureLearnerIdReady = useCallback(() => {
    if (debugModeEnabled) return true;
    if (effectiveLearnerId) return true;
    setIsAndrewModalOpen(true);
    return false;
  }, [debugModeEnabled, effectiveLearnerId]);

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

  const debouncedSaveAnswer = useCallback(
    debounce((tempAnswer: string) => {
      if (qid) {
        dispatch(saveAnswer({ questionId: qid, answer: tempAnswer }));
      } else {
        dispatch(saveDraftAnswer(tempAnswer));
      }
      setSaveStatus("Saved");
    }, 500),
    [dispatch, qid]
  );

  const handleAnswerChange = (value: string) => {
    setAnswerText(value);
    setSaveStatus("Saving...");
    debouncedSaveAnswer(value);
  };

  useEffect(() => {
    if (!qid) return;
    let active = true;
    setQuestionLoading(true);
    setLoadError("");

    axios
      .get(`/api/questions/${encodeURIComponent(qid)}`, {
        params: {
          include: "current_version,content_blocks,interactions,options,interaction_options",
        },
      })
      .then((res) => {
        if (!active) return;
        setQuestion(normalizeQuestion(res.data ?? {}, qid));
      })
      .catch((error) => {
        console.error("Failed to load question:", error);
        if (!active) return;
        setLoadError("Failed to load question data.");
      })
      .finally(() => {
        if (active) setQuestionLoading(false);
      });

    return () => {
      active = false;
    };
  }, [qid]);

  useEffect(() => {
    if (!hasSubmitted) return;
    axios
      .get("/api/courses/public")
      .then((response) => setCourses(response.data))
      .catch((error) => {
        console.error("Error fetching the courses:", error);
      });
  }, [hasSubmitted]);

  useEffect(() => {
    if (!hasSubmitted) return;
    if (courses.length > 0 && !course) setCourse(courses[0].course_id);
  }, [courses, course, hasSubmitted]);

  useEffect(() => {
    if (!hasSubmitted || !course) return;
    axios
      .get(`/api/courses/by_id/${course}/modules`)
      .then((response) => {
        setAvailableModules(response.data.modules);
        setModule(response.data.modules.map((mod: Module) => mod.module_id));
      })
      .catch((error) => {
        console.error("Error fetching modules:", error);
      });
  }, [course, hasSubmitted]);

  useEffect(() => {
    if (!hasSubmitted || !module.length) {
      setAvailableSlides([]);
      return;
    }
    const fetchSlides = async () => {
      try {
        const slideRequests = module.map((modId) => axios.get(`/api/modules/${modId}/slides`));
        const slideResponses = await Promise.all(slideRequests);
        const allSlides = slideResponses.flatMap((res) => res.data.slides);
        setAvailableSlides(allSlides);
      } catch (error) {
        console.error("Error fetching slides:", error);
      }
    };
    void fetchSlides();
  }, [hasSubmitted, module]);

  const questionTextForPanel = useMemo(
    () => question.content.filter((item) => item.type === "text").map((item) => item.content).join("\n\n"),
    [question.content]
  );

  const handleInputResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const applyReferenceFromRuntimeResponse = async (feedbackData: any): Promise<boolean> => {
    const runtimeReference = feedbackData?.reference && typeof feedbackData.reference === "object" ? feedbackData.reference : null;
    const resolvedInputValues =
      feedbackData?.resolved_input_values && typeof feedbackData.resolved_input_values === "object"
        ? feedbackData.resolved_input_values
        : null;
    const retrievedSlidePages = Array.isArray((resolvedInputValues as any)?.retrieved_slide_pages)
      ? ((resolvedInputValues as any).retrieved_slide_pages as Array<Record<string, unknown>>)
      : [];
    const firstRetrievedSlidePage = retrievedSlidePages.find(
      (item) => item && typeof item === "object"
    ) as Record<string, unknown> | undefined;

    const normalizeTitle = (value: unknown) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const retrievedSlideTitle = String(firstRetrievedSlidePage?.slide_title ?? "").trim();
    const retrievedSlideId = String(firstRetrievedSlidePage?.slide_id ?? "").trim();
    const retrievedSlideGoogleId = String(firstRetrievedSlidePage?.slide_google_id ?? "").trim();
    const retrievedContent = String(firstRetrievedSlidePage?.content ?? firstRetrievedSlidePage?.text ?? "").trim();
    const retrievedPageRaw =
      firstRetrievedSlidePage?.most_relevant_page_number ??
      firstRetrievedSlidePage?.page_number ??
      firstRetrievedSlidePage?.reference_slide_page_number;

    const matchedSlideByTitle = retrievedSlideTitle
      ? availableSlides.find((item) => {
          const slideTitle = normalizeTitle(item?.slide_title);
          const targetTitle = normalizeTitle(retrievedSlideTitle);
          return slideTitle === targetTitle || slideTitle.includes(targetTitle) || targetTitle.includes(slideTitle);
        })
      : undefined;
    const matchedScopeByTitle = retrievedSlideTitle
      ? question.slideScope.find((scopeItem) => {
          const scopeTitle = normalizeTitle((scopeItem as any)?.slide_title);
          const targetTitle = normalizeTitle(retrievedSlideTitle);
          return scopeTitle === targetTitle || scopeTitle.includes(targetTitle) || targetTitle.includes(scopeTitle);
        })
      : undefined;

    const slideGoogleId = String(
      runtimeReference?.slide_google_id ??
        feedbackData?.reference_slide_google_id ??
        feedbackData?.slide_google_id ??
        retrievedSlideGoogleId ??
        (matchedSlideByTitle as any)?.slide_google_id ??
        (matchedScopeByTitle as any)?.slide_google_id ??
        ""
    ).trim();
    const slideId = String(
      runtimeReference?.slide_id ??
        feedbackData?.reference_slide_id ??
        retrievedSlideId ??
        (matchedSlideByTitle as any)?.id ??
        (matchedScopeByTitle as any)?.slide_id ??
        ""
    ).trim();
    const slideTitle = String(
      runtimeReference?.slide_title ??
        feedbackData?.reference_slide_title ??
        retrievedSlideTitle ??
        (matchedSlideByTitle as any)?.slide_title ??
        (matchedScopeByTitle as any)?.slide_title ??
        "Open slide"
    ).trim();
    const mostRelevantPageRaw =
      runtimeReference?.most_relevant_page_number ??
      feedbackData?.most_relevant_page_number ??
      runtimeReference?.page_number ??
      runtimeReference?.reference_slide_page_number ??
      feedbackData?.reference_slide_page_number ??
      retrievedPageRaw;
    const mostRelevantPage =
      mostRelevantPageRaw === null || mostRelevantPageRaw === undefined
        ? null
        : typeof mostRelevantPageRaw === "number"
        ? mostRelevantPageRaw
        : Number.isFinite(Number(mostRelevantPageRaw))
        ? Number(mostRelevantPageRaw)
        : null;
    const hasMostRelevantPage = Number.isFinite(mostRelevantPage as number) && (mostRelevantPage as number) > 0;

    const imageText = String(runtimeReference?.image_text ?? feedbackData?.reference_slide_content ?? retrievedContent ?? "");
    const text = String(runtimeReference?.text ?? feedbackData?.reference_slide_content ?? retrievedContent ?? "");
    const displayText = imageText.trim() || text.trim();

    if (!slideGoogleId && !slideId && !displayText) {
      setReference(undefined);
      setImages(null);
      setTotalCount(-1);
      setLoadedCount(-1);
      setIsImageLoading(false);
      return false;
    }

    setReference({
      ...(runtimeReference ?? {}),
      page_number: hasMostRelevantPage ? Number(mostRelevantPage) : -1,
      most_relevant_page_number: hasMostRelevantPage ? Number(mostRelevantPage) : null,
      slide_total_pages: runtimeReference?.slide_total_pages ?? feedbackData?.slide_total_pages ?? null,
      slide_id: slideId || undefined,
      slide_google_id: slideGoogleId,
      most_relevant_slide_embed_url:
        String(
          runtimeReference?.most_relevant_slide_embed_url ??
            feedbackData?.most_relevant_slide_embed_url ??
            runtimeReference?.slide_embed_url ??
            feedbackData?.slide_embed_url ??
            ""
        ).trim() || null,
      slide_embed_url:
        String(
          runtimeReference?.most_relevant_slide_embed_url ??
            feedbackData?.most_relevant_slide_embed_url ??
            runtimeReference?.slide_embed_url ??
            feedbackData?.slide_embed_url ??
            ""
        ).trim() || null,
      most_relevant_slide_embed_url_error:
        String(runtimeReference?.most_relevant_slide_embed_url_error ?? feedbackData?.most_relevant_slide_embed_url_error ?? "").trim() ||
        null,
      slide_title: slideTitle,
      text,
      image_text: imageText,
      display: displayText,
    });

    if (!hasMostRelevantPage) {
      setImages(null);
      setTotalCount(-1);
      setLoadedCount(-1);
      setIsImageLoading(false);
      return true;
    }

    // PDF-to-image flow removed: rely on embed URL + textual reference only.
    setImages(null);
    setTotalCount(-1);
    setLoadedCount(-1);
    setIsImageLoading(false);
    return true;
  };

  const buildQuestionLevelReference = useCallback((): Reference | undefined => {
    const firstScope = Array.isArray(question.slideScope) && question.slideScope.length > 0 ? question.slideScope[0] : undefined;
    const rawSlideId = String(firstScope?.slide_id ?? question.slideIds?.[0] ?? "").trim();
    if (!rawSlideId) return undefined;
    const matchedSlide = availableSlides.find((item) => item.id === rawSlideId || item.slide_google_id === rawSlideId);
    const slideGoogleId = String(
      matchedSlide?.slide_google_id ??
        (firstScope?.slide_google_id as string | undefined) ??
        ""
    ).trim();
    return {
      text: "",
      image_text: "",
      display: "",
      page_number: -1,
      most_relevant_page_number: null,
      slide_total_pages: null,
      slide_id: rawSlideId,
      slide_google_id: slideGoogleId,
      most_relevant_slide_embed_url: null,
      slide_embed_url: null,
      most_relevant_slide_embed_url_error: null,
      slide_title: String(matchedSlide?.slide_title ?? firstScope?.slide_title ?? "Open slide"),
    };
  }, [availableSlides, question.slideIds, question.slideScope]);

  const recordResultToDatabase = async (payload: RecordResultInput) => {
    try {
      const response = await axios.post(
        "/api/record_result",
        {
          ...payload,
          lti_launch_id: ltiLaunchId,
          lti_user_id: ltiUserId,
        },
        {
          headers: {
            ...(ltiLaunchId ? { "x-lti-launch-id": ltiLaunchId } : {}),
            ...(ltiUserId ? { "x-lti-user-id": ltiUserId } : {}),
          },
        }
      );
      if (response.data?.id) setCurrentRecordId(response.data.id);
    } catch (error) {
      console.error("Error recording result to database:", error);
    }
  };

  const isMCQ = question.questionType === "single_choice";
  const hasAnswer = Boolean(answerText.trim());
  const normalizedCompositionId = (compositionId || "").trim();
  const isScoringComposition = /scoring/i.test(normalizedCompositionId);
  const hasAttemptCount = typeof scoringStats.attemptCount === "number" && Number.isFinite(scoringStats.attemptCount);
  const attemptCountValue = hasAttemptCount ? Number(scoringStats.attemptCount) : null;
  const hasFiniteMaxAttempts = typeof scoringStats.maxAttempts === "number" && Number.isFinite(scoringStats.maxAttempts);
  const isUnlimitedByStats = scoringStats.isUnlimited === true;
  const scoringMaxAttemptsDisplay = hasFiniteMaxAttempts ? Number(scoringStats.maxAttempts) : 3;
  const canSubmitByStats = isUnlimitedByStats
    ? true
    : hasAttemptCount && hasFiniteMaxAttempts
    ? Number(attemptCountValue) < Number(scoringStats.maxAttempts)
    : true;
  const attemptsExhausted =
    isScoringComposition &&
    !canSubmitByStats;
  const submitDisabled = questionLoading || isFeedbackLoading || !hasAnswer || attemptsExhausted;
  const shouldHideReferencePanel = /scoring/i.test(normalizedCompositionId);
  const isValidInput = (input: string): boolean => {
    const alphanumericRegex = /[a-zA-Z0-9]/;
    return input.trim() !== "" && alphanumericRegex.test(input);
  };

  const fetchSubmissionStats = useCallback(async () => {
    if (!normalizedCompositionId) return;
    const targetQuestionId = question.questionId || qid;
    if (!targetQuestionId || !effectiveLearnerId || !normalizedCompositionId) return;

    setIsScoringStatsLoading(true);
    try {
      const qs = new URLSearchParams({
        learner_id: effectiveLearnerId,
        question_id: targetQuestionId,
        composition_id: normalizedCompositionId,
      });
      const statsRes = await fetch(`/api/submission-stats?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
      });
      if (!statsRes.ok) {
        throw new Error(`Failed to fetch submission stats: HTTP ${statsRes.status}`);
      }
      const parsedStats = parseSubmissionStats(await statsRes.json());

      if (!isScoringComposition) {
        setScoringStats({
          attemptCount: parsedStats.attemptCount,
          maxAttempts: null,
          isUnlimited: true,
          bestScore: null,
          bestScoreMax: null,
        });
        return;
      }

      setScoringStats({
        attemptCount: parsedStats.attemptCount,
        maxAttempts: Number.isFinite(parsedStats.maxAttempts as number) ? parsedStats.maxAttempts : 3,
        isUnlimited: parsedStats.isUnlimited === true ? true : false,
        bestScore: parsedStats.bestScore,
        bestScoreMax: parsedStats.bestScoreMax,
      });
    } catch (error) {
      console.error("Failed to fetch submission stats:", error);
      setScoringStats({
        attemptCount: null,
        maxAttempts: isScoringComposition ? 3 : null,
        isUnlimited: isScoringComposition ? false : true,
        bestScore: null,
        bestScoreMax: null,
      });
    } finally {
      setIsScoringStatsLoading(false);
    }
  }, [effectiveLearnerId, isScoringComposition, normalizedCompositionId, qid, question.questionId]);

  useEffect(() => {
    if (!normalizedCompositionId) return;
    void fetchSubmissionStats();
  }, [fetchSubmissionStats, normalizedCompositionId, effectiveLearnerId, question.questionId, qid]);

  const handleSubmit = async () => {
    if (submitDisabled) return;
    if (!ensureLearnerIdReady()) return;

    const targetQuestionId = question.questionId || qid;
    if (!targetQuestionId) return;

    if (!normalizedCompositionId) {
      setResult({
        is_structured: false,
        feedback: "Error detail:\nMissing routing parameter: provide composition_id in URL.",
        text_feedback: "Error detail:\nMissing routing parameter: provide composition_id in URL.",
      });
      return;
    }

    const selectedOptionIndex = isMCQ
      ? Math.max(
          0,
          question.options.findIndex((item) => item.text === answerText)
        )
      : undefined;
    const normalizedAnswerText =
      isMCQ || isValidInput(answerText) ? answerText : "The student haven't provided any answer yet.";

    const payload: Record<string, unknown> = {
      mode: "composition",
      compositionId: normalizedCompositionId,
      dryRun: false,
      dry_run: false,
      learnerId: effectiveLearnerId,
      answerText: normalizedAnswerText,
      ...(selectedOptionIndex !== undefined ? { inputValues: { selectedOptionIndex } } : {}),
      ...(launchId ? { launchId } : {}),
      ...(ltiLaunchId ? { ltiLaunchId } : {}),
    };

    setHasSubmitted(true);
    setIsFeedbackLoading(true);
    setIsReferenceLoading(true);
    const startTime = Date.now();

    try {
      const response = await axios.post(`/api/questions/${encodeURIComponent(targetQuestionId)}/feedback`, payload);
      const feedbackData = response.data || {};
      if (debugModeEnabled) setDebugLastFeedbackPayload(feedbackData);
      const feedbackText = readFirstString(feedbackData?.feedback);
      const hasFeedback = typeof feedbackData?.has_feedback === "boolean" ? feedbackData.has_feedback : true;
      const feedbackSource = readFirstString(feedbackData?.feedback_source);
      const hasAnyScoreSignal =
        toFiniteNumber(feedbackData?.score) !== undefined ||
        toFiniteNumber(feedbackData?.max_score) !== undefined ||
        Boolean(feedbackData?.ai_score_result?.has_score) ||
        toFiniteNumber(feedbackData?.ai_score_result?.score) !== undefined;
      const hasScoringOnlySignal = Boolean(feedbackData?.scoring_only) || Boolean(feedbackData?.hide_structured_feedback_in_ui);
      const shouldBypassNoFeedbackGate = hasAnyScoreSignal || hasScoringOnlySignal;

      if (!hasFeedback && !shouldBypassNoFeedbackGate) {
        const noFeedbackMessage = `No feedback available${feedbackSource ? ` (source: ${feedbackSource})` : ""}.`;
        setResult({
          is_structured: false,
          feedback: noFeedbackMessage,
          text_feedback: noFeedbackMessage,
        });
        setPromptVersion(null);
        setReference(undefined);
        setImages(null);
        setTotalCount(-1);
        setLoadedCount(-1);
        return;
      }

      const normalizedResult = normalizeFeedbackResult({
        ...feedbackData,
        feedback: feedbackText || stringifyIfObject(feedbackData?.feedback),
      });

      if (typeof normalizedResult === "string") {
        setResult(normalizedResult);
      } else {
        const explicitScore = toFiniteNumber((normalizedResult as any)?.score) ?? toFiniteNumber(feedbackData?.score);
        const explicitMaxScore = toFiniteNumber((normalizedResult as any)?.max_score) ?? toFiniteNumber(feedbackData?.max_score);
        const aiHasScore = Boolean(feedbackData?.ai_score_result?.has_score);
        const aiScore = toFiniteNumber(feedbackData?.ai_score_result?.score);
        const aiMaxScore = toFiniteNumber(feedbackData?.ai_score_result?.max_score);
        const effectiveExplicitScore = explicitScore ?? (aiHasScore ? aiScore : undefined);
        const effectiveExplicitMaxScore = explicitMaxScore ?? (aiHasScore ? aiMaxScore : undefined);
        if (effectiveExplicitScore !== undefined) {
          setResult({
            ...normalizedResult,
            score: effectiveExplicitScore,
            max_score: effectiveExplicitMaxScore ?? 1,
          });
        } else if (isMCQ) {
          const selected = question.options[selectedOptionIndex ?? 0];
          const score = selected?.isCorrect ? 1 : 0;
          setResult({
            ...normalizedResult,
            score,
            max_score: 1,
          });
        } else {
          setResult(normalizedResult);
        }
      }

      const mode = String(feedbackData?.feedback_mode ?? "").trim();
      if (mode === "runtime_generate") setPromptVersion("prompt_corrective");
      else if (mode === "use_latest_version") setPromptVersion("human_feedback");
      else setPromptVersion(null);

      const hasRuntimeReference = await applyReferenceFromRuntimeResponse(feedbackData);
      if (!hasRuntimeReference) {
        const fallbackReference = buildQuestionLevelReference();
        if (fallbackReference) {
          setReference(fallbackReference);
          setImages(null);
          setTotalCount(-1);
          setLoadedCount(-1);
        }
      }

      const endTime = Date.now();
      const selected = isMCQ ? question.options[selectedOptionIndex ?? 0] : null;
      const normalizedResultRecord =
        typeof normalizedResult === "object" && normalizedResult !== null
          ? (normalizedResult as Record<string, unknown>)
          : null;
      const aiScoreCandidate = toFiniteNumber((feedbackData as any)?.ai_score_result?.score);
      const aiMaxScoreCandidate =
        toFiniteNumber((feedbackData as any)?.ai_score_result?.max_score) ??
        toFiniteNumber((feedbackData as any)?.ai_score_result?.score_maximum);
      const finalScore =
        toFiniteNumber(normalizedResultRecord?.score) ??
        toFiniteNumber((feedbackData as any)?.score) ??
        aiScoreCandidate ??
        (selected ? (selected.isCorrect ? 1 : 0) : undefined);
      const finalMaxScore =
        toFiniteNumber(normalizedResultRecord?.max_score) ??
        toFiniteNumber((feedbackData as any)?.max_score) ??
        toFiniteNumber((feedbackData as any)?.score_maximum) ??
        aiMaxScoreCandidate ??
        (finalScore !== undefined ? 1 : undefined);
      const scoreGivenRaw =
        readFirstString(
          (feedbackData as any)?.score_given_raw,
          (feedbackData as any)?.ai_score_result?.score_raw,
          (feedbackData as any)?.ai_score_result?.raw_score
        ) || (finalScore !== undefined ? String(finalScore) : "");

      const recordPayload: RecordResultInput = {
        learner_id: effectiveLearnerId,
        study_id: studyId,
        session_id: sessionId,
        ...(normalizedCompositionId ? { compositionId: normalizedCompositionId, composition_id: normalizedCompositionId } : {}),
        ...(finalScore !== undefined
          ? { score_given_raw: scoreGivenRaw, score_given: finalScore, score_maximum: finalMaxScore ?? 1 }
          : {}),
        question_id: targetQuestionId,
        answer: normalizedAnswerText,
        feedback: readFirstString((feedbackData as any)?.feedback, (feedbackData as any)?.text_feedback, stringifyIfObject(feedbackData)),
        llm_system_prompt: resolveStoredPromptText(feedbackData) || undefined,
        prompt_engineering_method: selectedPromptEngineering,
        preferred_info_type: preferredInfoType,
        feedback_framework: selectedFeedbackFramework,
        reference_slide_page_number: toFiniteNumber((feedbackData as any)?.reference_slide_page_number),
        reference_slide_content: readFirstString((feedbackData as any)?.reference_slide_content) || undefined,
        reference_slide_id: readFirstString((feedbackData as any)?.reference_slide_id) || undefined,
        submission_time: startTime,
        system_total_response_time: endTime - startTime,
      };
      await recordResultToDatabase(recordPayload);
      if (normalizedCompositionId) {
        await fetchSubmissionStats();
      }
    } catch (error: any) {
      console.error("Failed to fetch feedback:", error);
      const detail = error?.response?.data?.detail ?? error?.detail ?? null;
      console.error("Feedback error detail:", detail);
      const errorData = error?.response?.data || {};
      if (debugModeEnabled) setDebugLastFeedbackPayload(errorData);
      const code = readFirstString(errorData?.code, errorData?.detail?.code);
      const message =
        readFirstString(errorData?.message, errorData?.detail?.message) ||
        formatErrorDetail(detail) ||
        error?.message ||
        "Failed to get feedback";
      const displayMessage = `Error detail: ${code ? `${code}: ` : ""}${message}`;
      const displayHtml = `<pre style=\"white-space:pre-wrap;word-break:break-word;margin:0;\">${escapeHtml(displayMessage)}</pre>`;
      setResult({
        is_structured: false,
        feedback: displayHtml,
        text_feedback: displayHtml,
      });
      setReference(undefined);
      setImages(null);
    } finally {
      setIsFeedbackLoading(false);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
    }
  };

  return (
    <div className="px-3 pb-3 pt-4 md:px-4 md:pb-4 md:pt-5">
      <ParticipantModal isOpen={!prolificPid && !participantId && !!courseVersion} />
      <AndrewIdModal
        isOpen={isAndrewModalOpen}
        initialValue={andrewId}
        isRequired={!normalizedAndrewId}
        onSave={handleSaveAndrewId}
        onClose={normalizedAndrewId ? () => setIsAndrewModalOpen(false) : undefined}
      />

      <section className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-base font-semibold tracking-wide text-slate-700 lg:text-lg">Question</div>
        <div className="mt-2 space-y-2">
          {question.content.length > 0 ? (
            question.content.map((item, index) => (
              <div
                key={`header-content-${item.type}-${index}`}
                className={item.type === "image" ? "rounded-lg border border-slate-200 bg-slate-50 p-3" : ""}
              >
                {item.type === "image" ? (
                  <DynamicImage
                    src={item.content}
                    alt={`question-header-content-${index + 1}`}
                    className="max-h-64 w-auto rounded-md object-contain"
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words text-slate-700">{item.content}</p>
                )}
              </div>
            ))
          ) : questionLoading ? (
            <div className="space-y-2 p-1">
              <div className="h-3 w-11/12 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-slate-200" />
            </div>
          ) : (
            <div className="text-sm text-slate-500">No question content available.</div>
          )}
        </div>
        {loadError ? <div className="mt-2 text-sm text-red-600">{loadError}</div> : null}
      </section>

      <div className="grid grid-cols-11 gap-2">
        <LeftFeedbackPanel
          result={result}
          reference={reference}
          isReferenceLoading={isReferenceLoading}
          images={images}
          isImageLoading={isImageLoading}
          loadedCount={loadedCount}
          totalCount={totalCount}
          onImageClick={() => {}}
          studentAnswer={answerText}
          showFeedback={true}
          showReference={!shouldHideReferencePanel}
          isFeedbackLoading={isFeedbackLoading}
          promptVersion={promptVersion}
          question={questionTextForPanel}
          options={question.options}
          recordId={currentRecordId}
          sessionId={sessionId}
          participantId={effectiveLearnerId || null}
          debugEnabled={debugModeEnabled}
          debugData={debugLastFeedbackPayload}
        />

        <section className="z-1 order-1 col-span-11 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:order-2 lg:col-span-5 lg:sticky lg:top-[75px] lg:p-6">
          <div className="pt-1">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-800">Your Answer</h3>
                <p className="text-sm text-slate-500">{saveStatus}</p>
              </div>

              {questionLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }, (_, idx) => (
                    <div
                      key={`answer-loading-${idx}`}
                      className="animate-pulse rounded-lg border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-4 w-4 rounded-full border border-slate-300 bg-slate-200" />
                        <div className="h-4 flex-1 rounded bg-slate-200" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : isMCQ ? (
                question.options.length > 0 ? (
                  <div className="space-y-3">
                    {question.options.map((option, index) => {
                      const optionText = option.text;
                      const isSelected = answerText === optionText;
                      return (
                        <div key={index} className="space-y-2">
                          <label
                            className={`flex cursor-pointer items-center rounded-lg border p-4 transition-colors duration-200 ${
                              isSelected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="mcq-option"
                              value={optionText}
                              checked={isSelected}
                              onChange={(e) => {
                                handleAnswerChange(e.target.value);
                              }}
                              className="mr-3 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="flex-1 text-slate-700">{optionText}</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                    No options available for this MCQ question.
                  </div>
                )
              ) : question.questionType === "free_text" ? (
                <textarea
                  value={answerText}
                  onChange={(event) => handleAnswerChange(event.target.value)}
                  placeholder="Enter your answer here..."
                  className="min-h-32 w-full resize-none rounded-lg border border-slate-300 px-3 py-3 transition-all duration-200 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  rows={1}
                  onInput={handleInputResize}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onPaste={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
                    e.preventDefault();
                    return false;
                  }}
                  onCopy={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
                    e.preventDefault();
                    return false;
                  }}
                  onCut={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
                    e.preventDefault();
                    return false;
                  }}
                  onContextMenu={(e: React.MouseEvent<HTMLTextAreaElement>) => {
                    e.preventDefault();
                    return false;
                  }}
                  onDrop={(e: React.DragEvent<HTMLTextAreaElement>) => {
                    e.preventDefault();
                    return false;
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                    if ((e.ctrlKey || e.metaKey) && ["c", "v", "x", "a"].includes(e.key.toLowerCase())) {
                      e.preventDefault();
                      return false;
                    }
                  }}
                />
              ) : (
                <div className="text-sm text-amber-700">
                  Unsupported question type. Current page supports `free_text` and `single_choice`.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitDisabled}
              className={`group relative mt-4 w-full overflow-hidden rounded-lg px-4 py-3 font-medium transition-all duration-300 ${
                submitDisabled
                  ? "cursor-not-allowed bg-slate-300 text-slate-500"
                  : "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg hover:shadow-xl"
              }`}
            >
              {!submitDisabled ? (
                <div className="absolute inset-0 origin-left -skew-x-6 scale-x-0 bg-white opacity-0 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-10" />
              ) : null}
              <div className="relative z-10 flex items-center justify-center">
                {isFeedbackLoading ? "Evaluating..." : attemptsExhausted ? "Submission Limit Reached" : "Submit Answer"}
              </div>
            </button>
            {normalizedCompositionId ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <div>
                  Attempts:{" "}
                  <span className="font-semibold">
                    {isScoringStatsLoading
                      ? "..."
                      : `${hasAttemptCount ? attemptCountValue : "-"} / ${
                          isUnlimitedByStats || !isScoringComposition ? "Unlimited" : scoringMaxAttemptsDisplay
                        }`}
                  </span>
                </div>
                {isScoringComposition ? (
                  <div className="mt-1">
                    Best Score:{" "}
                    <span className="font-semibold">
                      {isScoringStatsLoading
                        ? "..."
                        : `${Number.isFinite(scoringStats.bestScore as number) ? scoringStats.bestScore : "-"} / ${
                            Number.isFinite(scoringStats.bestScoreMax as number) ? scoringStats.bestScoreMax : "-"
                          }`}
                    </span>
                  </div>
                ) : null}
                {attemptsExhausted ? (
                  <div className="mt-1 text-red-600">Maximum submissions reached. Further submissions are disabled.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function UnifiedQuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ qid?: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = use(params);
  const resolvedSearchParams = use(searchParams);
  const qid = resolvedParams?.qid ?? "";

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
      <QuestionWorkspace qid={qid} searchParams={resolvedSearchParams} />
    </Suspense>
  );
}
