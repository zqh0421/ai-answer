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

interface Reference {
  content: string,
  page_number: number
}

export default function Home() {
  const base_question = "What is Learning Objectives of E-Learning Design Principles & Methods about?"
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

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

  const [selectedPromptEngineering, setSelectedPromptEngineering] = useState<string>("");
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] = useState<string>("");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);


  const handlePdfImage = async (page_number: number) => {
    try {
      const response = await axios.post(
        "/api/pdf-to-image",
        {
          page: page_number
        },
        {
          responseType: 'blob'
        }
      );
      const imageBlob = response.data;
      const imageUrl = URL.createObjectURL(imageBlob);
      setImageSrc(imageUrl);
      return imageUrl;
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
          answer: question,
          result: question
          // answer: answer,
          // result: result
        }
      );
      setReference(response.data.result[0]);
      setSlideTextArr(response.data.result.map(item => item.content));

      let temp: string[] = [];
      const page_number = response.data.result[0].page_number;
      const startPage = Math.max(0, page_number - 2); // Ensure page number doesn't go below 0
      const endPage = page_number + 2;
      setTotalCount(endPage - startPage + 1);
      setLoadedCount(0);

      // Fetch the images for the current page and its surrounding pages
      for (let i = startPage; i <= endPage; i++) {
        const image: string | null = await handlePdfImage(i); // Await here to ensure it processes in order
        if (image !== null) {
          setLoadedCount(prevCount => prevCount + 1);
          temp = [...temp, image];
        }
      }

      // Set all fetched images to the state
      setImages(temp);
      setIsImageLoading(false);
      
      console.log("images" + temp)
      setIsReferenceLoading(false);

    } catch (error) {
      console.error("Error fetching the result:", error);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
    }
  }

  // useEffect(() => {
  //   if (result) {
  //     handleRetrieve();
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [result]);

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
        await handleRetrieve();
        response = await axios.post("/api/generate_feedback_rag", {
          promptEngineering: selectedPromptEngineering,
          feedbackFramework: selectedFeedbackFramework,
          question,
          answer,
          slide_text_arr: slideTextArr
        });
      } else {
        await handleRetrieve();
        response = await axios.post("/api/generate_feedback", {
          promptEngineering: selectedPromptEngineering,
          feedbackFramework: selectedFeedbackFramework,
          question,
          answer,
        });
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

      <div className="grid grid-cols-4 gap-4">
        {/* 左侧 Feedback Area */}
        <motion.div
          className="col-span-3 flex flex-col"
          initial={{ opacity: 0, y: 50 }} // 初始位置
          animate={{ opacity: 1, y: 0 }} // 最终状态
          transition={{ duration: 0.8 }} // 动画持续时间
        >

          {/* Slide Page Images with Swiper */}
          <motion.div
            className="mb-4 p-4 bg-gray-100 rounded-lg shadow-md h-[30vw] w-[60vw] flex justify-center items-center overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: imageSrc ? 1 : 0.5 }}
            transition={{ duration: 0.8 }}
          >
            {images?.length > 0 && !isImageLoading ? (
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
                      slide.style.transform = "scale(1.8)"; // Enlarge the active slide
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
                style={{ overflow: "visible", width: "60vw", padding: "2vw" }}
              >
                {images?.map((src, index) => (
                  <SwiperSlide key={index}>
                    <div className="flex justify-center items-center">
                      <motion.img
                        src={src}
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
            className="p-4 bg-gray-100 rounded-lg shadow-md w-[60vw]"
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
                  <p>{reference.content} (page {reference.page_number})</p>
                  <p>For full slide: <a href="https://docs.google.com/presentation/d/15iFGnOZ9pp1UF7kPIcL6nY1MdS-YzXQ6wqgWzxugSXM/edit?usp=sharing" target="_blank" className="text-blue-500">E-Learning Overview</a></p>
                </div>
              ) : (
                <p>{isReferenceLoading ? "Loading reference..." : "No reference available"}</p>
              )}
            </motion.div>
          </motion.div>
        </motion.div>

        {/* 右侧 User Input Area */}
        <motion.div
          className="col-span-1 p-4 bg-white rounded-lg shadow-md"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Dropdown 1: Prompt Engineering */}
          <div className="mb-4">
            <label htmlFor="prompt-engineering" className="mr-2">Please select one way of prompt engineering:</label>
            <select
              id="prompt-engineering"
              value={selectedPromptEngineering}
              onChange={(e) => setSelectedPromptEngineering(e.target.value)}
              className="border rounded p-2"
            >
              <option value="">Select...</option>
              <option value="zero">Zero</option>
              <option value="few">Few</option>
              <option value="rag_zero">RAG Zero</option>
              <option value="rag_few">RAG Few</option>
              <option value="rag_cot">RAG CoT</option>
              <option value="graph_rag">Graph RAG</option>
            </select>
          </div>

          {/* Dropdown 2: Feedback Framework */}
          <div className="mb-4">
            <label htmlFor="feedback-framework" className="mr-2">Please select a framework of feedback:</label>
            <select
              id="feedback-framework"
              value={selectedFeedbackFramework}
              onChange={(e) => setSelectedFeedbackFramework(e.target.value)}
              className="border rounded p-2"
            >
              <option value="">Select...</option>
              <option value="none">None</option>
              <option value="component">Component</option>
              <option value="feature">Feature</option>
            </select>
          </div>
          {/* Question Input Area */}
          <motion.div className="mt-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            <h3 className="text-l font-semibold">Question</h3> {/* Question 标题 */}
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Enter your question"
              className="border rounded p-2 w-full resize-none min-h-32"
              rows={1}
              onInput={handleInputResize}
            />
          </motion.div>

          {/* Answer Input Area */}
          <motion.div className="mt-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            <h3 className="text-l font-semibold">Answer</h3> {/* Answer 标题 */}
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Enter your answer"
              className="border rounded p-2 w-full resize-none min-h-32"
              rows={1}
              onInput={handleInputResize}
            />
          </motion.div>
          {/* Submit Button */}
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
            {(isImageLoading || isFeedbackLoading || isReferenceLoading) ? "Submitting..." : "Submit"}
          </motion.button>
        </motion.div>
      </div>
    </main>
  );
}
