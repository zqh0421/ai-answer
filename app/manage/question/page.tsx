'use client';
import axios from "axios";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Slide } from "@/app/page";
import ContentEditor from "@/app/components/ContentEditor";
import Image from 'next/image';

export interface QuestionContent {
  type: string; // text, image, etc.
  content: string;
}

export interface Question {
  question_id: string;
  type: string; // Question type, e.g., "multiple choice", "open ended"
  objective?: string[]; // Learning objectives as an array of strings
  slide_ids?: string[]; // Array of related slide IDs
  content: QuestionContent[]; // JSON object for question content
  options?: string[]; // JSON object for question options (if applicable)
}

const QuestionOverview = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [slides] = useState<Slide[]>([]); // Slide data for dropdown
  const [newQuestionType, setNewQuestionType] = useState('');
  const [newQuestionContent, setNewQuestionContent] = useState<QuestionContent[]>([]);
  const [newQuestionOptions, setNewQuestionOptions] = useState<string[]>([]);
  const [newQuestionObjective, setNewQuestionObjective] = useState<string[]>([]);
  const [newSlideIds, setNewSlideIds] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data } = useSession();

  /// Fetch slides
  const fetchSlides = useCallback(async () => {
    // try {
    //   const res = await axios.get(`/api/slides/createdby/${data?.user?.email}`); // Adjust endpoint as needed
    //   setSlides(res.data);
    // } catch (err) {
    //   console.error('Error fetching slides:', err);
    // }
  }, []);

  // Fetch questions
  const fetchQuestions = useCallback(async () => {
    try {
      const res = await axios.get(`/api/questions/all`);
      setQuestions(res.data);
    } catch (err) {
      console.error('Error fetching questions:', err);
    }
  }, []);

  useEffect(() => {
    fetchSlides();
    fetchQuestions();
  }, [fetchSlides, fetchQuestions]);

  // Handle question creation
  const handleCreateQuestion = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(`/api/questions/create`, {
        type: newQuestionType,
        content: newQuestionContent, // Pass the structured content
        options: newQuestionType === 'multiple choice' ? newQuestionOptions : undefined,
        objective: newQuestionObjective,
        slide_ids: newSlideIds,
        creater_email: data?.user?.email || "",
      });

      if (res.status === 200 || res.status === 201) {
        fetchQuestions();
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
                    {/* Render question content */}
                    {question.content.map((item, index) => {
                      if (item.type === "text") {
                        return <p key={index}>{item.content}</p>;
                      } else if (item.type === "image") {
                        return (
                          <Image
                            key={index}
                            src={item.content}
                            alt="Question content"
                            className="max-w-xs mt-2"
                          />
                        );
                      }
                      return null; // Fallback for unsupported content types
                    })}
                  </span>
                </Link>
                <div className="flex space-x-4">
                  <button
                    onClick={() => window.location.href = `/?question_id=${question.question_id}`}
                    className="py-2 px-4 text-white bg-green-600 hover:bg-green-700 rounded-md"
                  >
                    Go to MuFIN
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
          <div className="bg-white rounded-lg p-8 shadow-lg w-full max-w-md">
            <h2 className="text-2xl font-semibold mb-4">Create New Question</h2>
            <form onSubmit={handleCreateQuestion}>
              <div className="mb-4">
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
              <div className="mb-4">
                <ContentEditor
                  contents={newQuestionContent}
                  setContents={setNewQuestionContent}
                />
              </div>
              {newQuestionType === 'multiple choice' && (
                <div className="mb-4">
                  <label htmlFor="questionOptions" className="block text-sm font-medium text-gray-700">
                    Question Options (JSON)
                  </label>
                  <textarea
                    id="questionOptions"
                    value={JSON.stringify(newQuestionOptions, null, 2)}
                    onChange={(e) => {
                      try {
                        setNewQuestionOptions(JSON.parse(e.target.value));
                      } catch {
                        console.error("Invalid JSON format");
                      }
                    }}
                    className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                  />
                </div>
              )}
              <div className="mb-4">
                <label htmlFor="slideIds" className="block text-sm font-medium text-gray-700">
                  Slide IDs
                </label>
                <select
                  id="slideIds"
                  multiple
                  value={newSlideIds}
                  onChange={(e) =>
                    setNewSlideIds(Array.from(e.target.selectedOptions).map((option) => option.value))
                  }
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                >
                  {slides.map((slide) => (
                    <option key={slide.id} value={slide.id}>
                      {slide.slide_title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="questionObjective" className="block text-sm font-medium text-gray-700">
                  Learning Objectives (Semicolon-separated)
                </label>
                <input
                  id="questionObjective"
                  type="text"
                  value={newQuestionObjective.join(";")}
                  onChange={(e) => setNewQuestionObjective(e.target.value.split(";"))}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
              <div className="flex justify-end space-x-4">
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
                  {loading ? "Creating..." : "Create Question"}
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