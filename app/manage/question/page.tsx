"use client";
import axios from "axios";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Slide } from "@/app/types";
import ContentEditor from "@/app/components/ContentEditor";
import DynamicImage from "@/app/components/DynamicImage";
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
  content: QuestionContent[];
  options?: Array<{ text: string; isCorrect: boolean }>;
  mcq_human_feedback?: string[];
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
  const [newMcqOptions, setNewMcqOptions] = useState<MCQOption[]>([]);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState<number | null>(null);
  const [newQuestionObjective, setNewQuestionObjective] = useState<string[]>([]);
  const [newSlideIds, setNewSlideIds] = useState<string[]>([]);
  const [newHumanFeedback, setNewHumanFeedback] = useState<string>("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [updatingFeedback, setUpdatingFeedback] = useState<string | null>(null);

  const { data } = useSession();
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
                <Link href={`/manage/question/${question.question_id}${ltiQuery}`}>
                  <span className="text-lg font-medium text-indigo-600 hover:text-indigo-800">
                    {question.type === "multiple choice" && (
                      <span className={`inline-block mr-2 px-2 py-1 text-xs rounded ${
                        (question as any).mcq_ai_feedback 
                          ? "bg-green-100 text-green-700" 
                          : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {(question as any).mcq_ai_feedback ? "AI ✓" : "No AI"}
                      </span>
                    )}
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
                        window.location.href = `/v2/mcq/${question.question_id}${ltiQuery}`;
                      } else if (question.type === "open ended") {
                        window.location.href = `/v2/oeq/${question.question_id}${ltiQuery}`;
                      }
                    }}
                    className="py-2 px-4 text-white bg-green-600 hover:bg-green-700 rounded-md"
                  >
                    Go to SlideItRight
                  </button>
                  {question.type === "multiple choice" && (
                    <button
                      onClick={() => handleUpdateMCQFeedback(question)}
                      className={`py-2 px-4 text-white bg-blue-600 hover:bg-blue-700 rounded-md ${
                        updatingFeedback === question.question_id ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                      disabled={updatingFeedback === question.question_id}
                    >
                      {updatingFeedback === question.question_id ? "Updating..." : "Update AI Feedback"}
                    </button>
                  )}
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
            <form onSubmit={(e) => {
              e.preventDefault();
              handleCreateQuestion();
            }} className="space-y-5">
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
                <div className="space-y-4">
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

                  {newMcqOptions.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">Add at least two options.</p>
                  )}

                  <div className="space-y-4">
                    {newMcqOptions.map((opt, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-lg p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          {/* Radio button for correct answer */}
                          <div className="pt-1">
                            <input
                              type="radio"
                              id={`correct-${idx}`}
                              name="correctAnswer"
                              checked={correctAnswerIndex === idx}
                              onChange={() => setCorrectAnswerIndex(idx)}
                              className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                            />
                            <label htmlFor={`correct-${idx}`} className="sr-only">
                              Mark as correct answer
                            </label>
                          </div>
                          
                          {/* Option number */}
                          <span className="text-sm font-medium text-gray-600 pt-1">{idx + 1}.</span>
                          
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
                              className="w-full p-2 border border-gray-300 rounded-md"
                            />
                            
                            {/* Feedback for this option */}
                            <div>
                              <label htmlFor={`feedback-${idx}`} className="block text-xs font-medium text-gray-600 mb-1">
                                Feedback for this option
                              </label>
                              <textarea
                                id={`feedback-${idx}`}
                                value={opt.feedback || ''}
                                onChange={(e) => updateOptionFeedback(idx, e.target.value)}
                                placeholder="Enter feedback that will be shown when this option is selected"
                                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                                rows={2}
                              />
                            </div>
                          </div>
                          
                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => removeOption(idx)}
                            aria-label={`Remove option ${idx + 1}`}
                            className="px-3 py-1 text-sm rounded-md bg-red-50 text-red-600 hover:bg-red-100"
                          >
                            Remove
                          </button>
                        </div>
                        
                        {/* Visual indicator for correct answer */}
                        {correctAnswerIndex === idx && (
                          <div className="flex items-center gap-2 text-green-600 text-sm">
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
                    <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded-md">
                      ⚠️ Please select which option is the correct answer
                    </p>
                  )}
                </div>
              )}

              {/* Human Feedback for Open Ended Questions */}
              {newQuestionType === "open ended" && (
                <div>
                  <label htmlFor="humanFeedback" className="block text-sm font-medium text-gray-700">
                    Reference Answer / Human Feedback
                  </label>
                  <textarea
                    id="humanFeedback"
                    value={newHumanFeedback}
                    onChange={(e) => setNewHumanFeedback(e.target.value)}
                    placeholder="Enter a reference answer or feedback template for this open-ended question"
                    className="mt-1 block w-full p-2 border border-gray-300 rounded-md min-h-[100px]"
                    rows={4}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    This reference answer will be used to guide AI feedback generation for student responses.
                  </p>
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                    }
                  }}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    clearForm();
                  }}
                  className="py-2 px-4 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateQuestion()}
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
