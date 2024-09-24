"use client";

import { useState, useEffect } from "react";
// import { FileWithPath, useDropzone } from "react-dropzone";
import { motion } from "framer-motion";
import axios from "axios";
import TestDrawer from './components/TestDrawer';

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
    } catch (error) {
      console.error("Error fetching the result:", error);
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

    // Fetch API data
    axios
      .post("/api/ask", { question, answer })
      .then((response) => {
        setResult(response.data.result);
      })
      .catch((error) => {
        console.error("Error fetching the result:", error);
      });
  };

  // Handle Enter key press for submitting the question
  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.keyCode === 13) {
      handleSubmit();
    }
  };

  // Framer Motion Drawer Animation
  const openDrawer = () => setIsDrawerOpen(true);
  const closeDrawer = () => setIsDrawerOpen(false);

  return (
    <main className="flex flex-col items-center justify-between p-24">
      {/* Button to open the drawer */}
      <button
        className="mb-6 p-2 bg-blue-500 text-white rounded-lg"
        onClick={openDrawer}
      >
        Open Test Drawer
      </button>

      {/* Drawer for Testing Area */}
      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />


      {/* File Upload Area */}
      {/* <div {...getRootProps()} className="border-2 border-dashed p-6 w-64 text-center cursor-pointer">
        <input {...getInputProps()} />
        <p>Drag & drop a PDF file here, or click to select one</p>
        {file && <p>Uploaded: {file.name}</p>}
      </div> */}

      {/* Question Input Area */}
      <div className="mt-4">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Enter your question"
          className="border rounded p-2 w-[400px]"
          onKeyUp={handleKeyUp}
        />
      </div>

      {/* Answer Input Area */}
      <div className="mt-4">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Enter your answer"
          className="border rounded p-2 w-[400px]"
          onKeyUp={handleKeyUp}
        />
      </div>


      <button
          onClick={handleSubmit}
          className="ml-2 p-2 bg-blue-500 text-white rounded-lg"
        >
          Submit
        </button>

      {/* Result Presenting Area */}
      <motion.div
        className="mt-10 p-4 bg-gray-100 rounded-lg"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        {result && (
          <>
            <h3 className="text-xl font-semibold">Feedback:</h3>
            <p>{result}</p>
          </>
        )}
      </motion.div>

      {/* Reference Presenting Area */}
      <motion.div
        className="mt-10 p-4 bg-gray-100 rounded-lg"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        {reference?.content && (
          <>
            <h3 className="text-xl font-semibold">Reference:</h3>
            <p>{reference.content} (page {reference.page_number})</p>
          </>
        )}
      </motion.div>
    </main>
  );
}
