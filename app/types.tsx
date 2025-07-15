export interface Course {
  course_id: string;
  course_title: string;
  course_description?: string;
  created_at?: string;
}

export interface Module {
  module_id: string;
  module_title: string;
  module_order: number;
  course_id: string;
  created_at: string;
}

export interface Slide {
  id: string;
  slide_title: string;
  slide_google_id: string;
  slide_url: string;
  slide_cover: string;
  published: boolean; // New field to track publish status
  publishing?: boolean; // Temporary state for ongoing publishing
  gotVision: boolean;
  gettingVision?: boolean;
}

export interface Reference {
  text: string;
  image_text: string;
  page_number: number;
  slide_google_id: string;
  slide_title: string;
  display: string;
}

export interface modulesNslides {
  module_id: string;
  module_title: string;
  slides: Slide[];
}

export type RecordResultInput = {
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

export interface StructuredFeedback {
  score: string;
  feedback: string;
  structured_feedback: string;
}

// Union type for all possible feedback formats
export type FeedbackResult = 
  | string 
  | StructuredFeedback 
  | { feedback: string | StructuredFeedback };

// Helper type for the processed feedback data
export type ProcessedFeedbackData = 
  | string 
  | StructuredFeedback;