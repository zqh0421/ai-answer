"use client";

import { useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion } from "framer-motion";
import axios from "axios";
import TestDrawer from './components/TestDrawer';

export default function Home() {
  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true); // Drawer state
  const [file, setFile] = useState(null); // For File Upload
  const [question, setQuestion] = useState(""); // For Question Input
  const [answer, setAnswer] = useState(""); // For Answer Display

  useEffect(() => {
    // Fetch API data
    axios
      .get("/api/python")
      .then((response) => {
        setMessage(response.data.message); // Assuming FastAPI returns { "message": "Hello World" }
        setIsDrawerOpen(false);
      })
      .catch((error) => {
        console.error("Error fetching the API:", error);
        setMessage("Failed to load message.");
      });
  }, []);

  // File Upload Handling
  const onDrop = (acceptedFiles) => {
    setFile(acceptedFiles[0]);
    console.log("Uploaded file: ", acceptedFiles[0]);
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  // Submit Question Handling
  const handleQuestionSubmit = async () => {
    try {
      const response = await axios.post("/api/ask", { question });
      setAnswer(response.data.answer);
    } catch (error) {
      console.error("Error fetching the answer:", error);
    }
  };

  // Framer Motion Drawer Animation
  const openDrawer = () => setIsDrawerOpen(true);
  const closeDrawer = () => setIsDrawerOpen(false);

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
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
      <div {...getRootProps()} className="border-2 border-dashed p-6 w-64 text-center cursor-pointer">
        <input {...getInputProps()} />
        <p>Drag & drop a PDF file here, or click to select one</p>
        {file && <p>Uploaded: {file.name}</p>}
      </div>

      {/* Question Input Area */}
      <div className="mt-4">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Enter your question"
          className="border rounded p-2"
        />
        <button
          onClick={handleQuestionSubmit}
          className="ml-2 p-2 bg-blue-500 text-white rounded-lg"
        >
          Submit Question
        </button>
      </div>

      {/* Answer Presenting Area */}
      <motion.div
        className="mt-10 p-4 bg-gray-100 rounded-lg"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        {answer && (
          <>
            <h3 className="text-xl font-semibold">Answer:</h3>
            <p>{answer}</p>
          </>
        )}
      </motion.div>

      {/* Modal for Slide View */}
      <button onClick={openDrawer} className="mt-6 p-2 bg-green-500 text-white rounded-lg">
        View Related Slide
      </button>
    </main>
  );
}
