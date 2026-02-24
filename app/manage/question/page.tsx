"use client";
import axios from "axios";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import ActionButton from "@/app/components/ActionButton";
import { Slide } from "@/app/types";
import ContentEditor from "@/app/components/ContentEditor";
import DynamicImage from "@/app/components/DynamicImage";
import ManageDataTable, { ManageTableColumn } from "@/app/components/manage/ManageDataTable";
import ManageListPanel from "@/app/components/manage/ManageListPanel";
import { useManagePermissionGuard } from "@/app/manage/hooks/useManagePermissionGuard";
import { buildStaticPageTitle } from "@/app/utils/title";

export interface QuestionContent {
  type: string; // text, image, etc.
  content: string;
}

export interface MCQOption {
  text: string;
  feedback: string;
}

interface Course {
  course_id: string;
  course_title?: string;
}

interface Module {
  module_id: string;
  module_title?: string;
}

export interface Question {
  question_id: string;
  type: string; // "multiple choice" | "open ended"
  objective?: string[];
  slide_ids?: string[];
  created_at?: string;
  content: QuestionContent[];
  options?: Array<{ text: string; isCorrect: boolean }>;
  mcq_human_feedback?: string[];
}

type PaginationToken = number | "ellipsis";
type SortKey = "type" | "preview" | "created_at";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 20;
const QUESTION_PREVIEW_LENGTH = 140;

const getPaginationTokens = (currentPage: number, totalPages: number): PaginationToken[] => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const tokens: PaginationToken[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  if (start > 2) tokens.push("ellipsis");
  for (let page = start; page <= end; page += 1) tokens.push(page);
  if (end < totalPages - 1) tokens.push("ellipsis");
  tokens.push(totalPages);
  return tokens;
};

const getQuestionTextPreview = (question: Question) => {
  const text = question.content?.find((item) => item.type === "text")?.content?.trim() ?? "";
  if (!text) return "-";
  return text.length > QUESTION_PREVIEW_LENGTH
    ? `${text.slice(0, QUESTION_PREVIEW_LENGTH)}...`
    : text;
};

const getQuestionImagePreview = (question: Question) =>
  question.content?.find((item) => item.type === "image")?.content ?? "";

