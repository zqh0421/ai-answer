import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ProcessJobStatus = 'queued' | 'processing' | 'stopping' | 'completed' | 'failed' | 'cancelled';

export type ProcessJobItemSummary = {
  slideId: string;
  status: string;
  retryCount: number;
  totalSteps?: number;
  completedSteps?: number;
  currentStepLabel?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  error?: string;
};

export type ProcessJobSummary = {
  jobId: string;
  status: ProcessJobStatus;
  createdAtMs: number;
  finishedAtMs?: number;
  queuedCount: number;
  processingCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
  cancelRequested: boolean;
  scopeLabel: string;
  forceProcessAll: boolean;
  failedDetails: Array<{ slideId: string; error: string }>;
  processingSlideIds: string[];
  items: ProcessJobItemSummary[];
  lastProgressSignature?: string;
  lastItemsUpdatedSignature?: string;
  lastProgressChangeAtMs?: number;
};

type ProcessJobsState = {
  isJobPanelOpen: boolean;
  jobs: ProcessJobSummary[];
};

const initialState: ProcessJobsState = {
  isJobPanelOpen: false,
  jobs: [],
};

const processJobsSlice = createSlice({
  name: 'processJobs',
  initialState,
  reducers: {
    setJobPanelOpen: (state, action: PayloadAction<boolean>) => {
      state.isJobPanelOpen = action.payload;
    },
    setProcessJobs: (state, action: PayloadAction<ProcessJobSummary[]>) => {
      state.jobs = action.payload;
    },
    upsertProcessJob: (state, action: PayloadAction<ProcessJobSummary>) => {
      const idx = state.jobs.findIndex((job) => job.jobId === action.payload.jobId);
      if (idx === -1) {
        state.jobs.unshift(action.payload);
        return;
      }
      state.jobs[idx] = action.payload;
    },
    clearProcessJobs: (state) => {
      state.jobs = [];
    },
  },
});

export const { setJobPanelOpen, setProcessJobs, upsertProcessJob, clearProcessJobs } = processJobsSlice.actions;
export default processJobsSlice.reducer;
