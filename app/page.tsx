"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import TestDrawer from './components/TestDrawer';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Scrollbar, A11y } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import 'swiper/css/scrollbar';

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


export default function Home() {
  const base_question = "What are pitfalls of E-Learning Design Principles & Methods about?"
  const base_wrong_answer = "Learning is about engineering."
  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true); // Drawer state
  const [question, setQuestion] = useState(base_question); // For Question Input
  const [answer, setAnswer] = useState(base_wrong_answer); // For Answer Input
  const [result, setResult] = useState(""); // For Result Display
  const [reference, setReference] = useState<Reference>(); // For Reference Display
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [images, setImages] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(-1);
  const [loadedCount, setLoadedCount] = useState(-1);
  const [activeTab, setActiveTab] = useState("selection"); // Track active tab

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

  const [selectedPromptEngineering, setSelectedPromptEngineering] = useState<string>("zero");
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] = useState<string>("none");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();  // Course Selection
  const [courses, setCourses] = useState<Course[]>([]);  // Courses List View
  const [module, setModule] = useState<string[]>([]); // Multi-select modules
  const [slide, setSlide] = useState<string[]>([]);   // Multi-select slides
  
  const [availableModules, setAvailableModules] = useState<Module[]>([]);  // Modules for the selected course
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);    // Slides for the selected modules

  const [preferredInfoType, setPreferredInfoType] = useState<string>("text");

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
        }
      );
      console.log("IMGAES")
      console.log(response.data)
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
          question: question,
          slideIds: slide,
          preferredInfoType: preferredInfoType
        }
      );
      setReference(response.data.result[0]);
      if (preferredInfoType == "vision" && response.data.result[0].image_text) {
        setReference({
          ...response.data.result[0],
          display: response.data.result[0].image_text
        })
      } else if (response.data.result[0].text) {
        setReference({
          ...response.data.result[0],
          display: response.data.result[0].text
        })
      } else {
        setReference({
          ...response.data.result[0],
          display: "EMPTY REFERENCE"
        })
      }
      setSlideTextArr(response.data.result.map((item: Reference) => {
        if (preferredInfoType == "vision" && item.image_text) {
          return item.image_text;
        } else if (item.text) {
          return item.text;
        } else {
          alert(`${item.slide_title} unpublished!`)
        }
      }));
      // setSlideTextArr(response.data.result.map((item: { text: string }) => item.text)); // TODO: Adjustable
      console.log("REFERENCE")
      console.log(response.data.result)
      let temp: string[] = [];
      const page_number = response.data.result[0].page_number;
      // const startPage = Math.max(0, page_number - 2); // Ensure page number doesn't go below 0
      // const endPage = page_number + 2;
      // setTotalCount(endPage - startPage + 1);
      const startPage = page_number;
      const endPage = page_number;
      setTotalCount(endPage - startPage + 1);
      setLoadedCount(0);

      // Fetch the images for the current page and its surrounding pages
      for (let i = startPage; i <= endPage; i++) {
        const image: string | null = await handlePdfImage(i, response.data.result[0].slide_id); // Await here to ensure it processes in order
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

    } catch (error) {
      console.error("Error fetching the result:", error);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
    }
  }

  const handleSubmit = async () => {
    if (!question) return;
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);
    try {
      let response;
      if (selectedPromptEngineering === "rag_zero" ||
        selectedPromptEngineering === "rag_few" ||
        selectedPromptEngineering === "rag_cot" ||
        selectedPromptEngineering === "graph_rag"
      ) {
        handleRetrieve();
        response = await axios.post("/api/generate_feedback_rag", {
          promptEngineering: selectedPromptEngineering,
          feedbackFramework: selectedFeedbackFramework,
          question,
          answer,
          slide_text_arr: slideTextArr
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const [_, feedbackResponse] = await Promise.all([
          handleRetrieve(),
          axios.post("/api/generate_feedback", {
            promptEngineering: selectedPromptEngineering,
            feedbackFramework: selectedFeedbackFramework,
            question,
            answer,
          })
        ]);
        response = feedbackResponse
      }
      console.log(response);
      setResult(response.data.feedback);
      setIsFeedbackLoading(false);
    } catch (error) {
      console.error("Error generating feedback:", error);
      setIsFeedbackLoading(false);
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
      {/* Drawer for Testing Area */}
      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />

      <div className="grid grid-cols-10 gap-4 w-full">
        {/* Left Feedback Area */}
        <motion.div
          className="col-span-7 flex flex-col w-full"
          initial={{ opacity: 0, y: 50 }} // 初始位置
          animate={{ opacity: 1, y: 0 }} // 最终状态
          transition={{ duration: 0.8 }} // 动画持续时间
        >

          {/* Slide Page Images with Swiper */}
          <motion.div
            className="mb-4 p-4 bg-gray-100 rounded-lg shadow-md h-[30vw] w-full flex justify-center items-center overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: imageSrc ? 1 : 0.5 }}
            transition={{ duration: 0.8 }}
          >
            {imageSrc && !isImageLoading ? (
              <Swiper
                // install Swiper modules
                modules={[Navigation, Pagination, Scrollbar, A11y]}
                spaceBetween={50}
                centeredSlides={true}
                slidesPerView={3}
                navigation
                pagination={{ clickable: true }}
                initialSlide={Math.floor(totalCount / 2)}
                loop={true}
                onSwiper={(swiper) => console.log(swiper)}
                onSlideChange={(swiper) => {
                  // To apply effects on the middle slide
                  const allSlides = swiper.slides;
                  allSlides.forEach((slide, index) => {
                    // Scale the current center slide and reset the others
                    if (index === swiper.activeIndex) {
                      slide.style.transform = "scale(2.4)"; // Enlarge the active slide
                      slide.style.zIndex = "999";
                      slide.style.opacity = "1";
                      slide.style.transition = "transform 0.5s ease, opacity 0.5s ease";
                    } else {
                      slide.style.transform = "scale(1)";
                      slide.style.opacity = "0.8";
                      slide.style.zIndex = "1";
                      slide.style.transition = "transform 0.5s ease, opacity 0.5s ease";
                    }
                  });
                }}
                style={{ overflow: "visible", width: "70vw", padding: "2vw" }}
              >
                {images?.map((src, index) => (
                  <SwiperSlide key={index}>
                    <div className="flex justify-center items-center">
                      <motion.img
                        src={`data:image/png;base64,${src}`}
                        alt={`PDF Page ${index}`}
                        className="w-auto h-[90%] rounded-lg shadow-md mb-4"
                        initial={{ scale: 0.8 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>
            ) : (
              <motion.p>
                {isImageLoading ? `Loading images...${totalCount>-1 ? `${loadedCount}/${totalCount}` : ``}` : "No images available"}
              </motion.p>
            )}
          </motion.div>

          {/* Feedback and Answer */}
          <motion.div
            className="p-4 bg-gray-100 rounded-lg shadow-md w-full"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            {/* AI Feedback */}
            <motion.div className="mb-4">
              <h3 className="text-xl font-semibold">Feedback:</h3>
              {result && !isFeedbackLoading ? (
                <p>{result}</p>
              ) : (
                <p>{isFeedbackLoading ? "Loading feedback..." : "No feedback yet"}</p>
              )}
            </motion.div>

            {/* Reference Display */}
            <motion.div className="mt-4">
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
          </motion.div>
        </motion.div>
        {/* Right Input Area */}
        <motion.div
          className="col-span-3 w-full p-4 bg-white rounded-lg shadow-md"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Tabs Header */}
          <div className="w-full flex justify-center mb-4">
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
          </div>

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
                <div className="mb-4">
                  <p className="mr-2">Please select preferred information type:</p>
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

                <div className="mb-4">
                  <label htmlFor="prompt-engineering" className="mr-2">Please select one way of prompt engineering:</label>
                  <select
                    id="prompt-engineering"
                    value={selectedPromptEngineering}
                    onChange={(e) => setSelectedPromptEngineering(e.target.value)}
                    className="border rounded p-2"
                  >
                    {/* <option value="">Select...</option> */}
                    <option value="zero">Zero</option>
                    <option value="few">Few</option>
                    <option value="rag_zero">RAG Zero</option>
                    <option value="rag_few">RAG Few</option>
                    <option value="rag_cot">RAG CoT</option>
                    <option value="graph_rag">Graph RAG</option>
                  </select>
                </div>

                <div className="mb-4">
                  <label htmlFor="feedback-framework" className="mr-2">Please select a framework of feedback:</label>
                  <select
                    id="feedback-framework"
                    value={selectedFeedbackFramework}
                    onChange={(e) => setSelectedFeedbackFramework(e.target.value)}
                    className="border rounded p-2"
                  >
                    {/* <option value="">Select...</option> */}
                    <option value="none">None</option>
                    <option value="component">Component</option>
                    <option value="feature">Feature</option>
                  </select>
                </div>

                <motion.div className="mt-4">
                  <h3 className="text-l font-semibold">Question</h3>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Enter your question"
                    className="border rounded p-2 w-full resize-none min-h-32"
                    rows={1}
                    onInput={handleInputResize}
                  />
                </motion.div>

                <motion.div className="mt-4">
                  <h3 className="text-l font-semibold">Answer</h3>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Enter your answer"
                    className="border rounded p-2 w-full resize-none min-h-32"
                    rows={1}
                    onInput={handleInputResize}
                  />
                </motion.div>

                <motion.button
                  onClick={handleSubmit}
                  className="mt-4 w-full p-2 bg-blue-500 text-white rounded-lg"
                  whileHover={{
                    scale: 1.05,
                    backgroundColor: "#1d40ae",
                    color: "#fff"
                  }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  Submit
                </motion.button>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}
