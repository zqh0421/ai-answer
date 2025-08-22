import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { debounce } from "lodash";
import axios from "axios";

import { RootState, AppDispatch } from "@/app/store/store";
import {
  saveAnswer,
  saveDraftAnswer,
  saveDraftQuestion,
} from "@/app/slices/userSlice";
import { Question, QuestionContent } from "@/app/manage/question/page";
import {
  Reference,
  RecordResultInput,
  StructuredFeedback,
  FeedbackResult,
} from "@/app/types";

export function useV2Logic(questionId?: string) {
  const base_question = "";
  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [result, setResult] = useState<FeedbackResult>("");
  const [reference, setReference] = useState<Reference>();
  const [images, setImages] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(-1);
  const [loadedCount, setLoadedCount] = useState(-1);
  const [activeTab, setActiveTab] = useState("input");

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

  const [selectedPromptEngineering, setSelectedPromptEngineering] =
    useState<string>("rag_cot");
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] =
    useState<string>("feature");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();
  const [module, setModule] = useState<string[]>([]);
  const [slide, setSlide] = useState<string[]>([]);

  const [preferredInfoType, setPreferredInfoType] = useState<string>("vision");
  const searchParams = useSearchParams();
  const course_version = searchParams.get("version");

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
  const draftQuestion = useSelector(
    (state: RootState) => state.user.draftQuestion
  );
  const answers = useSelector((state: RootState) => state.user.answers);
  const participantId = useSelector(
    (state: RootState) => state.user.participantId
  );
  
  const [answer, setAnswer] = useState(
    questionId ? answers[questionId] || "" : draftAnswer || ""
  );
  const [question, setQuestion] = useState<QuestionContent[]>(
    draftQuestion
      ? [{ type: "text", content: draftQuestion }]
      : [{ type: "text", content: base_question }]
  );
  const [saveStatus, setSaveStatus] = useState("Saved");
  const dispatch = useDispatch<AppDispatch>();

  // Debounced save answer function
  const debouncedSaveAnswer = useCallback(
    debounce((temp_answer: string) => {
      if (questionId) {
        dispatch(saveAnswer({ questionId: questionId, answer: temp_answer }));
      } else {
        dispatch(saveDraftAnswer(temp_answer));
      }
      setSaveStatus("Saved");
    }, 500),
    [dispatch, questionId]
  );

  const handleAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAnswer(e.target.value);
    setSaveStatus("Saving...");
    debouncedSaveAnswer(e.target.value);
  };

  // Fetch question by ID
  useEffect(() => {
    if (questionId) {
      setQuestionLoading(true);
      axios
        .get(`/api/questions/by_id/${questionId}`)
        .then((res) => {
          setQuestionPreset(res.data);
        })
        .catch((err) => {
          console.error("Error fetching question:", err);
          window.location.href = "/";
        })
        .finally(() => {
          setQuestionLoading(false);
        });
    }
  }, [questionId]);

  // Test API connection
  useEffect(() => {
    axios
      .get("/api/test")
      .then((response) => {
        setMessage(response.data.message);
        setIsDrawerOpen(false);
      })
      .catch((error) => {
        console.error("Error fetching the API:", error);
        setMessage("Failed to load message.");
      });
  }, []);

  // Reset loaded count when image loading stops
  useEffect(() => {
    if (!isImageLoading) {
      setLoadedCount(-1);
    }
  }, [isImageLoading]);

  // Handle PDF to image conversion
  const handlePdfImage = async (pageNumber: number, slideId: string) => {
    try {
      const response = await axios.post(
        "/api/pdf-to-image",
        {
          slide_id: slideId,
          page_number: pageNumber,
        },
        {
          timeout: 60000,
        }
      );
      return response.data.img_base64;
    } catch (error) {
      console.error("Error fetching image:", error);
      return null;
    }
  };

  // Handle content retrieval
  const handleRetrieve = async () => {
    try {
      const response = await axios.post("/api/embed", {
        question_id: questionId || null,
        question: questionPreset?.content?.length
          ? questionPreset.content
          : question,  // TODO: revise for content editor
        slideIds: slide,
        preferredInfoType: preferredInfoType,
      });

      const res =
        typeof response.data === "string"
          ? JSON.parse(response.data).result
          : response.data.result;

      setReference(res[0]);

      if (preferredInfoType == "vision" && res[0].image_text) {
        setReference({
          ...res[0],
          display: res[0].image_text.replace(/\n\s*\n+/g, "\n"),
        });
      } else if (res[0].text) {
        setReference({
          ...res[0],
          display: res[0].text,
        });
      } else {
        setReference({
          ...res[0],
          display: "EMPTY REFERENCE",
        });
      }

      setSlideTextArr(
        res.map((item: Reference) => {
          if (preferredInfoType == "vision" && item.image_text) {
            return item.image_text;
          } else if (item.text) {
            return item.text;
          } else {
            alert(`${item.slide_title} unpublished!`);
          }
        })
      );

      let temp: string[] = [];
      const page_number = res[0].page_number;
      const startPage = page_number;
      const endPage = page_number;
      setTotalCount(endPage - startPage + 1);
      setLoadedCount(0);

      for (let i = startPage; i <= endPage; i++) {
        const image: string | null = await handlePdfImage(i, res[0].slide_id);
        if (image !== null) {
          setLoadedCount((prevCount) => prevCount + 1);
          temp = [...temp, image];
        }
      }

      setImages(temp);
      setIsImageLoading(false);
      setIsReferenceLoading(false);

      return {
        slide_text_arr: res.map((item: Reference) => {
          if (preferredInfoType == "vision" && item.image_text) {
            return item.image_text;
          } else if (item.text) {
            return item.text;
          } else {
            alert(`${item.slide_title} unpublished!`);
          }
        }),
        reference: res[0],
      };
    } catch (error) {
      console.error("Error fetching the result:", error);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
    }
  };

  // Record result to database
  const recordResultToDatabase = async (result: RecordResultInput) => {
    try {
      await axios.post("/api/record_result", result);
    } catch (error) {
      console.error("Error recording result to database:", error);
    }
  };

  // Validate input
  function isValidInput(input: string): boolean {
    const alphanumericRegex = /[a-zA-Z0-9]/;
    return input.trim() !== "" && alphanumericRegex.test(input);
  }

  // Handle form submission
  const handleSubmit = async () => {
    if (!question && !questionPreset) return;
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);

    const startTime = Date.now();
    let retrievalResult = null;

    if (course_version == "a") {
      if (questionPreset) {
        try {
          const response = await axios.get(
            `/api/get_human_feedback/${questionPreset.question_id}`
          );
          const endTime = Date.now();
          const recordPayload: RecordResultInput = {
            learner_id: participantId || "unidentifiable_learner",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.human_feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type:
              preferredInfoType === "vision" && reference?.image_text
                ? "vision"
                : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: [],
            reference_slide_page_number: -1,
            reference_slide_content: "",
            reference_slide_id: "",
            submission_time: startTime,
            system_total_response_time: endTime - startTime,
          };
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
        if (
          selectedPromptEngineering === "rag_zero" ||
          selectedPromptEngineering === "rag_few" ||
          selectedPromptEngineering === "rag_cot" ||
          selectedPromptEngineering === "graph_rag"
        ) {
          retrievalResult = await handleRetrieve();
          response = await axios.post("/api/generate_feedback_rag", {
            promptEngineering: selectedPromptEngineering,
            feedbackFramework: selectedFeedbackFramework,
            question: questionPreset.content || question,
            answer: isValidInput(answer)
              ? answer
              : "The student haven't provided any answer yet.",
            slide_text_arr: slideTextArr,
            isStructured: true,
          });
        } else {
          const [retrieval, feedbackResponse] = await Promise.all([
            await handleRetrieve(),
            axios.post("/api/generate_feedback", {
              promptEngineering: selectedPromptEngineering,
              feedbackFramework: selectedFeedbackFramework,
              question: questionPreset.content || question,
              answer: isValidInput(answer)
                ? answer
                : "The student haven't provided any answer yet.",
            }),
          ]);
          response = feedbackResponse;
          retrievalResult = retrieval;
        }

        const endTime = Date.now();

        if (questionPreset) {
          const recordPayload: RecordResultInput = {
            learner_id: participantId || "unidentifiable_learner",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type:
              preferredInfoType === "vision" && reference?.image_text
                ? "vision"
                : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: retrievalResult?.slide_text_arr,
            reference_slide_page_number:
              retrievalResult?.reference?.page_number,
            reference_slide_content:
              preferredInfoType === "vision" &&
              retrievalResult?.reference?.image_text
                ? retrievalResult?.reference?.image_text
                : reference?.text,
            reference_slide_id: retrievalResult?.reference?.slide_google_id,
            submission_time: startTime,
            system_total_response_time: endTime - startTime,
          };

          try {
            // await recordResultToDatabase(recordPayload);
          } catch (error) {
            console.error("Failed to record result:", error);
          }
        }
        setResult(response.data);
        setIsFeedbackLoading(false);
      } catch (error) {
        console.error("Error generating feedback:", error);
        setIsFeedbackLoading(false);
      }
    }
  };

  // Image navigation handlers
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

  const closeDrawer = () => setIsDrawerOpen(false);

  return {
    // State
    message,
    isDrawerOpen,
    result,
    reference,
    images,
    totalCount,
    loadedCount,
    activeTab,
    isImageLoading,
    isReferenceLoading,
    isFeedbackLoading,
    selectedPromptEngineering,
    selectedFeedbackFramework,
    slideTextArr,
    course,
    module,
    slide,
    preferredInfoType,
    questionPreset,
    isFullScreen,
    questionLoading,
    enlargedImage,
    currentImageIndex,
    answer,
    question,
    saveStatus,
    
    // Setters
    setCourse,
    setModule,
    setSlide,
    setActiveTab,
    setPreferredInfoType,
    setSelectedPromptEngineering,
    setSelectedFeedbackFramework,
    setQuestion,
    setAnswer,
    setEnlargedImage,
    
    // Handlers
    handleAnswerChange,
    handleSubmit,
    handleImageClick,
    handlePrevious,
    handleNext,
    closeDrawer,
    
    // Computed
    isAnyLoading: isFeedbackLoading || isImageLoading || isReferenceLoading,
  };
}
