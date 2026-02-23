import {
  ProcessJobItemSummary,
  ProcessJobStatus,
  ProcessJobSummary,
} from '@/app/slices/processJobsSlice';
import type {
  BatchJobItem,
  BatchJobItemStatus,
  BatchJobResponse,
  BatchJobStatus,
  UiProcessStatus,
} from '../types';

export const toProcessJobStatus = (rawStatus: string): ProcessJobStatus => {
  const normalized = rawStatus.toLowerCase();
  if (['queued', 'pending'].includes(normalized)) return 'queued';
  if (['processing', 'running', 'in_progress'].includes(normalized)) return 'processing';
  if (['stopping'].includes(normalized)) return 'stopping';
  if (['cancelled', 'canceled', 'stopped'].includes(normalized)) return 'cancelled';
  if (['failed', 'error'].includes(normalized)) return 'failed';
  if (['completed', 'succeeded', 'success', 'done', 'finished'].includes(normalized)) return 'completed';
  return 'processing';
};

export const formatJobTime = (timeMs: number) => new Date(timeMs).toLocaleTimeString();

export const formatIsoMaybe = (value?: string) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString();
};

export const getJobItemStatusClass = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'processed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (s === 'processing') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (s === 'failed') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (s === 'skipped') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (s === 'cancelled') return 'bg-slate-200 text-slate-700 border-slate-300';
  return 'bg-blue-50 text-blue-700 border-blue-200';
};

export const getJobItemProgressPercent = (item: ProcessJobItemSummary) => {
  const totalSteps = Number(item.totalSteps ?? 0);
  const completedSteps = Number(item.completedSteps ?? 0);
  if (totalSteps <= 0) {
    if (item.status === 'skipped' || item.status === 'processed') return 100;
    return 0;
  }
  const ratio = completedSteps / totalSteps;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
};

export const humanizeProcessError = (error?: string) => {
  if (!error) return '';
  if (error.includes('No pages found for this slide')) {
    return 'Slide pages were not imported successfully during upload. Retry upload.';
  }
  return error;
};

export const getStatusTagClass = (status: UiProcessStatus) => {
  if (status === 'Processed') return 'bg-green-100 text-green-700';
  if (status === 'Partial') return 'bg-amber-100 text-amber-700';
  if (status === 'Processing') return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-700';
};

export const extractSlideIdsFromResult = (items: unknown): string[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const v = item as Record<string, unknown>;
        return (v.slide_id ?? v.id ?? v.slideId) as string | undefined;
      }
      return undefined;
    })
    .filter((id): id is string => Boolean(id));
};

export const extractFailedDetails = (items: unknown): Array<{ slideId: string; error: string }> => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const v = item as Record<string, unknown>;
      const slideId = String(v.slide_id ?? v.id ?? v.slideId ?? '');
      const error = String(v.error ?? v.message ?? 'Unknown error');
      if (!slideId) return null;
      return { slideId, error };
    })
    .filter((v): v is { slideId: string; error: string } => Boolean(v));
};

export const normalizeJobItems = (items: unknown): ProcessJobItemSummary[] => {
  if (!Array.isArray(items)) return [];
  return items.reduce<ProcessJobItemSummary[]>((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    const v = item as Record<string, unknown>;
    const slideId = String(v.slide_id ?? v.id ?? v.slideId ?? '');
    if (!slideId) return acc;
    acc.push({
      slideId,
      status: String(v.status ?? 'queued').toLowerCase(),
      retryCount: Number(v.retry_count ?? v.retryCount ?? 0),
      totalSteps: Number(v.total_steps ?? v.totalSteps ?? 0),
      completedSteps: Number(v.completed_steps ?? v.completedSteps ?? 0),
      currentStepLabel: v.current_step_label ? String(v.current_step_label) : v.currentStepLabel ? String(v.currentStepLabel) : undefined,
      startedAt: v.started_at ? String(v.started_at) : v.startedAt ? String(v.startedAt) : undefined,
      finishedAt: v.finished_at ? String(v.finished_at) : v.finishedAt ? String(v.finishedAt) : undefined,
      updatedAt: v.updated_at ? String(v.updated_at) : v.updatedAt ? String(v.updatedAt) : undefined,
      error: v.error ? String(v.error) : v.message ? String(v.message) : undefined,
    });
    return acc;
  }, []);
};

