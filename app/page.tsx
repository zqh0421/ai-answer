"use client";

import { useState, useEffect } from "react";
// import { FileWithPath, useDropzone } from "react-dropzone";
import { motion } from "framer-motion";
import axios from "axios";
import TestDrawer from './components/TestDrawer';
import Image from "next/image";

interface Reference {
  content: string,
  page_number: number
}

export default function Home() {
  // const base_question = "What is learning science?"
  const base_question = "What is Learning Objectives of E-Learning Design Principles & Methods about?"
  const base_wrong_answer = "Learning is about engineering."
  // const base_correct_answer = "Learning science is an interdisciplinary field that encompasses educational psychology, cognitive science, computer science, and anthropology. It focuses on understanding the theoretical aspects of learning, designing and implementing learning innovations, and improving instructional methodologies."
  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true); // Drawer state
  // const [file, setFile] = useState<FileWithPath | null>(null); // For File Upload
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
      const imageBlob = response.data;  // Axios 将响应的 blob 数据放在 data 字段
      const imageUrl = URL.createObjectURL(imageBlob);  // 创建 URL
      setImageSrc(imageUrl);  // 将生成的 URL 设置为图片的 src
      setIsImageLoading(false);
    } catch (error) {
      console.error('Error fetching image:', error);  // 显示正确的错误消息
      setIsImageLoading(false);
    }
  };

  useEffect(() => {
    // Fetch API data
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

  function handleInputResize(e) {
    e.target.style.height = "auto"; // 重置高度
    e.target.style.height = `${e.target.scrollHeight}px`; // 根据内容调整高度
  }

  // // File Upload Handling
  // // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // const onDrop = (acceptedFiles: FileWithPath[]) => {
  //   setFile(acceptedFiles[0]);
  //   console.log("Uploaded file: ", acceptedFiles[0]);
  // };

  // const { getRootProps, getInputProps } = useDropzone({ onDrop });

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
  }, [result]);

  // Submit Question Handling
  const handleSubmit = async () => {
    if (!answer || !question) return;
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);
    // Fetch API data
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

  // Handle Enter key press for submitting the question
  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.keyCode === 13) {
      handleSubmit();
    }
  };

  // Framer Motion Drawer Animation
  // const openDrawer = () => setIsDrawerOpen(true);
  const closeDrawer = () => setIsDrawerOpen(false);

  return (
    <main className="flex flex-col items-center justify-between">
      {/* Button to open the drawer */}
      {/* <button
        className="mb-6 p-2 bg-blue-500 text-white rounded-lg"
        onClick={openDrawer}
      >
        Open Test Drawer
      </button> */}

      {/* Drawer for Testing Area */}
      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />


      {/* File Upload Area */}
      {/* <div {...getRootProps()} className="border-2 border-dashed p-6 w-64 text-center cursor-pointer">
        <input {...getInputProps()} />
        <p>Drag & drop a PDF file here, or click to select one</p>
        {file && <p>Uploaded: {file.name}</p>}
      </div> */}

      <div className="grid grid-cols-4 gap-4">
        {/* 左侧 Feedback Area */}
        <div className="col-span-3 flex flex-col">
          {/* Slide Page Image */}
          <div className="mb-4 p-4 bg-gray-100 rounded-lg shadow-md h-[30vw] w-[60vw] flex justify-center items-center">
            {imageSrc && !isImageLoading ? (
              <img src={imageSrc} alt="PDF Page" className="w-auto h-[90%] rounded-lg shadow-md" />
            ) : (
              <p>{isImageLoading ? "Loading image..." : "No image available"}</p>
            )}
          </div>
          
          {/* Feedback and Answer */}
          <div className="p-4 bg-gray-100 rounded-lg shadow-md w-[60vw]">
            {/* AI Feedback */}
            <motion.div className="mb-4" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <h3 className="text-xl font-semibold">Feedback:</h3>
              {result && !isFeedbackLoading ? (
                <p>{result}</p>
              ) : (
                <p>{isFeedbackLoading ? "Loading feedback..." : "No feedback yet"}</p>
              )}
            </motion.div>
            
            {/* Reference Display */}
            <motion.div className="mt-4" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
              <h3 className="text-xl font-semibold">Reference:</h3>
              {reference && !isReferenceLoading ? (
                <p>{reference.content} (page {reference.page_number})</p>
              ) : (
                <p>{isReferenceLoading ? "Loading reference..." : "No reference available"}</p>
              )}
            </motion.div>
          </div>
        </div>

        {/* 右侧 User Input Area */}
        <div className="col-span-1 p-4 bg-white rounded-lg shadow-md">
          {/* Question Input Area */}
          <div className="mt-4">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Enter your question"
              className="border rounded p-2 w-full resize-none min-h-32"
              rows={1}
              onInput={handleInputResize}
            />
          </div>

          {/* Answer Input Area */}
          <div className="mt-4">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Enter your answer"
              className="border rounded p-2 w-full resize-none min-h-32"
              rows={1}
              onInput={handleInputResize}
            />
          </div>

          {/* Submit Button */}
          <button onClick={handleSubmit} className="mt-4 w-full p-2 bg-blue-500 text-white rounded-lg">
            {(isImageLoading || isFeedbackLoading || isReferenceLoading) ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </main>
  );
}
