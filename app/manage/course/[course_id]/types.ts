export type ProcessBatchRequest = {
  slide_ids: string[];
  force_process_all: boolean;
};

export type DeleteBatchRequest = {
  slide_ids: string[];
};

export type UiProcessStatus = 'Processing' | 'Unprocessed' | 'Partial' | 'Processed';
export type RawInfoStatus = 'not_started' | 'queued' | 'processing' | 'processed' | 'skipped' | 'failed' | 'cancelled';
export type BatchJobItemStatus = 'queued' | 'processing' | 'processed' | 'skipped' | 'failed' | 'cancelled';
export type BatchJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type BatchJobItem = {
  item_id: string;
  slide_id: string;
  status: BatchJobItemStatus;
  retry_count: number;
  total_steps: number;
  completed_steps: number;
  current_step_label: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
};

export type BatchJobResponse = {
  job_id: string;
  status: BatchJobStatus;
  cancel_requested: boolean;
  total_count: number;
  queued_count: number;
  processing_count: number;
  processed_count: number;
  skipped_count: number;
  failed_count: number;
  cancelled_count: number;
  created_at: string | null;
  updated_at: string | null;
  items: BatchJobItem[];
};

export type UploadSlidesBatchResponse = {
  message?: string;
  duplicates_in_payload?: number;
  page_import_jobs_queued?: number;
  page_import_job_id?: string;
};

export type MySlideJobSummary = {
  job_id: string;
  job_type: 'process_batch' | 'page_import_batch' | string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | string;
  requested_by?: string | null;
  force_process_all?: boolean | null;
  cancel_requested?: boolean | null;
  total_count?: number | null;
  queued_count?: number | null;
  processing_count?: number | null;
  processed_count?: number | null;
  skipped_count?: number | null;
  failed_count?: number | null;
  cancelled_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MySlideJobsResponse = {
  user_id: string;
  count: number;
  jobs: MySlideJobSummary[];
};
