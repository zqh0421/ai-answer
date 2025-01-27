"use client";

import { useState, useEffect, Suspense } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import TestDrawer from './components/TestDrawer';
// import { Swiper, SwiperSlide } from 'swiper/react';
// import { Navigation, Pagination, Scrollbar, A11y } from 'swiper/modules';
// import 'swiper/css';
// import 'swiper/css/navigation';
// import 'swiper/css/pagination';
// import 'swiper/css/scrollbar';
import { useSearchParams } from 'next/navigation';
import { Question, QuestionContent } from "./manage/question/page";
import DynamicImage from "./components/DynamicImage";


import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '@/app/store/store';
import { saveAnswer } from '@/app/slices/userSlice';
import ParticipantModal from '@/app/components/ParticipantModal';

interface Course {
  course_id: string;
  course_title: string;
}

interface Module {
  module_id: string;
  module_title: string;
  module_order: number;
  course_id: string;
  created_at: string;
}

export interface Slide {
  id: string;
  slide_title: string;
}

interface Reference {
  text: string;
  image_text: string;
  page_number: number;
  slide_google_id: string;
  slide_title: string;
  display: string;
}

function HomeChildren() {
  const base_question = "What are pitfalls of E-Learning Design Principles & Methods about?"
  // const base_wrong_answer = ""
  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true); // Drawer state
  const [question, setQuestion] = useState<QuestionContent[]>([
    { type: "text", content: base_question },
  ]);
  const [result, setResult] = useState(""); // For Result Display
  const [reference, setReference] = useState<Reference>(); // For Reference Display
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [images, setImages] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(-1);
  const [loadedCount, setLoadedCount] = useState(-1);
  const [activeTab, setActiveTab] = useState("input"); // Track active tab

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

  const [selectedPromptEngineering, setSelectedPromptEngineering] = useState<string>("rag_few");
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] = useState<string>("none");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();  // Course Selection
  const [courses, setCourses] = useState<Course[]>([]);  // Courses List View
  const [module, setModule] = useState<string[]>([]); // Multi-select modules
  const [slide, setSlide] = useState<string[]>([]);   // Multi-select slides
  
  const [availableModules, setAvailableModules] = useState<Module[]>([]);  // Modules for the selected course
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);    // Slides for the selected modules

  const [preferredInfoType, setPreferredInfoType] = useState<string>("vision");
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

  const answers = useSelector((state: RootState) => state.user.answers);
  const participantId = useSelector((state: RootState) => state.user.participantId);
  const [answer, setAnswer] = useState(answers[question_id || ''] || ''); // For Answer Input
  const dispatch = useDispatch<AppDispatch>();

  const handleSaveAnswer = (temp_answer: string) => {
    if (question_id) {
      dispatch(saveAnswer({ questionId: question_id, answer: temp_answer }));
    }
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
          console.log(res.data)
          // no display input box question
        })
        .catch((err) => {
          console.error("Error fetching question:", err);
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
      setImageSrc(response.data.img_base64);
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
      const response = await axios.post(
        "/api/embed",
        {
          question_id,
          question: questionPreset.content || question, // TODO: revise for content editor
          slideIds: slide,
          preferredInfoType: preferredInfoType
        }
      );
      const res = JSON.parse(response.data).result
      setReference(res[0]);
      if (preferredInfoType == "vision" && res[0].image_text) {
        setReference({
          ...res[0],
          display: res[0].image_text
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

  type RecordResultInput = {
    learner_id: string
    ip_address?: string,
    question_id: string,
    answer: string,
    feedback: string,
    prompt_engineering_method: string,
    preferred_info_type: string,
    feedback_framework: string,
    slide_retrieval_range?: string[],
    reference_slide_page_number?: number,
    reference_slide_content?: string,
    reference_slide_id?: string,
    system_total_response_time?: number,
    submission_time?: number,
  }

  const recordResultToDatabase = async (result: RecordResultInput) => {
    try {
      await axios.post("/api/record_result", result, {
        timeout: 60000
      });
      console.log("Successfully recorded result to db:", result);
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
      // retrieve human feedback here
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
            slide_text_arr: slideTextArr
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
        console.log(endTime - startTime)
        if (questionPreset) {
          console.log(retrievalResult)
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
            console.log("Successfully recorded result:", recordPayload);
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
      <ParticipantModal isOpen={!participantId} />

      {/* Drawer for Testing Area */}
      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />

      <div className="grid grid-cols-11 gap-4 w-full">
        {/* Left Feedback Area */}
        <motion.div
          className="col-span-7 flex flex-col w-full"
          initial={{ opacity: 0, y: 50 }} // 初始位置
          animate={{ opacity: 1, y: 0 }} // 最终状态
          transition={{ duration: 0.8 }} // 动画持续时间
        >

        {(course_version=="b" || course_version=="d") && <motion.div
          className="mb-4 p-4 bg-gray-100 rounded-lg shadow-md h-[30vw] w-full flex justify-center items-center overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: imageSrc ? 1 : 0.5 }}
          transition={{ duration: 0.8 }}
        >
          {imageSrc && !isImageLoading ? (
            <div
              className="flex space-x-4 overflow-x-scroll w-[70vw] p-4"
              style={{ scrollBehavior: "smooth" }}
            >
              {images?.map((src, index) => (
                <div
                  key={index}
                  className="flex-shrink-0 flex justify-center items-center max-w-[90%]"
                >
                  <DynamicImage
                    src={`data:image/png;base64,${src}`}
                    alt={`PDF Page ${index}`}
                    className="w-auto h-[90%] rounded-lg shadow-md mb-4"
                    maxWidth={200}
                  />
                </div>
              ))}
            </div>
          ) : (
            <motion.p>
              {isImageLoading
                ? `Loading images...${totalCount > -1 ? `${loadedCount}/${totalCount}` : ``}`
                : "No images available"}
            </motion.p>
          )}
        </motion.div>}

          {/* Feedback and Answer */}
          <motion.div
            className="p-4 bg-gray-100 rounded-lg shadow-md w-full"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            {/* AI Feedback */}
            {(course_version=="a" || course_version=="c" || course_version=="d") && <motion.div className="mb-4">
              <h3 className="text-xl font-semibold">Feedback:</h3>
              {result && !isFeedbackLoading ? (
                <p>{result}</p>
              ) : (
                <p>{isFeedbackLoading ? "Loading feedback..." : "No feedback yet"}</p>
              )}
            </motion.div>}

            {/* Reference Display */}
            {(course_version=="b" || course_version=="d") && <motion.div className="mt-4">
              <h3 className="text-xl font-semibold">Reference:</h3>
              {reference && !isReferenceLoading ? (
                <div>
                  <p>{
                    reference.display
                  } (page {reference.page_number + 1})</p>
                  <p>For full slide:
                    <a href={`https://docs.google.com/presentation/d/${reference.slide_google_id}/edit?usp=sharing`} target="_blank" className="text-blue-500">
                      {reference.slide_title}
                    </a>
                  </p>
                </div>
              ) : (
                <p>{isReferenceLoading ? "Loading reference..." : "No reference available"}</p>
              )}
            </motion.div>
            }
          </motion.div>
        </motion.div>
        {/* Right Input Area */}
        <motion.div
          className="col-span-4 w-full p-4 bg-white rounded-lg shadow-md"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Tabs Header */}
          {/* <div className="w-full flex justify-center mb-4">
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
          </div> */}

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
    {/* Collapsible Card for Settings */}
    <div className="mb-4 border rounded-lg shadow-md bg-white overflow-hidden">
      <div
        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        className="cursor-pointer p-2 bg-gray-100 flex justify-between items-center"
      >
        <h3 className="font-semibold text-sm">Settings</h3>
        <span className={`transform transition-transform duration-300 ${isSettingsOpen ? "rotate-180" : "rotate-0"}`}>
          ▼
        </span>
      </div>
      {isSettingsOpen && (
        <div className="p-4 space-y-4">
          <div>
            <p className="mb-2">Please select preferred information type:</p>
            <label className="mr-4">
              <input
                type="radio"
                name="infoType"
                value="text"
                checked={preferredInfoType === "text"}
                onChange={(e) => setPreferredInfoType(e.target.value)}
              />
              Text
            </label>
            <label>
              <input
                type="radio"
                name="infoType"
                value="vision"
                checked={preferredInfoType === "vision"}
                onChange={(e) => setPreferredInfoType(e.target.value)}
              />
              Vision
            </label>
          </div>

          <div>
            <label htmlFor="prompt-engineering" className="mb-2 block">
              Please select one way of prompt engineering:
            </label>
            <select
              id="prompt-engineering"
              value={selectedPromptEngineering}
              onChange={(e) => setSelectedPromptEngineering(e.target.value)}
              className="border rounded p-2 w-full"
            >
              <option value="zero">Zero</option>
              <option value="few">Few</option>
              <option value="rag_zero">RAG Zero</option>
              <option value="rag_few">RAG Few</option>
              <option value="rag_cot">RAG CoT</option>
            </select>
          </div>

          <div>
            <label htmlFor="feedback-framework" className="mb-2 block">
              Please select a framework of feedback:
            </label>
            <select
              id="feedback-framework"
              value={selectedFeedbackFramework}
              onChange={(e) => setSelectedFeedbackFramework(e.target.value)}
              className="border rounded p-2 w-full"
            >
              <option value="none">None</option>
              <option value="component">Component</option>
              <option value="feature">Feature</option>
            </select>
          </div>
        </div>
      )}
    </div>

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
          <div className="fixed inset-0 z-50 bg-white p-6 overflow-auto">
            <button
              onClick={() => setIsFullScreen(false)}
              className="py-2 px-4 text-white bg-red-600 hover:bg-red-700 rounded-md absolute top-4 right-4"
            >
              Close Full-Screen
            </button>
            {questionPreset.content.map((item, index) => (
              <div key={index} className="mb-4">
                {item.type === "text" ? (
                  <p className="text-lg">{item.content}</p>
                ) : (
                  <DynamicImage
                    src={item.content}
                    alt={`Content ${index}`}
                    className="max-w-full h-auto rounded-lg"
                  />
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <textarea
          value={question[0].content}
          onChange={(e) => setQuestion([{ type: "text", content: e.target.value }])}
          placeholder="Enter your question"
          className="border rounded p-2 w-full resize-none min-h-32"
          rows={1}
          onInput={handleInputResize}
        />
      )}
    </motion.div>

    {/* Answer Section */}
    <motion.div className="mt-4">
      <h3 className="text-l font-semibold">Answer</h3>
      <textarea
        value={answer}
        onChange={(e) => {
          setAnswer(e.target.value)
          handleSaveAnswer(e.target.value)
        }}
        placeholder="Enter your answer"
        className="border rounded p-2 w-full resize-none min-h-32"
        rows={1}
        onInput={handleInputResize}
      />
    </motion.div>

    <motion.button
      onClick={handleSubmit}
      className={`
        mt-4 w-full p-2  text-white rounded-lg
        ${isFeedbackLoading || isImageLoading || isReferenceLoading ? 'bg-gray-500' : 'bg-blue-500'}
      `}
      whileHover={{
        scale: `${isFeedbackLoading || isImageLoading || isReferenceLoading ? 1.00 : 1.05 }`,
        backgroundColor: `${isFeedbackLoading || isImageLoading || isReferenceLoading ? '#ccc' : "#1d40ae"}`,
        color: "#fff",
      }}
      whileTap={{ scale: `${isFeedbackLoading || isImageLoading || isReferenceLoading ? 1.00 : 0.95 }`, }}
      transition={{ duration: 0.2 }}
      // disabled={isFeedbackLoading || isImageLoading || isReferenceLoading}
    >
      {isFeedbackLoading || isImageLoading || isReferenceLoading ? 'Evaluating ...' : 'Submit'}
    </motion.button>
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
