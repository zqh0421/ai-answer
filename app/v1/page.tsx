"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { useSearchParams } from 'next/navigation';
import { debounce } from 'lodash';
import { useSelector, useDispatch } from 'react-redux';

import { RootState, AppDispatch } from '@/app/store/store';
import { saveAnswer, saveDraftAnswer, saveDraftQuestion } from '@/app/slices/userSlice';
import { Question, QuestionContent } from "@/app/manage/question/page";
import { Reference, Course, Module, Slide, RecordResultInput } from "@/app/types";

import TestDrawer from '@/app/components/v1/TestDrawer';
import DynamicImage from "@/app/components/v1/DynamicImage";
import ParticipantModal from '@/app/components/v1/ParticipantModal';
import ContentEditor from "@/app/components/v1/ContentEditor";
import FeedbackArea from "@/app/components/v1/FeedbackArea";
import ReferenceArea from "@/app/components/v1/ReferenceArea";

function HomeChildren() {
  const base_question = ""
  // const base_question = "What are pitfalls of E-Learning Design Principles & Methods about?"
  // const base_wrong_answer = ""
  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true); // Drawer state
  // const [question, setQuestion] = useState<QuestionContent[]>([
  //   { type: "text", content: base_question },
  // ]);
  const [result, setResult] = useState(""); // For Result Display
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
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
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
          await recordResultToDatabase(recordPayload);
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
            isStructured: false
          });
          // console.log("time2")
          // console.log(Date.now() - startTime)
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
            await recordResultToDatabase(recordPayload);
            // console.log("Successfully recorded result:", recordPayload);
          } catch (error) {
            console.error("Failed to record result:", error);
          }
        }

        setResult(response.data.feedback);
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

  return (
    <main className="flex flex-col items-center justify-between">
      <ParticipantModal isOpen={!participantId && !!course_version} />

      {/* Drawer for Testing Area */}
      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />

      <div className="grid grid-cols-11 gap-4 w-full">
        {/* Left Feedback Area */}
        <motion.div
          className="col-span-7 flex flex-col w-full"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          {/* Feedback and Answer */}
          {(!course_version || course_version == "a" || course_version == "c" || course_version == "d") &&
            <FeedbackArea
              result={result}
              isFeedbackLoading={isFeedbackLoading}
            />
          }

          {(!course_version || course_version == "b" || course_version == "d") &&
            <ReferenceArea
              reference={reference}
              isReferenceLoading={isReferenceLoading}
              images={images}
              isImageLoading={isImageLoading}
              loadedCount={loadedCount}
              totalCount={totalCount}
            />
          }

        </motion.div>
        {/* Right Input Area */}
        <motion.div
          className="col-span-4 w-full p-4 bg-white rounded-lg shadow-md"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Tabs Header */}
          {!question_id && (<div className="w-full flex justify-center mb-4">
            <button
              className={`px-4 py-2 border-b-2 ${activeTab === "selection" ? "border-blue-500" : "border-transparent"}`}
              onClick={() => setActiveTab("selection")}
            >
              Content
            </button>
            <button
              className={`px-4 py-2 border-b-2 ${activeTab === "input" ? "border-blue-500" : "border-transparent"}`}
              onClick={() => setActiveTab("input")}
            >
              Retrieval
            </button>
          </div>)}

          {/* Tab Content */}
          <motion.div>
            {activeTab === "selection" && (
              <motion.div>
                <div className="mb-4 flex flex-col">
                  <label htmlFor="course-select" className="mr-2">Select Course:</label>
                  <select id="course-select" value={course} onChange={(e) => setCourse(e.target.value)} className="border rounded p-2">
                    <option value="">Select a course</option>
                    {courses.length && courses.map(course => (
                      <option key={course.course_id} value={course.course_id}>{course.course_title}</option>
                    ))}
                  </select>
                </div>

                {/* Modules Selection */}
                {course && <div className="mb-4 flex flex-col">
                  <div className="mb-4 flex justify-between items-center">
                    <label htmlFor="module-select" className="mr-2">Select Modules:</label>
                    {/* Checkbox for selecting all modules */}
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="select-all-modules"
                        checked={module.length === availableModules.length} // 默认全选
                        onChange={(e) => setModule(e.target.checked ? availableModules.map((mod: Module) => mod.module_id) : [])}
                        className="mr-2"
                      />
                      <label htmlFor="select-all-modules" className="text-blue-500">Select All</label>
                    </div>
                  </div>
                  <select multiple id="module-select" value={module} onChange={(e) => setModule(Array.from(e.target.selectedOptions, option => option.value))} className="border rounded p-2">
                    {availableModules?.length && availableModules.map((mod: Module) => (
                      <option key={mod.module_id} value={mod.module_id}>{mod.module_title}</option>
                    ))}
                  </select>
                </div>}

                {/* Slides Selection */}
                {module.length > 0 && (
                  <div className="mb-4 flex flex-col">
                    <div className="mb-4 flex justify-between items-center">
                      <label htmlFor="slide-select" className="mr-2">Select Slides:</label>
                      {/* Checkbox for selecting all slides */}
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="select-all-slides"
                          checked={availableSlides.length > 0 && slide.length === availableSlides.length} // 确保availableSlides加载完成
                          onChange={(e) => setSlide(e.target.checked ? availableSlides.map(sld => sld.id) : [])}
                          className="mr-2"
                        />
                        <label htmlFor="select-all-slides" className="text-blue-500">Select All</label>
                      </div>
                    </div>
                    <select multiple id="slide-select" value={slide.map(s => s)} onChange={(e) => setSlide(Array.from(e.target.selectedOptions, option => option.value))} className="border rounded p-2">
                      {availableSlides?.length && availableSlides.map((sld: Slide) => (
                        <option key={sld.id} value={sld.id}>{sld.slide_title}</option>
                      ))}
                    </select>
                  </div>)
                }

                <motion.button onClick={() => setActiveTab('input')} className="mt-4 w-full p-2 bg-blue-500 text-white rounded-lg">
                  Next Session
                </motion.button>
              </motion.div>
            )}

            {activeTab === "input" && (
              <motion.div>
                {/* Question Section */}
                <motion.div className="mt-4">
                  <div className="flex flex-row justify-between">
                    <h3 className="text-l font-semibold">Question</h3>
                    {!questionLoading && questionPreset?.content?.length > 0 ? (
                      <button
                        onClick={() => setIsFullScreen(true)}
                        className="mb-4 px-2 text-white bg-green-600 hover:bg-green-700 rounded-sm"
                      >
                        View
                      </button>
                    ) : null}
                  </div>
                  {questionPreset?.content?.length > 0 ? (
                    !isFullScreen ? (
                      <div>
                        <p className="text-gray-500 text-sm">Preloaded question available.</p>
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
                        <div className="max-w-4xl mx-auto p-6 space-y-6">
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
                                  <div className="flex items-center gap-3 mb-4">
                                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    </div>
                                    <h3 className="text-lg font-semibold text-slate-800">Question Text</h3>
                                  </div>
                                  <div className="prose prose-slate max-w-none">
                                    <p className="text-lg leading-relaxed text-slate-700">{item.content}</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-6">
                                  <div className="flex items-center gap-3 mb-4">
                                    <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
                                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                    </div>
                                    <h3 className="text-lg font-semibold text-slate-800">Question Image</h3>
                                  </div>
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
                      setContents={(newContent: QuestionContent[] | ((prevState: QuestionContent[]) => QuestionContent[])) => {
                        setQuestion(newContent);
                        if (!question_id) {
                          const contentArray = typeof newContent === 'function' ? newContent(question) : newContent;
                          const textContent = contentArray.find((item: QuestionContent) => item.type === 'text')?.content || '';
                          dispatch(saveDraftQuestion(textContent));
                        }
                      }}
                    />
                  )}
                </motion.div>

                {/* Answer Section */}
                <motion.div className="mt-4">
                  <h3 className="text-l font-semibold">Answer</h3>
                  <textarea
                    value={answer}
                    onChange={handleAnswerChange}
                    placeholder="Enter your answer"
                    className="border rounded p-2 w-full resize-none min-h-32"
                    rows={1}
                    onInput={handleInputResize}
                  />
                  <p className="text-gray-500 text-sm mt-1">{saveStatus}</p>
                </motion.div>
                <button
                  onClick={handleSubmit}
                  className={`
        mt-4 w-full p-2 text-white rounded-lg transition-transform duration-200
        ${isFeedbackLoading || isImageLoading || isReferenceLoading ? 'bg-gray-500 cursor-not-allowed' : 'bg-blue-500 hover:bg-[#1d40ae] hover:scale-105 active:scale-95'}
      `}
                  disabled={isFeedbackLoading || isImageLoading || isReferenceLoading}
                >
                  {isFeedbackLoading || isImageLoading || isReferenceLoading ? 'Evaluating ...' : 'Submit'}
                </button>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeChildren />
    </Suspense>
  )
}
