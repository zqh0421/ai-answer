"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSelector } from "react-redux";

import { RootState } from "@/app/store/store";
import TestDrawer from "@/app/components/TestDrawer";
import ParticipantModal from "@/app/components/ParticipantModal";
import ImageModal from "@/app/components/v2/ImageModal";
import LeftFeedbackPanel from "@/app/components/v2/LeftFeedbackPanel";
import RightInputPanel from "@/app/components/v2/RightInputPanel";
import { useV2Logic } from "@/app/hooks/useV2Logic";

function HomeChildren() {
  const params = useParams();
  const searchParams = useSearchParams();
  const questionId = Array.isArray(params.questionId)
    ? params.questionId[0]
    : params.questionId;
  const course_version = searchParams.get("version");
  const participantId = useSelector(
    (state: RootState) => state.user.participantId
  );

  const {
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
    course,
    module,
    slide,
    questionPreset,
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
    setQuestion,
    setAnswer,
    setEnlargedImage,

    // Handlers
    handleSubmit,
    handleImageClick,
    handlePrevious,
    handleNext,
    closeDrawer,
  } = useV2Logic(questionId);

  const handleSaveDraftQuestion = (content: string) => {
    // This would dispatch to Redux store
    console.log("Saving draft question:", content);
  };

  return (
    <div className="">
      <ParticipantModal isOpen={!participantId && !!course_version} />

      {/* Drawer for Testing Area */}
      <TestDrawer
        isOpen={isDrawerOpen}
        closeDrawer={closeDrawer}
        message={message}
      />

      <div className="grid grid-cols-11 gap-2 h-full">
        {/* Left Feedback Area */}
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
          feedback={
            typeof result === "string"
              ? result
              : (result as { feedback?: string })?.feedback || ""
          }
          showFeedback={true}
          showReference={true}
        />

        {/* Right Input Area */}
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
          onSaveDraftQuestion={handleSaveDraftQuestion}
          questionId={questionId}
        />
      </div>

      {/* Global Image Modal */}
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

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeChildren />
    </Suspense>
  );
}
