export interface Course {
  course_id: string;
  course_title: string;
  course_description?: string;
  authority?: 'public' | 'private' | string;
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
  gotVectors?: boolean;
  gettingVision?: boolean;
  updatingVision?: boolean; // Temporary state for updating vision
  updatingVectors?: boolean; // Temporary state for updating vectors
  pageCount?: number;
  rawInfoStatus?: 'not_started' | 'queued' | 'processing' | 'processed' | 'skipped' | 'failed' | 'cancelled';
  rawInfoProgress?: {
    total_steps: number;
    completed_steps: number;
    current_step_label: string | null;
    error: string | null;
  } | null;
}

export interface Reference {
  text: string;
  image_text: string;
  page_number: number; // legacy field for backward compatibility
  page_start?: number | null;
  page_end?: number | null;
  most_relevant_page_number?: number | null;
  slide_total_pages?: number | null;
  slide_id?: string;
  slide_google_id: string;
  slide_title: string;
  display: string;
  most_relevant_slide_embed_url?: string | null;
  slide_embed_url?: string | null;
  most_relevant_slide_embed_url_error?: string | null;
}

export interface modulesNslides {
  module_id: string;
  module_title: string;
  slides: Slide[];
}

export type RecordResultInput = {
  learner_id: string,
  study_id: string,
  session_id: string,
  lti_launch_id?: string,
  lti_user_id?: string,
  score_given?: number,
  score_maximum?: number,
  ip_address?: string,
  question_id: string,
  answer: string,
  feedback: string,
  llm_system_prompt?: string,
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
  is_structured?: boolean;
  score?: string | number;
  max_score?: string | number;
  feedback?: string;
  structured_feedback?: string;
  text_feedback?: string;
}

// Union type for all possible feedback formats
export type FeedbackResult = 
  | string 
  | StructuredFeedback 
  | {
      feedback?: string;
      is_structured?: boolean;
      score?: string | number;
      max_score?: string | number;
      structured_feedback?: string;
      text_feedback?: string;
    };

// Helper type for the processed feedback data
export type ProcessedFeedbackData = 
  | string 
  | StructuredFeedback;
