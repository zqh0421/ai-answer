"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion"; // 使用 framer-motion
import axios from "axios";
import TestDrawer from './components/TestDrawer';

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

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

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
      setIsImageLoading(false);
    } catch (error) {
      console.error('Error fetching image:', error);
      setIsImageLoading(false);
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
          answer: answer,
          result: result
        }
      );
      setReference(response.data.result);
      handlePdfImage(response.data.result.page_number);
      setIsReferenceLoading(false);
    } catch (error) {
      console.error("Error fetching the result:", error);
      setIsReferenceLoading(false);
    }
  }

  useEffect(() => {
    if (result) {
      handleRetrieve();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const handleSubmit = async () => {
    if (!answer || !question) return;
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);
    
    axios
      .post("/api/ask", { question, answer })
      .then((response) => {
        setResult(response.data.result);
        setIsFeedbackLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching the result:", error);
        setIsFeedbackLoading(false);
      });
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
          {/* Slide Page Image */}
          <motion.div 
            className="mb-4 p-4 bg-gray-100 rounded-lg shadow-md h-[30vw] w-[60vw] flex justify-center items-center"
            initial={{ opacity: 0 }} 
            animate={{ opacity: imageSrc ? 1 : 0.5 }} 
            transition={{ duration: 0.8 }}
          >
            {imageSrc && !isImageLoading ? (
              <motion.img
                src={imageSrc}
                alt="PDF Page"
                className="w-auto h-[90%] rounded-lg shadow-md"
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5 }}
              />
            ) : (
              <motion.p>
                {isImageLoading ? "Loading image..." : "No image available"}
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
                <p>{reference.content} (page {reference.page_number})</p>
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
          {/* Question Input Area */}
          <motion.div className="mt-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            <h3 className="text-l font-semibold">Open-Ended Question</h3> {/* Question 标题 */}
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
