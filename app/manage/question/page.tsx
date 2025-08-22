"use client";
import axios from "axios";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Slide } from "@/app/types";
import ContentEditor from "@/app/components/ContentEditor";
import DynamicImage from "@/app/components/DynamicImage";

export interface QuestionContent {
  type: string; // text, image, etc.
  content: string;
}

export interface Question {
  question_id: string;
  type: string; // "multiple choice" | "open ended"
  objective?: string[];
  slide_ids?: string[];
  content: QuestionContent[];
  options?: string[];
}

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
  const [newQuestionObjective, setNewQuestionObjective] = useState<string[]>([]);
  const [newSlideIds, setNewSlideIds] = useState<string[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data } = useSession();
  const userEmail = data?.user?.email ?? "";

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
  }, [course]);


  // 2) When a course is picked, fetch its modules
  useEffect(() => {
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
  }, [course, module.length]);


  // 3) When module selection changes, fetch slides for those modules
  useEffect(() => {
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
  }, [module]);

  // Fetch questions
  const fetchQuestions = useCallback(async () => {
    try {
      const res = await axios.get(`/api/questions/all`);
      setQuestions(res.data || []);
    } catch (err) {
      console.error("Error fetching questions:", err);
    }
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  // Multiple-choice option editor helpers
  const addOption = () => setNewQuestionOptions((opts) => [...opts, ""]);
  const updateOption = (index: number, value: string) =>
    setNewQuestionOptions((opts) => opts.map((o, i) => (i === index ? value : o)));
  const removeOption = (index: number) =>
    setNewQuestionOptions((opts) => opts.filter((_, i) => i !== index));

  const clearForm = () => {
    setNewQuestionType("");
    setNewQuestionContent([]);
    setNewQuestionOptions([]);
    setNewQuestionObjective([]);
    setNewSlideIds([]);
  };

  // Handle question creation
  const handleCreateQuestion = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (newQuestionType === "multiple choice") {
      const trimmed = newQuestionOptions.map((o) => o.trim()).filter(Boolean);
      if (trimmed.length < 2) {
        alert("Multiple choice questions need at least 2 non-empty options.");
        return;
      }
      if (trimmed.length !== newQuestionOptions.length) {
        setNewQuestionOptions(trimmed);
      }
    }

    setLoading(true);
    console.log(newSlideIds)
    try {
      const res = await axios.post(`/api/questions/create`, {
        type: newQuestionType,
        content: newQuestionContent,
        options: newQuestionType === "multiple choice" ? newQuestionOptions : undefined,
        objective: newQuestionObjective,
        slide_ids: newSlideIds,
        creater_email: userEmail,
      });

      if (res.status === 200 || res.status === 201) {
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

  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold mb-6">Question Overview</h1>

      {/* Modal Trigger */}
      <section className="bg-white p-6 rounded-lg shadow-lg mb-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Your Questions</h2>
          <button
            onClick={() => setIsModalOpen(true)}
            className="py-2 px-4 text-white bg-blue-600 hover:bg-blue-700 rounded-md"
          >
            Create Question
          </button>
        </div>
        <ul className="space-y-4 mt-4">
          {questions.length === 0 ? (
            <li className="text-gray-500">No questions available</li>
          ) : (
            questions.map((question) => (
              <li
                key={question.question_id}
                className="flex justify-between items-center bg-gray-100 p-4 rounded-lg"
              >
                <Link href={`/manage/question/${question.question_id}`}>
                  <span className="text-lg font-medium text-indigo-600 hover:text-indigo-800">
                    {question.content.map((item, index) => {
                      if (item.type === "text") {
                        return <p key={index}>{item.content}</p>;
                      } else if (item.type === "image") {
                        return (
                          <DynamicImage
                            key={index}
                            src={item.content}
                            maxWidth={500}
                            alt="Question content"
                            className="max-w-xs mt-2"
                          />
                        );
                      }
                      return null;
                    })}
                  </span>
                </Link>
                <div className="flex space-x-4">
                  <button
                    onClick={() => {
                      if (question.type === "multiple choice") {
                        window.location.href = `/v2/mcq/${question.question_id}`;
                      } else if (question.type === "open ended") {
                        window.location.href = `/v2/oeq/${question.question_id}`;
                      }
                    }}
                    className="py-2 px-4 text-white bg-green-600 hover:bg-green-700 rounded-md"
                  >
                    Go to SlideItRight
                  </button>
                  <button
                    onClick={() => handleDeleteQuestion(question.question_id)}
                    className={`py-2 px-4 text-white bg-red-600 hover:bg-red-700 rounded-md ${
                      deleting === question.question_id ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    disabled={deleting === question.question_id}
                  >
                    {deleting === question.question_id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-75">
          <div className="bg-white rounded-lg p-8 shadow-lg w-full max-w-xl max-h-[70vh] overflow-y-auto">
            <h2 className="text-2xl font-semibold mb-4">Create New Question</h2>
            <form onSubmit={handleCreateQuestion} className="space-y-5">
              {/* Question Type */}
              <div>
                <label htmlFor="questionType" className="block text-sm font-medium text-gray-700">
                  Question Type
                </label>
                <select
                  id="questionType"
                  value={newQuestionType}
                  onChange={(e) => setNewQuestionType(e.target.value)}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
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
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">Options</label>
                    <button
                      type="button"
                      onClick={addOption}
                      className="text-sm px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      Add option
                    </button>
                  </div>

                  {newQuestionOptions.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">Add at least two options.</p>
                  )}

                  <ul className="mt-3 space-y-2">
                    {newQuestionOptions.map((opt, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 w-6">{idx + 1}.</span>
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => updateOption(idx, e.target.value)}
                          placeholder={`Option ${idx + 1}`}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(idx)}
                          aria-label={`Remove option ${idx + 1}`}
                          className="px-2 py-1 text-sm rounded-md bg-gray-100 hover:bg-gray-200"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Course selector */}
              <div>
                <label htmlFor="courseId" className="block text-sm font-medium text-gray-700">
                  Course
                </label>
                <select
                  id="courseId"
                  value={course ?? ""}
                  onChange={(e) => setCourse(e.target.value || null)}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
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
                <label htmlFor="moduleIds" className="block text-sm font-medium text-gray-700">
                  Modules
                </label>
                <select
                  id="moduleIds"
                  multiple
                  value={module}
                  onChange={(e) =>
                    setModule(Array.from(e.target.selectedOptions).map((o) => o.value))
                  }
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md min-h-28"
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
                <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple.</p>
              </div>


              {/* Slides multi-select */}
              <div>
                <label htmlFor="slideIds" className="block text-sm font-medium text-gray-700">
                  Slide IDs
                </label>
                <select
                  id="slideIds"
                  multiple
                  value={newSlideIds}
                  onChange={(e) =>
                    setNewSlideIds(Array.from(e.target.selectedOptions).map((o) => o.value))
                  }
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md min-h-28"
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
                <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple.</p>
              </div>

              {/* Learning objectives */}
              <div>
                <label htmlFor="questionObjective" className="block text-sm font-medium text-gray-700">
                  Learning Objectives (semicolon-separated)
                </label>
                <input
                  id="questionObjective"
                  type="text"
                  value={newQuestionObjective.join(";")}
                  onChange={(e) => setNewQuestionObjective(e.target.value.split(";"))}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="py-2 px-4 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="py-2 px-4 text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
                >
                  {loading ? "Creating…" : "Create Question"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default QuestionOverview;
