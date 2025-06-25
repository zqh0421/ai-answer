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