export const normalizeBatchJobItems = (items: unknown): BatchJobItem[] => {
  if (!Array.isArray(items)) return [];
  return items.reduce<BatchJobItem[]>((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    const v = item as Record<string, unknown>;
    const slideId = String(v.slide_id ?? v.slideId ?? '');
    if (!slideId) return acc;
    acc.push({
      item_id: String(v.item_id ?? v.itemId ?? `${slideId}-${acc.length}`),
      slide_id: slideId,
      status: String(v.status ?? 'queued').toLowerCase() as BatchJobItemStatus,
      retry_count: Number(v.retry_count ?? v.retryCount ?? 0),
      total_steps: Number(v.total_steps ?? v.totalSteps ?? 0),
      completed_steps: Number(v.completed_steps ?? v.completedSteps ?? 0),
      current_step_label:
        v.current_step_label != null ? String(v.current_step_label) : v.currentStepLabel != null ? String(v.currentStepLabel) : null,
      error: v.error != null ? String(v.error) : null,
      started_at: v.started_at != null ? String(v.started_at) : v.startedAt != null ? String(v.startedAt) : null,
      finished_at: v.finished_at != null ? String(v.finished_at) : v.finishedAt != null ? String(v.finishedAt) : null,
      updated_at: v.updated_at != null ? String(v.updated_at) : v.updatedAt != null ? String(v.updatedAt) : null,
    });
    return acc;
  }, []);
};

export const normalizeBatchJobResponse = (raw: unknown): BatchJobResponse => {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    job_id: String(v.job_id ?? v.jobId ?? ''),
    status: String(v.status ?? 'queued').toLowerCase() as BatchJobStatus,
    cancel_requested: Boolean(v.cancel_requested ?? v.cancelRequested ?? false),
    total_count: Number(v.total_count ?? v.totalCount ?? 0),
    queued_count: Number(v.queued_count ?? v.queuedCount ?? 0),
    processing_count: Number(v.processing_count ?? v.processingCount ?? 0),
    processed_count: Number(v.processed_count ?? v.processedCount ?? 0),
    skipped_count: Number(v.skipped_count ?? v.skippedCount ?? 0),
    failed_count: Number(v.failed_count ?? v.failedCount ?? 0),
    cancelled_count: Number(v.cancelled_count ?? v.cancelledCount ?? 0),
    created_at: v.created_at != null ? String(v.created_at) : null,
    updated_at: v.updated_at != null ? String(v.updated_at) : null,
    items: normalizeBatchJobItems(v.items),
  };
};

export const isTerminalBatchJobStatus = (status?: string | null) =>
  Boolean(status && ['completed', 'failed', 'cancelled'].includes(String(status).toLowerCase()));

export const getProcessItemLabel = (item?: ProcessJobItemSummary) => {
  if (!item) return null;
  if (item.status === 'queued' && item.currentStepLabel === 'waiting_page_import') return 'Waiting for page import';
  if (item.status === 'queued') return 'Queued';
  if (item.status === 'processing') {
    if (item.currentStepLabel === 'vectors') return 'Processing vectors...';
    return 'Processing';
  }
  if (item.status === 'processed') return 'Processed';
  if (item.status === 'skipped') return 'Skipped';
  if (item.status === 'failed') return 'Failed';
  if (item.status === 'cancelled') return 'Cancelled';
  return item.status;
};

export const getJobStatusLabel = (job: ProcessJobSummary) => {
  if (job.status === 'queued') return 'Queued';
  if (job.status === 'processing' || job.status === 'stopping') return 'Processing...';
  if (job.status === 'cancelled') return 'Cancelled';
  if (job.failedCount > 0 && (job.processedCount > 0 || job.skippedCount > 0)) return 'Completed with failures';
  if (job.status === 'failed') return 'Failed';
  return 'Completed';
};
