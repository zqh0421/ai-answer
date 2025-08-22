"use client";

import { useState, useEffect, Suspense, useCallback, useMemo } from "react";
import axios from "axios";
import { useSearchParams, useParams } from "next/navigation";
import { debounce } from "lodash";
import { useSelector, useDispatch } from "react-redux";

import { RootState, AppDispatch } from "@/app/store/store";
import { saveAnswer, saveDraftAnswer, saveDraftQuestion } from "@/app/slices/userSlice";
import { Question, QuestionContent } from "@/app/manage/question/page";

import TestDrawer from "@/app/components/TestDrawer";
import ParticipantModal from "@/app/components/ParticipantModal";
import ImageModal from "@/app/components/v2/ImageModal";
import LeftFeedbackPanel from "@/app/components/v2/LeftFeedbackPanel";
import RightInputPanel from "@/app/components/v2/RightInputPanel";
import { Reference, Course, Module, Slide, RecordResultInput, FeedbackResult } from "@/app/types";

function PageChildren() {
  // Dynamic route param: /v2/oeq/[questionId]
  const params = useParams() as { questionId?: string };
  const question_id = params?.questionId || "";

  // Optional query params (still supported)
  const searchParams = useSearchParams();
  const course_version = searchParams.get("version");

  // 🔎 Collect Prolific params from the URL if present
  const { prolificPid, studyId, sessionId } = useMemo(() => ({
    prolificPid: searchParams.get("PROLIFIC_PID") || undefined,
    studyId: searchParams.get("STUDY_ID") || undefined,
    sessionId: searchParams.get("SESSION_ID") || undefined,
  }), [searchParams]);

  const dispatch = useDispatch<AppDispatch>();

  const participantId = useSelector((state: RootState) => state.user.participantId);
  const answers = useSelector((state: RootState) => state.user.answers);
  const draftAnswer = useSelector((state: RootState) => state.user.draftAnswer);
  const draftQuestion = useSelector((state: RootState) => state.user.draftQuestion);

  const base_question = "";

  const [message, setMessage] = useState("Loading...");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);

  const [result, setResult] = useState<FeedbackResult | string>("");
  const [reference, setReference] = useState<Reference>();
  const [images, setImages] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(-1);
  const [loadedCount, setLoadedCount] = useState(-1);
  const [activeTab, setActiveTab] = useState("input");

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

  const [selectedPromptEngineering, setSelectedPromptEngineering] = useState<string>("rag_cot");
  const [selectedFeedbackFramework, setSelectedFeedbackFramework] = useState<string>("feature");
  const [slideTextArr, setSlideTextArr] = useState<string[]>([""]);

  const [course, setCourse] = useState<string>();
  const [courses, setCourses] = useState<Course[]>([]);
  const [module, setModule] = useState<string[]>([]);
  const [slide, setSlide] = useState<string[]>([]);

  const [availableModules, setAvailableModules] = useState<Module[]>([]);
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);

  const [preferredInfoType, setPreferredInfoType] = useState<string>("vision");

  const [questionPreset, setQuestionPreset] = useState<Question>({
    question_id: "",
    type: "",
    content: [],
  });
  const [questionLoading, setQuestionLoading] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

  const [answer, setAnswer] = useState(
    question_id ? (answers[question_id] || "") : (draftAnswer || "")
  );
  const [question, setQuestion] = useState<QuestionContent[]>(
    draftQuestion ? [{ type: "text", content: draftQuestion }] : [{ type: "text", content: base_question }]
  );
  const [saveStatus, setSaveStatus] = useState("Saved");

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

  const onSaveDraftQuestion = useCallback(
    (text: string) => {
      dispatch(saveDraftQuestion(text));
    },
    [dispatch]
  );

  const handleAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAnswer(e.target.value);
    setSaveStatus("Saving...");
    debouncedSaveAnswer(e.target.value);
  };

  // Load initial courses (for selectors)
  useEffect(() => {
    axios
      .get("/api/courses/public")
      .then((response) => setCourses(response.data))
      .catch((error) => {
        console.error("Error fetching the courses:", error);
        setMessage("Failed to load courses.");
      });
  }, []);

  // Auto-pick the first course when courses arrive
  useEffect(() => {
    if (courses.length > 0 && !course) setCourse(courses[0].course_id);
  }, [courses, course]);

  // Load modules for the selected course
  useEffect(() => {
    if (!course) return;
    axios
      .get(`/api/courses/by_id/${course}/modules`)
      .then((response) => {
        setAvailableModules(response.data.modules);
        setModule(response.data.modules.map((mod: Module) => mod.module_id));
      })
      .catch((error) => {
        console.error("Error fetching modules:", error);
        setMessage("Failed to load courses.");
      });
  }, [course]);

  // Load slides for selected modules
  useEffect(() => {
    if (!module.length) {
      setAvailableSlides([]);
      return;
    }
    const fetchSlides = async () => {
      try {
        const slideRequests = module.map((modId) => axios.get(`/api/modules/${modId}/slides`));
        const slideResponses = await Promise.all(slideRequests);
        const allSlides = slideResponses.flatMap((res) => res.data.slides);
        setAvailableSlides(allSlides);
        setSlide(allSlides.map((sld: Slide) => sld.id));
      } catch (error) {
        console.error("Error fetching the slides:", error);
      }
    };
    fetchSlides();
  }, [module]);

  // 🔑 Fetch question data from DB using dynamic route param question_id
  useEffect(() => {
    if (!question_id) return;
    setQuestionLoading(true);
    axios
      .get(`/api/questions/by_id/${question_id}`)
      .then((res) => {
        setQuestionPreset(res.data);
        // If needed, prefill question input for non-preset usage
        if (!res.data?.content?.length) return;
        // Keep the original behavior of showing preset content and no free-input box
      })
      .catch((err) => {
        console.error("Error fetching question:", err);
      })
      .finally(() => setQuestionLoading(false));
  }, [question_id]);

  // Connectivity ping (unchanged)
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

  const handlePdfImage = async (pageNumber: number, slideId: string) => {
    try {
      const response = await axios.post(
        "/api/pdf-to-image",
        { slide_id: slideId, page_number: pageNumber },
        { timeout: 60000 }
      );
    
      return response.data.img_base64 as string | null;
    } catch (error) {
      console.error("Error fetching image:", error);
      return null;
    }
  };

  useEffect(() => {
    if (!isImageLoading) setLoadedCount(-1);
  }, [isImageLoading]);

  function handleInputResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  const handleRetrieve = async () => {
    try {
      const response = await axios.post("/api/embed", {
        question_id: question_id || null,
        question: questionPreset?.content?.length ? questionPreset.content : question,
        slideIds: slide,
        preferredInfoType: preferredInfoType,
      });
      const res = typeof response.data === "string" ? JSON.parse(response.data).result : response.data.result;
      setReference(res[0]);

      if (preferredInfoType === "vision" && res[0].image_text) {
        setReference({ ...res[0], display: res[0].image_text.replace(/\n\s*\n+/g, "\n") });
      } else if (res[0].text) {
        setReference({ ...res[0], display: res[0].text });
      } else {
        setReference({ ...res[0], display: "EMPTY REFERENCE" });
      }

      setSlideTextArr(
        res.map((item: Reference) => {
          if (preferredInfoType === "vision" && item.image_text) return item.image_text;
          if (item.text) return item.text;
          alert(`${item.slide_title} unpublished!`);
          return "";
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
          if (preferredInfoType === "vision" && item.image_text) return item.image_text;
          if (item.text) return item.text;
          alert(`${item.slide_title} unpublished!`);
          return "";
        }),
        reference: res[0] as Reference,
      };
    } catch (error) {
      console.error("Error fetching the result:", error);
      setIsReferenceLoading(false);
      setIsImageLoading(false);
    }
  };

  const recordResultToDatabase = async (payload: RecordResultInput) => {
    try {
      await axios.post("/api/record_result", payload);
    } catch (error) {
      console.error("Error recording result to database:", error);
    }
  };

  function isValidInput(input: string): boolean {
    const alphanumericRegex = /[a-zA-Z0-9]/;
    return input.trim() !== "" && alphanumericRegex.test(input);
  }

  const handleSubmit = async () => {
    if (!question && !questionPreset) return;
    setIsFeedbackLoading(true);
    setIsImageLoading(true);
    setIsReferenceLoading(true);

    const startTime = Date.now();
    let retrievalResult: any = null;

    if (course_version === "a") {
      if (questionPreset) {
        try {
          const response = await axios.get(`/api/get_human_feedback/${questionPreset.question_id}`);
          const endTime = Date.now();
          const recordPayload: RecordResultInput = {
            learner_id: prolificPid || participantId || "unidentifiable_learner",
            study_id: studyId || "unidentifiable_study",
            session_id: sessionId || "unidentifiable_session",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.human_feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type: preferredInfoType === "vision" && reference?.image_text ? "vision" : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: [],
            reference_slide_page_number: -1,
            reference_slide_content: "",
            reference_slide_id: "",
            submission_time: startTime,
            system_total_response_time: endTime - startTime,
          };
          await recordResultToDatabase(recordPayload);

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
        if (["rag_zero", "rag_few", "rag_cot", "graph_rag"].includes(selectedPromptEngineering)) {
          retrievalResult = await handleRetrieve();
          response = await axios.post("/api/generate_feedback_rag", {
            promptEngineering: selectedPromptEngineering,
            feedbackFramework: selectedFeedbackFramework,
            question: questionPreset.content || question,
            answer: isValidInput(answer) ? answer : "The student haven't provided any answer yet.",
            slide_text_arr: slideTextArr,
            isStructured: true,
          });
        } else {
          const [retrieval, feedbackResponse] = await Promise.all([
            handleRetrieve(),
            axios.post("/api/generate_feedback", {
              promptEngineering: selectedPromptEngineering,
              feedbackFramework: selectedFeedbackFramework,
              question: questionPreset.content || question,
              answer: isValidInput(answer) ? answer : "The student haven't provided any answer yet.",
            }),
          ]);
          response = feedbackResponse;
          retrievalResult = retrieval;
        }

        const endTime = Date.now();

        if (questionPreset) {
          const recordPayload: RecordResultInput = {
            learner_id: prolificPid || participantId || "unidentifiable_learner",
            study_id: studyId || "unidentifiable_study",
            session_id: sessionId || "unidentifiable_session",
            question_id: questionPreset.question_id,
            answer: answer,
            feedback: response.data.feedback,
            prompt_engineering_method: selectedPromptEngineering,
            preferred_info_type: preferredInfoType === "vision" && reference?.image_text ? "vision" : "text",
            feedback_framework: selectedFeedbackFramework,
            slide_retrieval_range: retrievalResult?.slide_text_arr,
            reference_slide_page_number: retrievalResult?.reference?.page_number,
            reference_slide_content:
              preferredInfoType === "vision" && retrievalResult?.reference?.image_text
                ? retrievalResult?.reference?.image_text
                : reference?.text || "",
            reference_slide_id: retrievalResult?.reference?.slide_google_id,
            submission_time: startTime,
            system_total_response_time: endTime - startTime,
          };
          await recordResultToDatabase(recordPayload);
        }

        setResult(response.data);
        setIsFeedbackLoading(false);
      } catch (error) {
        console.error("Error generating feedback:", error);
        setIsFeedbackLoading(false);
      }
    }
  };

  const closeDrawer = () => setIsDrawerOpen(false);

  const handleImageClick = (image: string, index: number) => {
    setEnlargedImage(image);
    setCurrentImageIndex(index);
  };

  const handlePrevious = () => {
    if (currentImageIndex > 0 && images) {
      setCurrentImageIndex((idx) => idx - 1);
      setEnlargedImage(images[currentImageIndex - 1]);
    }
  };

  const handleNext = () => {
    if (images && currentImageIndex < images.length - 1) {
      setCurrentImageIndex((idx) => idx + 1);
      setEnlargedImage(images[currentImageIndex + 1]);
    }
  };

  return (
    <div className="">
      {/* If you only want to show the participant modal for Prolific flows, you can also gate this by prolificPid */}
      <ParticipantModal isOpen={!prolificPid && !participantId && !!course_version} />

      <TestDrawer isOpen={isDrawerOpen} closeDrawer={closeDrawer} message={message} />

      <div className="grid grid-cols-11 gap-2 h-full">
        <LeftFeedbackPanel
          result={result}
          reference={reference}
          isReferenceLoading={isReferenceLoading}
          images={images}
          isImageLoading={isImageLoading}
          loadedCount={loadedCount}
          totalCount={totalCount}
          onImageClick={handleImageClick}
          studentAnswer={answer}
          feedback={typeof result === "string" ? result : (result as { feedback?: string })?.feedback || ""}
          showFeedback={true}
          showReference={true}
        />

        <RightInputPanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          course={course}
          setCourse={setCourse}
          module={module}
          setModule={setModule}
          slide={slide}
          setSlide={setSlide}
          question={question}
          setQuestion={setQuestion}
          answer={answer}
          setAnswer={setAnswer}
          questionPreset={questionPreset}
          questionLoading={questionLoading}
          isFeedbackLoading={isFeedbackLoading}
          isImageLoading={isImageLoading}
          isReferenceLoading={isReferenceLoading}
          saveStatus={saveStatus}
          onSubmit={handleSubmit}
          onSaveDraftQuestion={onSaveDraftQuestion}
          questionId={question_id || undefined}
          onAnswerChange={handleAnswerChange}
          onInputResize={handleInputResize}
        />
      </div>

      <ImageModal
        enlargedImage={enlargedImage}
        setEnlargedImage={setEnlargedImage}
        currentImageIndex={currentImageIndex}
        images={images}
        onPrevious={handlePrevious}
        onNext={handleNext}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PageChildren />
    </Suspense>
  );
}
