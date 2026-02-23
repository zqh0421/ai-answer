'use client';

import ActionButton from '@/app/components/ActionButton';
import { ProcessJobSummary } from '@/app/slices/processJobsSlice';
import {
  formatIsoMaybe,
  formatJobTime,
  getJobItemProgressPercent,
  getJobItemStatusClass,
  getJobStatusLabel,
  getProcessItemLabel,
  humanizeProcessError,
} from '../utils/jobUtils';

type JobSummaryPanelProps = {
  isOpen: boolean;
  jobs: ProcessJobSummary[];
  jobClockMs: number;
  jobTimeoutWarningMs: number;
  slideTitleById: Record<string, string>;
  formatJobDuration: (job: ProcessJobSummary) => string;
  onClose: () => void;
  onStopJob: (jobId: string) => void;
};

const JobSummaryPanel = ({
  isOpen,
  jobs,
  jobClockMs,
  jobTimeoutWarningMs,
  slideTitleById,
  formatJobDuration,
  onClose,
  onStopJob,
}: JobSummaryPanelProps) => {
  if (!isOpen) return null;

  return (
    <aside className="fixed right-4 top-28 bottom-4 z-[65] w-[380px] overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Job Summary</h3>
          <p className="text-[11px] text-slate-500">Batch processing status and failures</p>
        </div>
        <ActionButton onClick={onClose} variant="ghost" size="sm">
          Close
        </ActionButton>
      </div>
      <div className="h-full overflow-y-auto p-3 pb-10">
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
            No jobs yet.
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div key={job.jobId} className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/70 px-3 py-3 shadow-sm">
                {(() => {
                  const isRunning = ['queued', 'processing', 'stopping'].includes(job.status);
                  const showTimeoutWarning = isRunning && (jobClockMs - job.createdAtMs) > jobTimeoutWarningMs;
                  const jobItems = job.items ?? [];
                  const processingItems = jobItems.filter((item) => item.status === 'processing');
                  const processingIds = processingItems.length > 0 ? processingItems.map((item) => item.slideId) : (job.processingSlideIds ?? []);
                  const processingLabels = processingIds.slice(0, 3).map((slideId) => slideTitleById[slideId] ?? slideId);

                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-slate-700">
                          <div className="break-all">
                            <span className="font-medium text-slate-900">Job:</span> {job.jobId}
                          </div>
                          <div>
                            <span className="font-medium text-slate-900">Scope:</span> {job.scopeLabel} | <span className="font-medium text-slate-900">Mode:</span> {job.forceProcessAll ? 'force' : 'normal'}
                          </div>
                          <div>
                            <span className="font-medium text-slate-900">Started:</span> {formatJobTime(job.createdAtMs)} | <span className="font-medium text-slate-900">Duration:</span> {formatJobDuration(job)}
                          </div>
                          <div className="leading-relaxed">
                            <span className="font-medium text-slate-900">Progress:</span>{' '}
                            {job.processedCount ?? 0} processed / {job.skippedCount ?? 0} skipped / {job.failedCount ?? 0} failed / {job.processingCount ?? 0} processing / {job.queuedCount ?? 0} queued / {job.cancelledCount ?? 0} cancelled / {job.totalCount ?? 0} total
                          </div>
                          {Boolean(job.cancelRequested) && (
                            <div className="text-amber-700">Cancel requested. Waiting for worker to stop safely.</div>
                          )}
                          {processingLabels.length > 0 && (
                            <div className="text-slate-600">
                              <span className="font-medium text-slate-900">Currently processing:</span> {processingLabels.join(', ')}
                              {processingIds.length > 3 ? ' ...' : ''}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-medium ${
                              job.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-700'
                                : job.status === 'failed'
                                  ? 'bg-red-100 text-red-700'
                                  : job.status === 'cancelled'
                                    ? 'bg-gray-200 text-gray-700'
                                    : job.status === 'stopping'
                                      ? 'bg-orange-100 text-orange-700'
                                      : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {getJobStatusLabel(job)}
                          </span>
                          <ActionButton
                            onClick={() => onStopJob(job.jobId)}
                            disabled={!['queued', 'processing', 'stopping'].includes(job.status)}
                            variant="danger"
                            size="sm"
                          >
                            Stop
                          </ActionButton>
                        </div>
                      </div>

                      {showTimeoutWarning && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                          This job may take long because processing vision information can be time-consuming.
                        </div>
                      )}
                      {(job.failedDetails ?? []).length > 0 && (
                        <details className="mt-2 rounded-lg border border-red-100 bg-red-50/50 p-2">
                          <summary className="cursor-pointer text-xs font-medium text-red-700">
                            Failed Details ({(job.failedDetails ?? []).length})
                          </summary>
                          <div className="mt-1 space-y-1 text-xs text-red-800">
                            {(job.failedDetails ?? []).map((item) => (
                              <div key={`${job.jobId}-${item.slideId}`} className="rounded-md border border-red-100 bg-white px-2 py-1">
                                <span className="font-medium">{slideTitleById[item.slideId] ?? item.slideId}:</span> {humanizeProcessError(item.error)}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {jobItems.length > 0 && (
                        <details className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
                          <summary className="cursor-pointer text-xs font-medium text-slate-700">
                            Per-slide Details ({jobItems.length})
                          </summary>
                          <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                            {jobItems.map((item) => (
                              <div key={`${job.jobId}-${item.slideId}-item`} className="rounded-lg border border-slate-200 bg-slate-50/70 p-2 text-xs">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-slate-800">
                                      {slideTitleById[item.slideId] ?? item.slideId}
                                    </div>
                                    <div className="truncate text-slate-500">{item.slideId}</div>
                                  </div>
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${getJobItemStatusClass(item.status)}`}>
                                    {getProcessItemLabel(item) ?? item.status}
                                  </span>
                                </div>
                                <div className="mt-2">
                                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-600">
                                    <span className="truncate">
                                      {item.status === 'queued' && item.currentStepLabel === 'waiting_page_import'
                                        ? 'step: waiting for page import'
                                        : item.currentStepLabel
                                          ? `step: ${item.currentStepLabel}`
                                          : 'step: -'}
                                    </span>
                                    <span>
                                      {Number(item.completedSteps ?? 0)} / {Number(item.totalSteps ?? 0)}
                                    </span>
                                  </div>
                                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                                    <div
                                      className={`h-full rounded-full ${
                                        item.status === 'failed'
                                          ? 'bg-rose-400'
                                          : item.status === 'processed'
                                            ? 'bg-emerald-400'
                                            : item.status === 'cancelled'
                                              ? 'bg-slate-400'
                                              : 'bg-amber-400'
                                      }`}
                                      style={{ width: `${getJobItemProgressPercent(item)}%` }}
                                    />
                                  </div>
                                </div>
                                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-slate-600">
                                  <div>retry: {item.retryCount}</div>
                                  <div>updated: {formatIsoMaybe(item.updatedAt)}</div>
                                  <div>start: {formatIsoMaybe(item.startedAt)}</div>
                                  <div>end: {formatIsoMaybe(item.finishedAt)}</div>
                                </div>
                                {item.error && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-rose-700">error</summary>
                                    <div className="mt-1 rounded-md border border-rose-100 bg-white px-2 py-1 text-rose-800">
                                      {humanizeProcessError(item.error)}
                                    </div>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default JobSummaryPanel;