const formatCreatedAt = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const QuestionOverview = () => {
  const [questions, setQuestions] = useState<Question[]>([]);

  // ---- course/module/slide hierarchy ----
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableModules, setAvailableModules] = useState<Module[]>([]);
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);
  const [course, setCourse] = useState<string | null>(null);
  const [module, setModule] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // UX flags
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [slidesLoading, setSlidesLoading] = useState(false);

  // form state
  const [newQuestionType, setNewQuestionType] = useState("");
  const [newQuestionContent, setNewQuestionContent] = useState<QuestionContent[]>([]);
  const [newQuestionOptions, setNewQuestionOptions] = useState<string[]>([]);
  const [newMcqOptions, setNewMcqOptions] = useState<MCQOption[]>([]);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState<number | null>(null);
  const [newQuestionObjective, setNewQuestionObjective] = useState<string[]>([]);
  const [newSlideIds, setNewSlideIds] = useState<string[]>([]);
  const [newHumanFeedback, setNewHumanFeedback] = useState<string>("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [updatingFeedback, setUpdatingFeedback] = useState<string | null>(null);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  const { data } = useSession();
  const { hasManagePermission, isPermissionChecking } = useManagePermissionGuard();
  const userEmail = data?.user?.email ?? "";
  const searchParams = useSearchParams();
  const isDeepLinkMode = searchParams.get("lti_mode") === "deep_link";
  const launchId = searchParams.get("launch_id");
  const ltiLaunchId = searchParams.get("lti_launch_id");
  const ltiUserId = searchParams.get("lti_user_id");
  useEffect(() => {
    document.title = buildStaticPageTitle("Question Management");
  }, []);
  const ltiParams = new URLSearchParams();
  if (isDeepLinkMode) {
    ltiParams.set("lti_mode", "deep_link");
    if (launchId) ltiParams.set("launch_id", launchId);
    if (ltiLaunchId) ltiParams.set("lti_launch_id", ltiLaunchId);
    if (ltiUserId) ltiParams.set("lti_user_id", ltiUserId);
  }
  const ltiQuery = ltiParams.toString() ? `?${ltiParams.toString()}` : "";

  // normalize different backend shapes into { id, slide_title, ... }
  const normalizeSlide = (s: any) => ({
    id: s.id ?? s._id ?? s.slide_id,
    slide_title: s.slide_title ?? s.title ?? s.name ?? "Untitled slide",
    ...s,
  });

  // unique by id
  const uniqueById = <T extends { id?: string }>(arr: T[]) => {
    const seen = new Set<string>();
    return arr.filter((x) => {
      if (!x.id) return false;
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  };

  // 1) Fetch public courses on mount
  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    let cancelled = false;
    (async () => {
      setCoursesLoading(true);
      setMessage(null);
      try {
        const { data } = await axios.get("/api/courses/public");
        if (cancelled) return;

        // store courses as-is
        setCourses(Array.isArray(data) ? data : []);

        // auto-select the first course if none selected
        const first = Array.isArray(data) && data.length ? data[0] : null;
        const firstId: string | undefined = first?.id ?? first?.course_id;
        if (!course && firstId) setCourse(firstId);
      } catch (error) {
        console.error("Error fetching the courses:", error);
        if (!cancelled) setMessage("Failed to load courses.");
      } finally {
        if (!cancelled) setCoursesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // include `course` so we don't overwrite user-chosen course later
  }, [course, hasManagePermission, isPermissionChecking]);


  // 2) When a course is picked, fetch its modules
  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    if (!course) {
      setAvailableModules([]);
      setModule([]);
      setAvailableSlides([]);
      setNewSlideIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setModulesLoading(true);
      setMessage(null);
      try {
        const { data } = await axios.get(`/api/courses/by_id/${course}/modules`);
        const mods: Module[] = data?.modules ?? [];
        if (cancelled) return;

        setAvailableModules(mods);

        // auto-select all only if user hasn't selected anything yet
        if (module.length === 0) {
          setModule(mods.map((m) => (m.module_id ?? (m as any).id)));
        }
      } catch (error) {
        console.error("Error fetching the modules:", error);
        if (!cancelled) setMessage("Failed to load modules.");
        if (!cancelled) {
          setAvailableModules([]);
          setModule([]);
        }
      } finally {
        if (!cancelled) setModulesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // include `module` so we can check if it's empty
  }, [course, hasManagePermission, isPermissionChecking, module.length]);


  // 3) When module selection changes, fetch slides for those modules
  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    let cancelled = false;

    if (!module.length) {
      setAvailableSlides([]);
      setNewSlideIds([]);
      return;
    }

    (async () => {
      setSlidesLoading(true);
      try {
        const requests = module.map((modId) => axios.get(`/api/modules/${modId}/slides`));
        const responses = await Promise.all(requests);

        // flatten -> normalize -> unique
        const allSlidesRaw = responses.flatMap((res) => res.data?.slides ?? []);
        const normalized = uniqueById(allSlidesRaw.map(normalizeSlide));

        if (cancelled) return;

        setAvailableSlides(normalized);

        // auto-select all slides by default (optional)
        setNewSlideIds(normalized.map((s) => s.id as string));
      } catch (error) {
        console.error("Error fetching the slides:", error);
        if (!cancelled) {
          setAvailableSlides([]);
          setNewSlideIds([]);
        }
      } finally {
        if (!cancelled) setSlidesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasManagePermission, isPermissionChecking, module]);

  // Fetch questions
  const fetchQuestions = useCallback(async () => {
    if (!hasManagePermission) return;
    setIsFetchingQuestions(true);
    try {
      const res = await axios.get(`/api/questions/all`);
      setQuestions(res.data || []);
    } catch (err) {
      console.error("Error fetching questions:", err);
      setQuestions([]);
    } finally {
      setIsFetchingQuestions(false);
    }
  }, [hasManagePermission]);

  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    fetchQuestions();
  }, [fetchQuestions, hasManagePermission, isPermissionChecking]);

  // Multiple-choice option editor helpers
  const addOption = () => {
    setNewQuestionOptions((opts) => [...opts, ""]);
    setNewMcqOptions((opts) => [...opts, { text: "", feedback: "" }]);
  };
  
  const updateOption = (index: number, value: string) => {
    setNewQuestionOptions((opts) => opts.map((o, i) => (i === index ? value : o)));
    setNewMcqOptions((opts) => 
      opts.map((o, i) => (i === index ? { ...o, text: value } : o))
    );
  };
  
  const updateOptionFeedback = (index: number, feedback: string) => {
    setNewMcqOptions((opts) => 
      opts.map((o, i) => (i === index ? { ...o, feedback } : o))
    );
  };
  
  const removeOption = (index: number) => {
    setNewQuestionOptions((opts) => opts.filter((_, i) => i !== index));
    setNewMcqOptions((opts) => opts.filter((_, i) => i !== index));
    // Adjust correct answer index if needed
    if (correctAnswerIndex !== null) {
      if (correctAnswerIndex === index) {
        setCorrectAnswerIndex(null);
      } else if (correctAnswerIndex > index) {
        setCorrectAnswerIndex(correctAnswerIndex - 1);
      }
    }
  };

  const clearForm = () => {
    setNewQuestionType("");
    setNewQuestionContent([]);
    setNewQuestionOptions([]);
    setNewMcqOptions([]);
    setCorrectAnswerIndex(null);
    setNewQuestionObjective([]);
    setNewSlideIds([]);
    setNewHumanFeedback("");
  };

  // Handle question creation
  const handleCreateQuestion = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) {
      e.preventDefault();
    }

    if (newQuestionType === "multiple choice") {
      // Validate MCQ options
      const validOptions = newMcqOptions.filter(opt => opt.text.trim());
      if (validOptions.length < 2) {
        alert("Multiple choice questions need at least 2 non-empty options.");
        return;
      }
      if (correctAnswerIndex === null) {
        alert("Please select which option is the correct answer.");
        return;
      }
      // Adjust correct answer index if some options were filtered
      if (validOptions.length !== newMcqOptions.length) {
        const newCorrectIndex = validOptions.findIndex(opt => 
          newMcqOptions[correctAnswerIndex] && opt.text === newMcqOptions[correctAnswerIndex].text
        );
        if (newCorrectIndex === -1) {
          alert("The correct answer option cannot be empty.");
          return;
        }
        setCorrectAnswerIndex(newCorrectIndex);
        setNewMcqOptions(validOptions);
      }
    }

    setLoading(true);
    console.log(newSlideIds)
    try {
      let requestData: any = {
        type: newQuestionType,
        content: newQuestionContent,
        objective: newQuestionObjective,
        slide_ids: newSlideIds,
        creater_email: userEmail,
      };

      if (newQuestionType === "multiple choice") {
        // Create options with isCorrect flag
        requestData.options = newMcqOptions.map((opt, index) => ({
          text: opt.text,
          isCorrect: index === correctAnswerIndex
        }));
        // Add MCQ-specific feedback as arrays
        requestData.mcq_human_feedback = newMcqOptions.map(opt => opt.feedback || '');
      } else if (newQuestionType === "open ended") {
        requestData.human_feedback = newHumanFeedback;
      }

      const res = await axios.post(`/api/questions/create`, requestData);

      if (res.status === 200 || res.status === 201) {
        // If MCQ, generate AI feedback for all options
        if (newQuestionType === "multiple choice" && res.data?.question_id) {
          try {
            await axios.post(`/api/v2/mcq/generate_feedback`, {
              question_id: res.data.question_id,
              participant_id: userEmail, // Using email as participant ID for now
              question_content: newQuestionContent,
              options: requestData.options,
              mcq_human_feedback: requestData.mcq_human_feedback,
              slide_ids: newSlideIds,
              course_version: "v2b" // Force corrective feedback generation
            });
            console.log("MCQ feedback generated successfully");
          } catch (error) {
            console.error("Error generating MCQ feedback:", error);
            // Don't fail the whole operation if feedback generation fails
          }
        }
        
        await fetchQuestions();
        clearForm();
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Error creating question:", error);
    } finally {
      setLoading(false);
    }
  };

  // Handle MCQ feedback update
  const handleUpdateMCQFeedback = async (question: Question) => {
    setUpdatingFeedback(question.question_id);
    try {
      // Prepare the request data
      const requestData = {
        question_id: question.question_id,
        participant_id: userEmail, // Using email as participant ID
        question_content: question.content,
        options: question.options || [],
        mcq_human_feedback: question.mcq_human_feedback || [],
        slide_ids: question.slide_ids || [],
        course_version: "v2b" // Force corrective feedback generation
      };
      
      const res = await axios.post(`/api/v2/mcq/generate_feedback`, requestData);
      
      if (res.status === 200) {
        alert("AI feedback updated successfully!");
        // Refresh the questions list to show updated feedback
        await fetchQuestions();
      }
    } catch (error) {
      console.error("Error updating MCQ feedback:", error);
      alert("Failed to update AI feedback. Please try again.");
    } finally {
      setUpdatingFeedback(null);
    }
  };

  // Handle question deletion
  const handleDeleteQuestion = async (questionId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this question?");
    if (!confirmDelete) return;

    setDeleting(questionId);
    try {
      const res = await axios.delete(`/api/questions/by_id/${questionId}`);
      if (res.status === 200 || res.status === 204) {
        fetchQuestions();
      }
    } catch (error) {
      console.error("Error deleting question:", error);
    } finally {
      setDeleting(null);
    }
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredQuestions = useMemo(() => {
    return questions.filter((question) => {
      if (typeFilter !== "all" && (question.type ?? "") !== typeFilter) return false;
      if (!normalizedSearch) return true;

      const id = String(question.question_id ?? "").toLowerCase();
      const type = String(question.type ?? "").toLowerCase();
      const preview = getQuestionTextPreview(question).toLowerCase();
      return id.includes(normalizedSearch) || type.includes(normalizedSearch) || preview.includes(normalizedSearch);
    });
  }, [normalizedSearch, questions, typeFilter]);

  const sortedQuestions = useMemo(() => {
    const list = [...filteredQuestions];
    list.sort((a, b) => {
      let aValue = "";
      let bValue = "";

      if (sortKey === "created_at") {
        aValue = String(a.created_at ?? "");
        bValue = String(b.created_at ?? "");
      } else if (sortKey === "type") {
        aValue = String(a.type ?? "");
        bValue = String(b.type ?? "");
      } else {
        aValue = getQuestionTextPreview(a);
        bValue = getQuestionTextPreview(b);
      }

      const base = aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? base : -base;
    });
    return list;
  }, [filteredQuestions, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedQuestions.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedQuestions = sortedQuestions.slice(pageStart, pageStart + PAGE_SIZE);
  const displayedCount = pagedQuestions.length;
  const paginationTokens = getPaginationTokens(currentPage, totalPages);
  const sortIndicator = (key: SortKey) => (sortKey !== key ? "↕" : sortDirection === "asc" ? "↑" : "↓");
  const typeOptions = useMemo(() => {
    const uniqueTypes = Array.from(new Set(questions.map((q) => q.type).filter(Boolean) as string[])).sort();
    return ["all", ...uniqueTypes];
  }, [questions]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "created_at" ? "desc" : "asc");
  };

  const getPlayerHref = (question: Question) => {
    if (question.type === "multiple choice") return `/mcq/${question.question_id}${ltiQuery}`;
    return `/oeq/${question.question_id}${ltiQuery}`;
  };

  const questionColumns: ManageTableColumn<Question>[] = [
    {
      id: "preview",
      headerClassName: "w-[45%] px-4 py-3 text-left font-semibold text-slate-700",
      header: (
        <button
          type="button"
          onClick={() => handleSort("preview")}
          className="inline-flex items-center gap-1 hover:text-slate-900"
        >
          Question
          <span className="text-slate-400">{sortIndicator("preview")}</span>
        </button>
      ),
      cellClassName: "px-4 py-3 align-top",
      renderCell: (question) => {
        const imagePreview = getQuestionImagePreview(question);
        return (
          <div className="flex min-w-0 items-start gap-3">
            {imagePreview ? (
              <div className="hidden w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 sm:block">
                <DynamicImage
                  src={imagePreview}
                  alt="Question preview"
                  maxWidth={160}
                  className="h-16 w-full object-cover"
                />
              </div>
            ) : null}
            <div className="min-w-0">
              <Link
                href={`/manage/question/${question.question_id}${ltiQuery}`}
                className="block break-words font-medium text-slate-900 underline-offset-4 hover:text-blue-700 hover:underline"
              >
                {getQuestionTextPreview(question)}
              </Link>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">{question.question_id}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: "type",
      headerClassName: "w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700",
      header: (
        <button
          type="button"
          onClick={() => handleSort("type")}
          className="inline-flex items-center gap-1 hover:text-slate-900"
        >
          Type
          <span className="text-slate-400">{sortIndicator("type")}</span>
        </button>
      ),
      cellClassName: "w-[1%] whitespace-nowrap px-4 py-3 align-top",
      renderCell: (question) => (
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
            {question.type || "Unknown"}
          </span>
          {question.type === "multiple choice" ? (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                (question as any).mcq_ai_feedback
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {(question as any).mcq_ai_feedback ? "AI feedback ready" : "AI feedback missing"}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "created_at",
      headerClassName: "w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700",
      header: (
        <button
          type="button"
          onClick={() => handleSort("created_at")}
          className="inline-flex items-center gap-1 hover:text-slate-900"
        >
          Created
          <span className="text-slate-400">{sortIndicator("created_at")}</span>
        </button>
      ),
      cellClassName: "w-[1%] whitespace-nowrap px-4 py-3 align-top text-slate-600",
      renderCell: (question) => formatCreatedAt(question.created_at),
    },
    {
      id: "actions",
      headerClassName: "w-[1%] whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700",
      header: "Actions",
      cellClassName: "w-[1%] whitespace-nowrap px-4 py-3 align-top",
      renderCell: (question) => (
        <div className="flex justify-end gap-2">
          <Link href={getPlayerHref(question)}>
            <ActionButton variant="success" size="sm" className="rounded-lg">
              Open Player
            </ActionButton>
          </Link>
          {question.type === "multiple choice" ? (
            <ActionButton
              onClick={() => handleUpdateMCQFeedback(question)}
              variant="secondary"
              size="sm"
              className="rounded-lg"
              disabled={updatingFeedback === question.question_id}
            >
              {updatingFeedback === question.question_id ? "Updating..." : "Update AI"}
            </ActionButton>
          ) : null}
          <ActionButton
            onClick={() => handleDeleteQuestion(question.question_id)}
            variant="danger"
            size="sm"
            className="rounded-lg"
            disabled={deleting === question.question_id}
          >
            {deleting === question.question_id ? "Deleting..." : "Delete"}
          </ActionButton>
        </div>
      ),
    },
  ];

  if (isPermissionChecking || !hasManagePermission) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Question Management
              </p>
              <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
                Your Questions
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                Browse, search, and manage questions used in your content workflows.
              </p>
              {message ? (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {message}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <ManageListPanel
          toolbarLeft={(
            <ActionButton
              onClick={() => setIsModalOpen(true)}
              variant="primary"
              className="rounded-lg px-3.5 py-2"
            >
              Create Question
            </ActionButton>
          )}
          toolbarRight={(
            <>
              <div className="relative w-full md:w-96">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search ID, type, or question text..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-300"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  ⌕
                </span>
              </div>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
              >
                {typeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === "all" ? "All types" : option}
                  </option>
                ))}
              </select>
              <ActionButton
                onClick={() => fetchQuestions()}
                variant="neutral"
                size="sm"
                className="rounded-xl"
              >
                {isFetchingQuestions ? "Refreshing..." : "Refresh"}
              </ActionButton>
            </>
          )}
          table={(
            <ManageDataTable
              rows={pagedQuestions}
              rowKey={(question, index) => question.question_id || `question-${index}`}
              columns={questionColumns}
              rowClassName="transition-colors hover:bg-slate-50/70"
              emptyContent={normalizedSearch ? "No matching questions found." : "No questions available."}
              expandableRows={{
                getRowId: (question) => question.question_id,
                isRowExpandable: (question) =>
                  Boolean(
                    question.question_id ||
                    question.objective?.length ||
                    question.slide_ids?.length ||
                    question.content?.length ||
                    question.options?.length
                  ),
                toggleAriaLabel: (question, _rowIndex, isExpanded) =>
                  `${isExpanded ? "Collapse" : "Expand"} details for question ${question.question_id}`,
                renderExpandedContent: (question) => {
                  const imagePreview = getQuestionImagePreview(question);
                  return (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Question ID
                          </div>
                          <div className="break-all font-mono text-xs text-slate-700">
                            {question.question_id}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Text Preview
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-slate-700">
                            {getQuestionTextPreview(question)}
                          </p>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Objectives
                          </div>
                          <p className="text-sm text-slate-700">
                            {question.objective?.filter(Boolean).join("; ") || "None"}
                          </p>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Slides
                          </div>
                          <p className="break-all text-sm text-slate-700">
                            {question.slide_ids?.length ? question.slide_ids.join(", ") : "None"}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {imagePreview ? (
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                            <DynamicImage
                              src={imagePreview}
                              alt="Question image"
                              maxWidth={360}
                              className="w-full object-contain"
                            />
                          </div>
                        ) : null}
                        {question.type === "multiple choice" && question.options?.length ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Options
                            </div>
                            <ul className="space-y-2">
                              {question.options.map((option, idx) => (
                                <li key={`${question.question_id}-opt-${idx}`} className="text-sm text-slate-700">
                                  <span className="mr-2 inline-flex min-w-5 justify-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                                    {idx + 1}
                                  </span>
                                  {option.text || "(Empty option)"}
                                  {option.isCorrect ? (
                                    <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                      Correct
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                },
              }}
            />
          )}
          pagination={{
            currentPage,
            totalPages,
            tokens: paginationTokens,
            isLoading: isFetchingQuestions,
            onPrev: () => setCurrentPage((prev) => Math.max(1, prev - 1)),
            onNext: () => setCurrentPage((prev) => Math.min(totalPages, prev + 1)),
            onPageSelect: (page) => setCurrentPage(page),
          }}
          summary={(
            <p className="text-center text-sm text-slate-500">
              Showing {displayedCount} question{displayedCount === 1 ? "" : "s"} of {sortedQuestions.length}
              {normalizedSearch || typeFilter !== "all" ? " filtered" : ""} (page {currentPage} of {totalPages})
            </p>
          )}
        />

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl md:p-6">
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-slate-900 md:text-2xl">Create New Question</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Configure the question content, answer settings, and related course context.
                </p>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                handleCreateQuestion();
              }} className="space-y-5">
              {/* Question Type */}
              <div>
                <label htmlFor="questionType" className="mb-1 block text-sm font-medium text-slate-700">
                  Question Type
                </label>
                <select
                  id="questionType"
                  value={newQuestionType}
                  onChange={(e) => setNewQuestionType(e.target.value)}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  required
                >
                  <option value="">Select Question Type</option>
                  <option value="multiple choice">Multiple Choice</option>
                  <option value="open ended">Open Ended</option>
                </select>
              </div>

              {/* Content editor (text + images) */}
              <div>
                <ContentEditor contents={newQuestionContent} setContents={setNewQuestionContent} />
              </div>

              {/* Friendly Multiple Choice Editor */}
              {newQuestionType === "multiple choice" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-slate-700">Options</label>
                    <ActionButton
                      type="button"
                      onClick={addOption}
                      variant="secondary"
                      size="sm"
                      className="rounded-lg"
                    >
                      Add option
                    </ActionButton>
                  </div>

                  {newMcqOptions.length === 0 && (
                    <p className="mt-1 text-xs text-slate-500">Add at least two options.</p>
                  )}

                  <div className="space-y-4">
                    {newMcqOptions.map((opt, idx) => (
                      <div key={idx} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="flex items-start gap-3">
                          {/* Radio button for correct answer */}
                          <div className="pt-1">
                            <input
                              type="radio"
                              id={`correct-${idx}`}
                              name="correctAnswer"
                              checked={correctAnswerIndex === idx}
                              onChange={() => setCorrectAnswerIndex(idx)}
                              className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <label htmlFor={`correct-${idx}`} className="sr-only">
                              Mark as correct answer
                            </label>
                          </div>
                          
                          {/* Option number */}
                          <span className="pt-1 text-sm font-medium text-slate-600">{idx + 1}.</span>
                          
                          {/* Option text input */}
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={opt.text}
                              onChange={(e) => updateOption(idx, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                }
                              }}
                              placeholder={`Option ${idx + 1}`}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300"
                            />
                            
                            {/* Feedback for this option */}
                            <div>
                              <label htmlFor={`feedback-${idx}`} className="mb-1 block text-xs font-medium text-slate-600">
                                Feedback for this option
                              </label>
                              <textarea
                                id={`feedback-${idx}`}
                                value={opt.feedback || ""}
                                onChange={(e) => updateOptionFeedback(idx, e.target.value)}
                                placeholder="Enter feedback that will be shown when this option is selected"
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300"
                                rows={2}
                              />
                            </div>
                          </div>
                          
                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => removeOption(idx)}
                            aria-label={`Remove option ${idx + 1}`}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-sm text-rose-700 hover:bg-rose-100"
                          >
                            Remove
                          </button>
                        </div>
                        
                        {/* Visual indicator for correct answer */}
                        {correctAnswerIndex === idx && (
                          <div className="flex items-center gap-2 text-sm text-emerald-700">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span>Correct Answer</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  {newMcqOptions.length > 0 && correctAnswerIndex === null && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700">
                      ⚠️ Please select which option is the correct answer
                    </p>
                  )}
                </div>
              )}

              {/* Human Feedback for Open Ended Questions */}
              {newQuestionType === "open ended" && (
                <div>
                  <label htmlFor="humanFeedback" className="mb-1 block text-sm font-medium text-slate-700">
                    Reference Answer / Human Feedback
                  </label>
                  <textarea
                    id="humanFeedback"
                    value={newHumanFeedback}
                    onChange={(e) => setNewHumanFeedback(e.target.value)}
                    placeholder="Enter a reference answer or feedback template for this open-ended question"
                    className="block min-h-[100px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    rows={4}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    This reference answer will be used to guide AI feedback generation for student responses.
                  </p>
                </div>
              )}

              {/* Course selector */}
              <div>
                <label htmlFor="courseId" className="mb-1 block text-sm font-medium text-slate-700">
                  Course
                </label>
                <select
                  id="courseId"
                  value={course ?? ""}
                  onChange={(e) => setCourse(e.target.value || null)}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  disabled={coursesLoading}
                >
                  {coursesLoading && <option>Loading courses…</option>}
                  {!coursesLoading && courses.length === 0 && <option>No courses found</option>}
                  {!coursesLoading &&
                    courses.map((c: any) => {
                      const id = c.course_id;
                      const label = c.course_title ?? `Course ${id}`;
                      return (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      );
                    })}
                </select>
              </div>

              {/* Module selector (multi) */}
              <div>
                <label htmlFor="moduleIds" className="mb-1 block text-sm font-medium text-slate-700">
                  Modules
                </label>
                <select
                  id="moduleIds"
                  multiple
                  value={module}
                  onChange={(e) =>
                    setModule(Array.from(e.target.selectedOptions).map((o) => o.value))
                  }
                  className="block min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  disabled={modulesLoading || !course}
                >
                  {modulesLoading && <option>Loading modules…</option>}
                  {!modulesLoading && availableModules.length === 0 && <option>No modules found</option>}
                  {!modulesLoading &&
                    availableModules.map((m: any) => {
                      const id = m.module_id;
                      const label = m.module_title ?? `Module ${id}`;
                      return (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      );
                    })}
                </select>
                <p className="mt-1 text-xs text-slate-500">Hold Ctrl/Cmd to select multiple.</p>
              </div>


              {/* Slides multi-select */}
              <div>
                <label htmlFor="slideIds" className="mb-1 block text-sm font-medium text-slate-700">
                  Slide IDs
                </label>
                <select
                  id="slideIds"
                  multiple
                  value={newSlideIds}
                  onChange={(e) =>
                    setNewSlideIds(Array.from(e.target.selectedOptions).map((o) => o.value))
                  }
                  className="block min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  disabled={slidesLoading}
                >
                  {slidesLoading && <option>Loading slides…</option>}
                  {!slidesLoading && availableSlides.length === 0 && (
                    <option>No slides found</option>
                  )}
                  {!slidesLoading &&
                    availableSlides.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.slide_title}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">Hold Ctrl/Cmd to select multiple.</p>
              </div>

              {/* Learning objectives */}
              <div>
                <label htmlFor="questionObjective" className="mb-1 block text-sm font-medium text-slate-700">
                  Learning Objectives (semicolon-separated)
                </label>
                <input
                  id="questionObjective"
                  type="text"
                  value={newQuestionObjective.join(";")}
                  onChange={(e) => setNewQuestionObjective(e.target.value.split(";"))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                    }
                  }}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                />
              </div>

              <div className="flex justify-end gap-3">
                <ActionButton
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    clearForm();
                  }}
                  variant="ghost"
                  className="rounded-lg"
                >
                  Cancel
                </ActionButton>
                <ActionButton
                  type="button"
                  onClick={() => handleCreateQuestion()}
                  disabled={loading}
                  variant="primary"
                  className="rounded-lg"
                >
                  {loading ? "Creating…" : "Create Question"}
                </ActionButton>
              </div>
            </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default QuestionOverview;
