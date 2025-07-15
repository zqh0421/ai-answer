"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { useSearchParams } from 'next/navigation';
import { debounce } from 'lodash';
import { useSelector, useDispatch } from 'react-redux';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

import { RootState, AppDispatch } from '@/app/store/store';
import { saveAnswer, saveDraftAnswer, saveDraftQuestion } from '@/app/slices/userSlice';
import { Question, QuestionContent } from "@/app/manage/question/page";

import TestDrawer from '@/app/components/TestDrawer';
import DynamicImage from "@/app/components/DynamicImage";
import ParticipantModal from '@/app/components/ParticipantModal';
import ContentEditor from "@/app/components/ContentEditor";
import HTMLFeedbackArea from "@/app/components/HTMLFeedbackArea";
import ReferenceArea from "@/app/components/ReferenceArea";
import { Reference, Course, Module, Slide, RecordResultInput, StructuredFeedback, FeedbackResult } from "@/app/types";

function HomeChildren() {
  const base_question = ""
  // const base_question = "What are pitfalls of E-Learning Design Principles & Methods about?"
  // const base_wrong_answer = ""
  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true); // Drawer state
  // const [question, setQuestion] = useState<QuestionContent[]>([
  //   { type: "text", content: base_question },
  // ]);
  const [result, setResult] = useState<FeedbackResult>(""); // For Result Display
  const [reference, setReference] = useState<Reference>(); // For Reference Display
  // const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [images, setImages] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(-1);
  const [loadedCount, setLoadedCount] = useState(-1);
  const [activeTab, setActiveTab] = useState("input"); // Track active tab

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedPromptEngineering, setSelectedPromptEngineering] = useState<string>("rag_cot");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] = useState<string>("feature");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();  // Course Selection
  const [courses, setCourses] = useState<Course[]>([]);  // Courses List View
  const [module, setModule] = useState<string[]>([]); // Multi-select modules
  const [slide, setSlide] = useState<string[]>([]);   // Multi-select slides

  const [availableModules, setAvailableModules] = useState<Module[]>([]);  // Modules for the selected course
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);    // Slides for the selected modules

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [preferredInfoType, setPreferredInfoType] = useState<string>("vision");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const searchParams = useSearchParams();
  const question_id = searchParams.get('question_id');
  const course_version = searchParams.get('version')

  const [questionPreset, setQuestionPreset] = useState<Question>({
    question_id: "",
    type: "",
    content: [],
  });
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
  const draftAnswer = useSelector((state: RootState) => state.user.draftAnswer);
  const draftQuestion = useSelector((state: RootState) => state.user.draftQuestion);

  const answers = useSelector((state: RootState) => state.user.answers);
  const participantId = useSelector((state: RootState) => state.user.participantId);
  // const [answer, setAnswer] = useState(answers[question_id || ''] || ''); // For Answer Input
  const [answer, setAnswer] = useState(
    question_id ? (answers[question_id] || '') : (draftAnswer || '')
  );
  const [question, setQuestion] = useState<QuestionContent[]>(
    draftQuestion
      ? [{ type: "text", content: draftQuestion }]
      : [{ type: "text", content: base_question }]
  );
  const [saveStatus, setSaveStatus] = useState("Saved"); // Save status indicator
  const dispatch = useDispatch<AppDispatch>();


  // const handleSaveAnswer = (temp_answer: string) => {
  //   if (question_id) {
  //     dispatch(saveAnswer({ questionId: question_id, answer: temp_answer }));
  //   }
  // };

  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAnswer(e.target.value);
    setSaveStatus("Saving...");
    debouncedSaveAnswer(e.target.value);
  };

  useEffect(() => {
    if (courses.length > 0 && !course) {
      setCourse(courses[0].course_id); // 默认选择第一个课程
    }
  }, [courses, course]);

  useEffect(() => {
    if (question_id) {
      setQuestionLoading(true);
      // Fetch the question by ID
      axios
        .get(`/api/questions/by_id/${question_id}`)
        .then((res) => {
          setQuestionPreset(res.data);
          // console.log(res.data)
          // no display input box question
        })
        .catch((err) => {
          console.error("Error fetching question:", err);
          window.location.href = "/";
        })
        .finally(() => {
          setQuestionLoading(false);
        });
    }
  }, [question_id]);

  useEffect(() => {
    axios
      .get("/api/courses/public")
      .then((response) => {
        setCourses(response.data);
      })
      .catch((error) => {
        console.error("Error fetching the courses:", error);
        setMessage("Failed to load courses.");
      });
  }, []);

  useEffect(() => {
    if (course) {
      axios
        .get(`/api/courses/by_id/${course}/modules`)
        .then((response) => {
          setAvailableModules(response.data.modules);
          setModule(response.data.modules.map((mod: Module) => mod.module_id))
        })
        .catch((error) => {
          console.error("Error fetching the courses:", error);
          setMessage("Failed to load courses.");
        });
    }
  }, [course])

  // Fetch slides for the selected modules whenever the module state changes
  useEffect(() => {
    if (module.length) {
      const fetchSlides = async () => {
        try {
          const slideRequests = module.map(modId => axios.get(`/api/modules/${modId}/slides`));
          const slideResponses = await Promise.all(slideRequests);

          // Flatten all the slide data into a single list
          const allSlides = slideResponses.flatMap(res => res.data.slides);
          setAvailableSlides(allSlides); // Update the available slides
          setSlide(allSlides.map(sld => sld.id))
        } catch (error) {
          console.error("Error fetching the slides:", error);
        }
      };
      fetchSlides();
    } else {
      setAvailableSlides([]); // Clear slides if no module is selected
    }
  }, [module]);

  const handlePdfImage = async (pageNumber: number, slideId: string) => {
    try {
      const response = await axios.post(
        "/api/pdf-to-image",
        {
          slide_id: slideId,
          page_number: pageNumber
        },
        {
          timeout: 60000
        }
      );
      // const imageBlob = response.data;
      // const imageUrl = URL.createObjectURL(imageBlob);
      // setImageSrc(response.data.img_base64);
      return response.data.img_base64
    } catch (error) {
      console.error('Error fetching image:', error);
      return null;
    }
  };

  useEffect(() => {
    axios
      .get("/api/test")
      .then((response) => {
        setMessage(response.data.message); // Assuming FastAPI returns { "message": "Backend Connected" }
        setIsDrawerOpen(false);
      })
      .catch((error) => {
        console.error("Error fetching the API:", error);
        setMessage("Failed to load message.");
      });
  }, []);

  useEffect(() => {
    if (!isImageLoading) {
      setLoadedCount(-1);
    }
  }, [isImageLoading])

  function handleInputResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  const handleRetrieve = async () => {
    try {
      // console.log(question_id)
      // console.log(question)
      // console.log(slide)
      // console.log(preferredInfoType)
      console.log(questionPreset.content || question)
      console.log(questionPreset.content)
      console.log(question)
      const response = await axios.post(
        "/api/embed",
        {
          question_id: question_id || null,
          question: questionPreset?.content?.length ? questionPreset.content : question, // TODO: revise for content editor
          slideIds: slide,
          preferredInfoType: preferredInfoType
        }
      );
      // console.log(response.data)
      const res = typeof response.data === "string" ? JSON.parse(response.data).result : response.data.result;

      // console.log("embed")
      // console.log(res)
      // res[0].text = res[0]?.text.replace(/\n\s*\n/g, '\n');

      setReference(res[0]);
      // console.log("REF")
      // console.log(res[0])

      if (preferredInfoType == "vision" && res[0].image_text) {
        setReference({
          ...res[0],
          display: res[0].image_text.replace(/\n\s*\n+/g, '\n')
        })
      } else if (res[0].text) {
        setReference({
          ...res[0],
          display: res[0].text
        })
      } else {
        setReference({
          ...res[0],
          display: "EMPTY REFERENCE"
        })
      }


      setSlideTextArr(res.map((item: Reference) => {
        if (preferredInfoType == "vision" && item.image_text) {
          return item.image_text;
        } else if (item.text) {
          return item.text;
        } else {
          alert(`${item.slide_title} unpublished!`)
        }
      }));
      // setSlideTextArr(response.data.result.map((item: { text: string }) => item.text)); // TODO: Adjustable
      let temp: string[] = [];
      const page_number = res[0].page_number;
      // const startPage = Math.max(0, page_number - 2); // Ensure page number doesn't go below 0
      // const endPage = page_number + 2;
      // setTotalCount(endPage - startPage + 1);
      const startPage = page_number;
      const endPage = page_number;
      setTotalCount(endPage - startPage + 1);
      setLoadedCount(0);

      // Fetch the images for the current page and its surrounding pages
      for (let i = startPage; i <= endPage; i++) {
        const image: string | null = await handlePdfImage(i, res[0].slide_id); // Await here to ensure it processes in order
        if (image !== null) {
          setLoadedCount(prevCount => prevCount + 1);
          temp = [...temp, image];
        }
      }

      // Set all fetched images to the state
      setImages(temp);
      setIsImageLoading(false);

      // console.log("images" + temp)
      setIsReferenceLoading(false);

      return {
        slide_text_arr: res.map((item: Reference) => {
          if (preferredInfoType == "vision" && item.image_text) {
            return item.image_text;
          } else if (item.text) {
            return item.text;
          } else {
            alert(`${item.slide_title} unpublished!`)
          }
        }),
        reference: res[0]
      }

    } catch (error) {
      console.error("Error fetching the result:", error);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
    }
  }

  const recordResultToDatabase = async (result: RecordResultInput) => {
    try {
      await axios.post("/api/record_result", result);
      // console.log("Successfully recorded result to db:", result);
    } catch (error) {
      console.error("Error recording result to database:", error);
    }
  };

  function isValidInput(input: string): boolean {
    // Regular expression to check if the string contains at least one alphanumeric character
    const alphanumericRegex = /[a-zA-Z0-9]/;

    // Check if the input is not empty and matches the regex
    return input.trim() !== "" && alphanumericRegex.test(input);
  }

  const handleSubmit = async () => {
    if (!question && !questionPreset) return;
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);

    const startTime = Date.now();
    let retrievalResult = null;
    if (course_version == 'a') {
      if (questionPreset) {
        try {
          const response = await axios.get(`/api/get_human_feedback/${questionPreset.question_id}`)
          // console.log(response)
          const endTime = Date.now();
          const recordPayload: RecordResultInput = {
            learner_id: participantId || "unidentifiable_learner",
            // ip_address: "todo",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.human_feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type: preferredInfoType === "vision" && reference?.image_text ? "vision" : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: [],
            reference_slide_page_number: -1,
            reference_slide_content: "",
            reference_slide_id: "", // to be updated
            submission_time: startTime,
            system_total_response_time: endTime - startTime
          };
          // TODO: record result to database to be updated
          // await recordResultToDatabase(recordPayload);
          // console.log("Successfully recorded result:", recordPayload);
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
        if (selectedPromptEngineering === "rag_zero" ||
          selectedPromptEngineering === "rag_few" ||
          selectedPromptEngineering === "rag_cot" ||
          selectedPromptEngineering === "graph_rag"
        ) {
          retrievalResult = await handleRetrieve();
          // console.log("time1")
          // console.log(Date.now() - startTime)
          response = await axios.post("/api/generate_feedback_rag", {
            promptEngineering: selectedPromptEngineering,
            feedbackFramework: selectedFeedbackFramework,
            question: questionPreset.content || question,
            answer: isValidInput(answer) ? answer : "The student haven't provided any answer yet.",
            slide_text_arr: slideTextArr,
            isStructured: true,
          });
          // console.log("time2")
          // console.log(Date.now() - startTime)
          console.log(response)
        } else {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const [retrieval, feedbackResponse] = await Promise.all([
            await handleRetrieve(),
            axios.post("/api/generate_feedback", {
              promptEngineering: selectedPromptEngineering,
              feedbackFramework: selectedFeedbackFramework,
              question: questionPreset.content || question,
              answer: isValidInput(answer) ? answer : "The student haven't provided any answer yet.",
            })
          ]);
          response = feedbackResponse
          retrievalResult = retrieval
        }

        const endTime = Date.now();
        // console.log(endTime - startTime)

        if (questionPreset) {
          // console.log(retrievalResult)
          const recordPayload: RecordResultInput = {
            learner_id: participantId || "unidentifiable_learner",
            // ip_address: "todo",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type: preferredInfoType === "vision" && reference?.image_text ? "vision" : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: retrievalResult?.slide_text_arr,
            reference_slide_page_number: retrievalResult?.reference?.page_number,
            reference_slide_content: preferredInfoType === "vision" && retrievalResult?.reference?.image_text ? retrievalResult?.reference?.image_text : reference?.text,
            reference_slide_id: retrievalResult?.reference?.slide_google_id, // to be updated
            submission_time: startTime,
            system_total_response_time: endTime - startTime
          };

          try {
            // TODO: record result to database to be updated
            // await recordResultToDatabase(recordPayload);
            // console.log("Successfully recorded result:", recordPayload);
          } catch (error) {
            console.error("Failed to record result:", error);
          }
        }
        setResult(response.data);
        console.log("Full response data:", response.data.structured_feedback);
        console.log("Grading:", response.data.score);
        setIsFeedbackLoading(false);
      } catch (error) {
        console.error("Error generating feedback:", error);
        setIsFeedbackLoading(false);
      }
    }
  };

  // const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
  //   if (event.keyCode === 13) {
  //     handleSubmit();
  //   }
  // };

  const closeDrawer = () => setIsDrawerOpen(false);

  const handleImageClick = (image: string, index: number) => {
    setEnlargedImage(image);
    setCurrentImageIndex(index);
  };

  const handlePrevious = () => {
    if (currentImageIndex > 0 && images) {
      setCurrentImageIndex(currentImageIndex - 1);
      setEnlargedImage(images[currentImageIndex - 1]);
    }
  };

  const handleNext = () => {
    if (currentImageIndex < (images?.length || 0) - 1 && images) {
      setCurrentImageIndex(currentImageIndex + 1);
      setEnlargedImage(images[currentImageIndex + 1]);
    }
  };

  return (
    <div className="">
      <ParticipantModal isOpen={!participantId && !!course_version} />

      {/* Drawer for Testing Area */}
      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />

      <div className="grid grid-cols-11 gap-2 h-full">
        {/* Left Feedback Area */}
        <motion.div
          className="col-span-6 space-y-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Feedback and Answer */}
          {(!course_version || course_version == "a" || course_version == "c" || course_version == "d") && (
              <HTMLFeedbackArea
                html={(result as StructuredFeedback).structured_feedback}
                isFeedbackLoading={isFeedbackLoading}
                score={(result as StructuredFeedback).score}
              />
          )}

          {(!course_version || course_version == "b" || course_version == "d") && (
            <ReferenceArea
              reference={reference}
              isReferenceLoading={isReferenceLoading}
              images={images}
              isImageLoading={isImageLoading}
              loadedCount={loadedCount}
              totalCount={totalCount}
              onImageClick={handleImageClick}
            />
          )}
        </motion.div>

        {/* Right Input Area */}
        <motion.div
          className="col-span-5 z-1"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sticky top-24 z-0">
            {/* Tabs Header */}
            {!question_id && (
              <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
                <button
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === "selection" 
                      ? "bg-white text-blue-600 shadow-sm" 
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  onClick={() => setActiveTab("selection")}
                >
                  Content Selection
                </button>
                <button
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === "input" 
                      ? "bg-white text-blue-600 shadow-sm" 
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  onClick={() => setActiveTab("input")}
                >
                  Question & Answer
                </button>
              </div>
            )}

            {/* Tab Content */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {activeTab === "selection" && (
                <div className="space-y-6">
                  {/* Course Selection */}
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-slate-800">Course Selection</h3>
                        <p className="text-xs text-slate-600">Choose the course you want to study</p>
                      </div>
                    </div>
                    <div className="relative">
                      <select 
                        value={course} 
                        onChange={(e) => setCourse(e.target.value)} 
                        className="w-full px-4 py-3 pr-10 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/90 backdrop-blur-sm appearance-none cursor-pointer hover:border-blue-400 hover:bg-white/95"
                      >
                        <option value="" className="text-slate-500">Choose a course...</option>
                        {courses.length && courses.map(course => (
                          <option key={course.course_id} value={course.course_id} className="py-2 px-3 hover:bg-blue-50">
                            {course.course_title}
                          </option>
                        ))}
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                        <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Modules Selection */}
                  {course && (
                    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="text-base font-semibold text-slate-800">Module Selection</h3>
                            <p className="text-xs text-slate-600">Select the modules you want to include</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="select-all-modules"
                            checked={module.length === availableModules.length}
                            onChange={(e) => setModule(e.target.checked ? availableModules.map((mod: Module) => mod.module_id) : [])}
                            className="w-4 h-4 text-emerald-600 border-emerald-300 rounded focus:ring-emerald-500 focus:ring-2 transition-all duration-200"
                          />
                          <label htmlFor="select-all-modules" className="text-sm text-emerald-700 font-medium cursor-pointer hover:text-emerald-800 transition-colors duration-200">
                            Select All
                          </label>
                        </div>
                      </div>
                      <div className="relative">
                        <select 
                          multiple 
                          value={module} 
                          onChange={(e) => setModule(Array.from(e.target.selectedOptions, option => option.value))} 
                          className="w-full px-4 py-3 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200 min-h-24 bg-white/90 backdrop-blur-sm appearance-none cursor-pointer hover:border-emerald-400 hover:bg-white/95"
                        >
                          {availableModules?.length && availableModules.map((mod: Module) => (
                            <option key={mod.module_id} value={mod.module_id} className="py-2 px-3 hover:bg-emerald-50 checked:bg-emerald-100">
                              {mod.module_title}
                            </option>
                          ))}
                        </select>
                      </div>
                      {module.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {module.map(moduleId => {
                            const selectedModule = availableModules.find(mod => mod.module_id === moduleId);
                            return selectedModule ? (
                              <span key={moduleId} className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 text-sm rounded-full border border-emerald-200">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                {selectedModule.module_title}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Slides Selection */}
                  {module.length > 0 && (
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-200 p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="text-base font-semibold text-slate-800">Slide Selection</h3>
                            <p className="text-xs text-slate-600">Choose the specific slides to study</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="select-all-slides"
                            checked={availableSlides.length > 0 && slide.length === availableSlides.length}
                            onChange={(e) => setSlide(e.target.checked ? availableSlides.map(sld => sld.id) : [])}
                            className="w-4 h-4 text-purple-600 border-purple-300 rounded focus:ring-purple-500 focus:ring-2 transition-all duration-200"
                          />
                          <label htmlFor="select-all-slides" className="text-sm text-purple-700 font-medium cursor-pointer hover:text-purple-800 transition-colors duration-200">
                            Select All
                          </label>
                        </div>
                      </div>
                      <div className="relative">
                        <select 
                          multiple 
                          value={slide.map(s => s)} 
                          onChange={(e) => setSlide(Array.from(e.target.selectedOptions, option => option.value))} 
                          className="w-full px-4 py-3 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 min-h-24 bg-white/90 backdrop-blur-sm appearance-none cursor-pointer hover:border-purple-400 hover:bg-white/95"
                        >
                          {availableSlides?.length && availableSlides.map((sld: Slide) => (
                            <option key={sld.id} value={sld.id} className="py-2 px-3 hover:bg-purple-50 checked:bg-purple-100">
                              {sld.slide_title}
                            </option>
                          ))}
                        </select>
                      </div>
                      {slide.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {slide.map(slideId => {
                            const selectedSlide = availableSlides.find(sld => sld.id === slideId);
                            return selectedSlide ? (
                              <span key={slideId} className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-700 text-sm rounded-full border border-purple-200">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                {selectedSlide.slide_title}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <button 
                    onClick={() => setActiveTab('input')} 
                    className="relative w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group"
                  >
                    {/* Subtle skewed background overlay on hover */}
                    {!isFeedbackLoading && !isImageLoading && !isReferenceLoading && (
                      <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-all duration-500 transform -skew-x-6 scale-x-0 group-hover:scale-x-100 origin-left"></div>
                    )}
                    
                    {/* Button content */}
                    <div className="relative z-10 flex items-center justify-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      Continue to Questions
                    </div>
                  </button>
                </div>
              )}

              {activeTab === "input" && (
                <div className="space-y-4">
                  {/* Question Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-semibold text-slate-800">Question</h3>
                      {!questionLoading && questionPreset?.content?.length > 0 && (
                        <button
                          onClick={() => setIsFullScreen(true)}
                          className="px-3 py-1 text-sm bg-emerald-100 text-emerald-700 rounded-full hover:bg-emerald-200 transition-colors duration-200"
                        >
                          View Full
                        </button>
                      )}
                    </div>
                    
                    {questionPreset?.content?.length > 0 ? (
                      !isFullScreen ? (
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                          <p className="text-sm text-slate-600">Preloaded question available</p>
                        </div>
                      ) : (
                        <div 
                          className="fixed z-50 bg-gradient-to-br from-slate-50 to-blue-50 overflow-auto" 
                          style={{ 
                            top: 'var(--header-height, 60px)', 
                            bottom: 'var(--footer-height, 60px)', 
                            left: 0, 
                            right: 0 
                          }}
                        >
                          {/* Header */}
                          <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm z-10">
                            <div className="flex items-center justify-between p-6">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center shadow-sm">
                                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                </div>
                                <div>
                                  <h2 className="text-xl font-bold text-slate-800">Question Details</h2>
                                  <p className="text-sm text-slate-600">Full question content and materials</p>
                                </div>
                              </div>
                              <button
                                onClick={() => setIsFullScreen(false)}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 transition-all duration-200 shadow-sm hover:shadow-md"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Close
                              </button>
                            </div>
                          </div>

                          {/* Content */}
                          <div className="w-full p-6 space-y-6">
                            {questionPreset.content.map((item, index) => (
                              <div key={index} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                {/* Block Counter */}
                                <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-6 py-3 border-b border-slate-200">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-600">
                                      Content Block {index + 1} of {questionPreset.content.length}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                      <span className="text-xs text-slate-500 uppercase tracking-wide">
                                        {item.type}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                
                                {item.type === "text" ? (
                                  <div className="p-8">
                                    <div className="prose prose-slate max-w-none">
                                      <p className="text-lg leading-relaxed text-slate-700">{item.content}</p>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-8">
                                    <div className="flex justify-center">
                                      <DynamicImage
                                        src={item.content}
                                        alt={`Question content ${index + 1}`}
                                        className="max-w-full h-auto rounded-xl shadow-lg border border-slate-200"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    ) : (
                      <ContentEditor
                        contents={question}
                        setContents={(newContent) => {
                          setQuestion(newContent);
                          if (!question_id) {
                            const textContent = newContent.find(item => item.type === 'text')?.content || '';
                            dispatch(saveDraftQuestion(textContent));
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* Answer Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-semibold text-slate-800">Your Answer</h3>
                      <p className="text-sm text-slate-500">{saveStatus}</p>
                    </div>
                    <textarea
                      value={answer}
                      onChange={handleAnswerChange}
                      placeholder="Enter your answer here..."
                      className="w-full px-3 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 resize-none min-h-32"
                      rows={1}
                      onInput={handleInputResize}
                    />
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={isFeedbackLoading || isImageLoading || isReferenceLoading}
                    className={`
                      relative w-full py-3 px-4 rounded-lg font-medium transition-all duration-300 overflow-hidden group
                      ${isFeedbackLoading || isImageLoading || isReferenceLoading 
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg hover:shadow-xl'
                      }
                    `}
                  >
                    {/* Subtle skewed background overlay on hover */}
                    {!isFeedbackLoading && !isImageLoading && !isReferenceLoading && (
                      <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-all duration-500 transform -skew-x-6 scale-x-0 group-hover:scale-x-100 origin-left"></div>
                    )}
                    
                    {/* Button content */}
                    <div className="relative z-10 flex items-center justify-center">
                      {isFeedbackLoading || isImageLoading || isReferenceLoading ? (
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Evaluating...</span>
                        </div>
                      ) : (
                        'Submit Answer'
                      )}
                    </div>
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* Global Image Modal */}
      {enlargedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 z-[999999] flex items-center justify-center p-4"
          style={{ position: 'fixed', top: '45px', left: 0, right: 0, bottom: 0 }}
          onClick={() => setEnlargedImage(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setEnlargedImage(null)}
              className="absolute -top-12 right-0 bg-white bg-opacity-90 p-2 rounded-full shadow-lg hover:bg-opacity-100 transition-all duration-200 z-10"
            >
              <X className="w-5 h-5 text-slate-700" />
            </button>

            {/* Navigation Buttons */}
            {currentImageIndex > 0 && (
              <button
                onClick={handlePrevious}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-white bg-opacity-90 p-3 rounded-full shadow-lg hover:bg-opacity-100 transition-all duration-200 z-10"
              >
                <ChevronLeft className="w-5 h-5 text-slate-700" />
              </button>
            )}
            
            {currentImageIndex < (images?.length || 0) - 1 && (
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-white bg-opacity-90 p-3 rounded-full shadow-lg hover:bg-opacity-100 transition-all duration-200 z-10"
              >
                <ChevronRight className="w-5 h-5 text-slate-700" />
              </button>
            )}

            {/* Image */}
            <DynamicImage
              src={`data:image/png;base64,${enlargedImage}`}
              alt={`Slide ${currentImageIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeChildren />
    </Suspense>
  )
}
