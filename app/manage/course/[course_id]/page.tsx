'use client';

import { useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { usePathname } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import ActionButton from '@/app/components/ActionButton';
import AddSlidesModal from './components/AddSlidesModal';
import ConfirmUploadModal from './components/ConfirmUploadModal';
import CreateModuleModal from './components/CreateModuleModal';
import JobSummaryPanel from './components/JobSummaryPanel';
import ModuleSlidesSection from './components/ModuleSlidesSection';
import { Course, Module, Slide } from "@/app/types";
import { AppDispatch, RootState } from '@/app/store/store';
import {
  ProcessJobStatus,
  ProcessJobSummary,
  setJobPanelOpen,
  upsertProcessJob as upsertProcessJobAction,
} from '@/app/slices/processJobsSlice';
import {
  asBool,
  normalizeDataUrl,
  normalizeSlideFromApi,
} from './utils/slideUtils';
import {
  extractFailedDetails,
  extractSlideIdsFromResult,
  humanizeProcessError,
  isTerminalBatchJobStatus,
  normalizeBatchJobResponse,
  normalizeJobItems,
  toProcessJobStatus,
} from './utils/jobUtils';
import type {
  BatchJobResponse,
  DeleteBatchRequest,
  ProcessBatchRequest,
  UiProcessStatus,
  UploadSlidesBatchResponse,
} from './types';
import {
  cancelProcessBatchJobApi,
  createCourseModuleApi,
  deleteModuleApi,
  deleteSlidesBatchApi,
  fetchCourseByIdApi,
  fetchCourseModulesApi,
  fetchDriveFolderFilesApi,
  fetchModuleSlidesApi,
  getPageImportBatchJobApi,
  getProcessBatchJobApi,
  startProcessBatchApi,
  uploadModuleSlidesBatchApi,
} from './services/courseSlidesApi';

const CoursePage = () => {
  const JOB_POLL_INTERVAL_MS = 2000;
  const JOB_TIMEOUT_WARNING_MS = 2 * 60 * 1000;
  const pathname = usePathname();
  const dispatch = useDispatch<AppDispatch>();
  const pathnames = pathname.split('/');
  const courseId = pathnames[pathnames.length - 1];
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [slidesByModule, setSlidesByModule] = useState<Record<string, Slide[]>>({});
  const [loading, setLoading] = useState(true);

  // States for creating module and uploading slide
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false); // Modal state for creating module
  const [selectedModuleForSlide, setSelectedModuleForSlide] = useState<string | null>(null);
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [isSlideModalOpen, setIsSlideModalOpen] = useState(false);
  const [slideInfoList, setSlideInfoList] = useState<Slide[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [selectedSlidesByModule, setSelectedSlidesByModule] = useState<Record<string, string[]>>({});
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [selectionScope, setSelectionScope] = useState<'all' | string>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [slideProcessStatusById, setSlideProcessStatusById] = useState<Record<string, UiProcessStatus>>({});
  const [activePageImportJobId, setActivePageImportJobId] = useState<string | null>(null);
  const [activePageImportModuleId, setActivePageImportModuleId] = useState<string | null>(null);
  const [pageImportJobState, setPageImportJobState] = useState<BatchJobResponse | null>(null);
  const [activeProcessJobId, setActiveProcessJobId] = useState<string | null>(null);
  const [isPageImportPollingReconnecting, setIsPageImportPollingReconnecting] = useState(false);
  const [isProcessPollingReconnecting, setIsProcessPollingReconnecting] = useState(false);
  const [pageImportPollFailureCount, setPageImportPollFailureCount] = useState(0);
  const [processPollFailureCount, setProcessPollFailureCount] = useState(0);
  const [pageImportPollRestartNonce, setPageImportPollRestartNonce] = useState(0);
  const [processPollRestartNonce, setProcessPollRestartNonce] = useState(0);
  const processJobs = useSelector((state: RootState) => state.processJobs.jobs);
  const isJobPanelOpen = useSelector((state: RootState) => state.processJobs.isJobPanelOpen);
  const [jobClockMs, setJobClockMs] = useState<number>(Date.now());
  const isSyncingJobsRef = useRef(false);
  const pageImportListRefreshCounterRef = useRef(0);
  // Fetch the course details and modules when the component mounts
  useEffect(() => {
    if (courseId) {
      const fetchCourseData = async () => {
        try {
          // Fetch course details
          const courseData = await fetchCourseByIdApi(courseId);
          setCourse(courseData);

          // Fetch course modules
          const modulesData = await fetchCourseModulesApi(courseId);
          setModules(modulesData);

          setLoading(false);
        } catch (err) {
          console.error('Error fetching course or modules:', err);
          setLoading(false);
        }
      };
      fetchCourseData();
    }
  }, [courseId]);

  useEffect(() => {
    const hasRunningJobs = processJobs.some((job) => ['queued', 'processing', 'stopping'].includes(job.status));
    if (!hasRunningJobs) return;
    const timer = window.setInterval(() => setJobClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [processJobs]);


  // Helper function to extract Google Drive folder ID from the link
  const extractFolderIdFromLink = (link: string): string | null => {
    const regex = /\/folders\/([a-zA-Z0-9_-]+)/; // 正确的正则表达式，不需要引号和转义斜杠
    const match = link.match(regex);
    return match ? match[1] : null;
  };  

  // Function to delete a module
  const handleDeleteModule = async (moduleId: string) => {
    const confirmDelete = window.confirm('Are you sure you want to delete this module?');
    if (!confirmDelete) return;

    try {
      await deleteModuleApi(moduleId);
      setModules((prevModules) => prevModules.filter(module => module.module_id !== moduleId));
      alert('Module deleted successfully');
    } catch (error) {
      console.error('Error deleting module:', error);
      alert('Failed to delete module');
    }
  };

  // Fetch metadata for the files in the pasted Drive folder link
  const handleFetchSlidesFromFolder = async () => {
    const folderId = extractFolderIdFromLink(driveFolderLink);
    if (folderId) {
      const slidesInfo = await fetchDriveFolderFilesApi(folderId, process.env.NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY);
      setSlideInfoList(slidesInfo); // Store fetched slide metadata
      setShowConfirmation(true); // Trigger confirmation pop-up
    }
  };

  // Fetch slides for a specific module
  const fetchSlides = async (moduleId: string): Promise<Slide[]> => {
    try {
      const rawSlides = await fetchModuleSlidesApi(moduleId);
      const slides = rawSlides.map((slide: unknown) => normalizeSlideFromApi(slide));
      
      setSlidesByModule((prevSlides) => ({
        ...prevSlides,
        [moduleId]: slides, // Store slides by module ID
      }));
      return slides;
    } catch (err) {
      console.error('Error fetching slides:', err);
      return [];
    }
  };

  const getSelectedSlideIds = (moduleId: string) => selectedSlidesByModule[moduleId] ?? [];

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const upsertProcessJob = (jobId: string, patch: Partial<ProcessJobSummary>) => {
    const current = processJobs.find((job) => job.jobId === jobId);
    const createdAtMs = patch.createdAtMs ?? current?.createdAtMs ?? Date.now();
    const now = Date.now();
    const queuedCount = patch.queuedCount ?? current?.queuedCount ?? 0;
    const processingCount = patch.processingCount ?? current?.processingCount ?? 0;
    const processedCount = patch.processedCount ?? current?.processedCount ?? 0;
    const skippedCount = patch.skippedCount ?? current?.skippedCount ?? 0;
    const failedCount = patch.failedCount ?? current?.failedCount ?? 0;
    const cancelledCount = patch.cancelledCount ?? current?.cancelledCount ?? 0;
    const progressSignature = `${queuedCount}|${processingCount}|${processedCount}|${skippedCount}|${failedCount}|${cancelledCount}`;
    const itemsUpdatedSignature = patch.lastItemsUpdatedSignature ?? current?.lastItemsUpdatedSignature ?? '';
    const progressChanged =
      progressSignature !== (current?.lastProgressSignature ?? '') ||
      itemsUpdatedSignature !== (current?.lastItemsUpdatedSignature ?? '');
    const nextJob: ProcessJobSummary = {
      jobId,
      status: patch.status ?? current?.status ?? 'queued',
      createdAtMs,
      finishedAtMs: patch.finishedAtMs ?? current?.finishedAtMs,
      queuedCount,
      processingCount,
      processedCount,
      skippedCount,
      failedCount,
      cancelledCount,
      totalCount: patch.totalCount ?? current?.totalCount ?? 0,
      cancelRequested: patch.cancelRequested ?? current?.cancelRequested ?? false,
      scopeLabel: patch.scopeLabel ?? current?.scopeLabel ?? selectionScope,
      forceProcessAll: patch.forceProcessAll ?? current?.forceProcessAll ?? false,
      failedDetails: patch.failedDetails ?? current?.failedDetails ?? [],
      processingSlideIds: patch.processingSlideIds ?? current?.processingSlideIds ?? [],
      items: patch.items ?? current?.items ?? [],
      lastProgressSignature: progressSignature,
      lastItemsUpdatedSignature: itemsUpdatedSignature,
      lastProgressChangeAtMs: progressChanged ? now : (patch.lastProgressChangeAtMs ?? current?.lastProgressChangeAtMs ?? createdAtMs),
    };
    dispatch(upsertProcessJobAction(nextJob));
  };

  const formatJobDuration = (job: ProcessJobSummary) => {
    const endMs = job.finishedAtMs ?? jobClockMs;
    const deltaSeconds = Math.max(0, Math.floor((endMs - job.createdAtMs) / 1000));
    const mm = Math.floor(deltaSeconds / 60);
    const ss = deltaSeconds % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  };

  const slideTitleById = Object.values(slidesByModule).flat().reduce<Record<string, string>>((acc, slide) => {
    if (slide.id) acc[slide.id] = slide.slide_title || slide.id;
    return acc;
  }, {});

  const getVisionStatus = (slide: Slide): UiProcessStatus => {
    const jobStatus = slideProcessStatusById[slide.id];
    if (jobStatus) {
      return jobStatus;
    }
    const s = slide as unknown as Record<string, unknown>;
    const gotVision = asBool(s.gotVision ?? s.got_vision ?? s.has_vision ?? s.hasVision ?? s.vision_ready);
    const isVisionProcessing = asBool(s.gettingVision ?? s.getting_vision) || asBool(s.updatingVision ?? s.updating_vision);
    if (isVisionProcessing) {
      return 'Processing';
    }
    if (gotVision) {
      return 'Processed';
    }
    return 'Unprocessed';
  };

  const getVectorStatus = (slide: Slide): UiProcessStatus => {
    const jobStatus = slideProcessStatusById[slide.id];
    if (jobStatus === 'Processing') {
      return 'Processing';
    }
    const s = slide as unknown as Record<string, unknown>;
    const gotVectors = asBool((s as { gotVectors?: unknown; got_vectors?: unknown; hasVectors?: unknown; has_vectors?: unknown }).gotVectors
      ?? (s as { got_vectors?: unknown }).got_vectors
      ?? (s as { hasVectors?: unknown }).hasVectors
      ?? (s as { has_vectors?: unknown }).has_vectors);
    const isVectorProcessing = asBool(s.updatingVectors ?? s.updating_vectors);
    if (isVectorProcessing) {
      return 'Processing';
    }
    if (gotVectors) {
      return 'Processed';
    }
    return 'Unprocessed';
  };

  const setProcessStatusForSlides = (slideIds: string[], status: UiProcessStatus) => {
    if (slideIds.length === 0) return;
    setSlideProcessStatusById((prev) => {
      const next = { ...prev };
      slideIds.forEach((id) => {
        next[id] = status;
      });
      return next;
    });
  };

  const syncPageImportJob = async (jobId: string, moduleId?: string) => {
    const job = normalizeBatchJobResponse(await getPageImportBatchJobApi(jobId));
    setPageImportJobState(job);
    setActivePageImportJobId(job.job_id || jobId);

    pageImportListRefreshCounterRef.current += 1;
    if (moduleId && (isTerminalBatchJobStatus(job.status) || pageImportListRefreshCounterRef.current % 3 === 0)) {
      await fetchSlides(moduleId);
    }

    if (isTerminalBatchJobStatus(job.status)) {
      if (moduleId) {
        await fetchSlides(moduleId);
      }
      setActivePageImportJobId(null);
      setActivePageImportModuleId(null);
      if (job.status === 'completed') {
        showToast(`Page import completed: ${job.processed_count} processed, ${job.skipped_count} skipped, ${job.failed_count} failed.`);
      } else if (job.status === 'failed') {
        showToast(`Page import failed: ${job.failed_count} item(s) failed.`);
      } else if (job.status === 'cancelled') {
        showToast('Page import job cancelled.');
      }
    }

    return job.status;
  };

  const syncSingleJob = async (jobId: string, moduleIds: string[]): Promise<ProcessJobStatus> => {
    const data = (await getProcessBatchJobApi(jobId)) ?? {};
    const items = normalizeJobItems(data.items);
    const processedIds = extractSlideIdsFromResult(data.processed);
    const skippedIds = extractSlideIdsFromResult(data.skipped);
    const failedIds = extractSlideIdsFromResult(data.failed);
    const processingIdsFromItems = items.filter((item) => item.status === 'processing').map((item) => item.slideId);
    const queuedIdsFromItems = items.filter((item) => item.status === 'queued').map((item) => item.slideId);
    const processedIdsFromItems = items.filter((item) => item.status === 'processed').map((item) => item.slideId);
    const skippedIdsFromItems = items.filter((item) => item.status === 'skipped').map((item) => item.slideId);
    const failedIdsFromItems = items.filter((item) => item.status === 'failed').map((item) => item.slideId);
    const cancelledIdsFromItems = items.filter((item) => item.status === 'cancelled').map((item) => item.slideId);
    const failedDetailsFromItems = items
      .filter((item) => item.status === 'failed' && item.error)
      .map((item) => ({ slideId: item.slideId, error: item.error as string }));
    const failedDetails = failedDetailsFromItems.length > 0 ? failedDetailsFromItems : extractFailedDetails(data.failed);

    const resolvedProcessedIds = Array.from(new Set([...processedIds, ...processedIdsFromItems]));
    const resolvedSkippedIds = Array.from(new Set([...skippedIds, ...skippedIdsFromItems]));
    const resolvedFailedIds = Array.from(new Set([...failedIds, ...failedIdsFromItems, ...cancelledIdsFromItems]));
    const resolvedProcessingIds = Array.from(new Set([...(Array.isArray(data.processing) ? extractSlideIdsFromResult(data.processing) : []), ...processingIdsFromItems]));

    setProcessStatusForSlides(resolvedProcessingIds, 'Processing');
    setProcessStatusForSlides(resolvedProcessedIds, 'Processed');
    setProcessStatusForSlides([...resolvedSkippedIds, ...resolvedFailedIds, ...queuedIdsFromItems], 'Unprocessed');

    const status = String(data.status ?? '').toLowerCase();
    const jobStatus = toProcessJobStatus(status || 'processing');
    const processed = Number(data.processed_count ?? resolvedProcessedIds.length ?? 0);
    const skipped = Number(data.skipped_count ?? resolvedSkippedIds.length ?? 0);
    const failed = Number(data.failed_count ?? resolvedFailedIds.length ?? 0);
    const queued = Number(data.queued_count ?? items.filter((item) => item.status === 'queued').length ?? 0);
    const processing = Number(data.processing_count ?? resolvedProcessingIds.length ?? 0);
    const cancelled = Number(data.cancelled_count ?? cancelledIdsFromItems.length ?? 0);
    const total = Number(data.total_count ?? processed + skipped + failed + queued + processing + cancelled);
    const itemsUpdatedSignature = items.map((item) => `${item.slideId}:${item.status}:${item.updatedAt ?? ''}:${item.retryCount}`).sort().join('|');

    upsertProcessJob(jobId, {
      status: jobStatus,
      queuedCount: queued,
      processingCount: processing,
      processedCount: processed,
      skippedCount: skipped,
      failedCount: failed,
      cancelledCount: cancelled,
      totalCount: total,
      cancelRequested: Boolean(data.cancel_requested ?? false),
      failedDetails,
      processingSlideIds: resolvedProcessingIds,
      items,
      lastItemsUpdatedSignature: itemsUpdatedSignature,
      finishedAtMs: ['completed', 'failed', 'cancelled'].includes(jobStatus) ? Date.now() : undefined,
    });

    if (['completed', 'failed', 'cancelled'].includes(jobStatus)) {
      if (activeProcessJobId === jobId) {
        setActiveProcessJobId(null);
      }
      const firstError = humanizeProcessError(failedDetails[0]?.error);
      showToast(
        firstError
          ? `Processed ${processed}, Skipped ${skipped}, Failed ${failed}, Cancelled ${cancelled}. First error: ${firstError}`
          : `Processed ${processed}, Skipped ${skipped}, Failed ${failed}, Cancelled ${cancelled}`
      );
      await Promise.all(moduleIds.map((moduleId) => fetchSlides(moduleId)));
    }
    return jobStatus;
  };

  const handleStopJob = async (jobId: string) => {
    upsertProcessJob(jobId, { status: 'stopping', cancelRequested: true });
    try {
      await cancelProcessBatchJobApi(jobId);
      showToast(`Cancel requested for job ${jobId}.`);
    } catch (error) {
      console.error('Error stopping job:', error);
      upsertProcessJob(jobId, { status: 'processing', cancelRequested: false });
      showToast(`Failed to stop job ${jobId}.`);
    }
  };

  const toggleSlideSelection = (moduleId: string, slideId: string) => {
    setSelectedSlidesByModule((prev) => {
      const current = prev[moduleId] ?? [];
      const next = current.includes(slideId)
        ? current.filter((id) => id !== slideId)
        : [...current, slideId];
      return { ...prev, [moduleId]: next };
    });
  };

  const toggleSelectAllForModule = (moduleId: string, slides: Slide[]) => {
    const moduleSlideIds = slides.map((slide) => slide.id);
    setSelectedSlidesByModule((prev) => {
      const current = prev[moduleId] ?? [];
      const allSelected = moduleSlideIds.length > 0 && moduleSlideIds.every((id) => current.includes(id));
      return {
        ...prev,
        [moduleId]: allSelected ? [] : moduleSlideIds,
      };
    });
  };

  const clearSelectionForModule = (moduleId: string) => {
    setSelectedSlidesByModule((prev) => ({ ...prev, [moduleId]: [] }));
  };

  const ensureSlidesLoaded = async (moduleId: string): Promise<Slide[]> => {
    if (slidesByModule[moduleId]) {
      return slidesByModule[moduleId];
    }
    return fetchSlides(moduleId);
  };

  const getScopeSelectedSlideIds = () => {
    if (selectionScope === 'all') {
      return Array.from(new Set(Object.values(selectedSlidesByModule).flat()));
    }
    return getSelectedSlideIds(selectionScope);
  };

  const getScopeModuleIds = () => {
    if (selectionScope === 'all') {
      return Object.keys(selectedSlidesByModule).filter((moduleId) => (selectedSlidesByModule[moduleId] ?? []).length > 0);
    }
    return [selectionScope];
  };

  const clearSelectionForScope = () => {
    if (selectionScope === 'all') {
      setSelectedSlidesByModule({});
      return;
    }
    clearSelectionForModule(selectionScope);
  };

  const handleSelectAllForScope = async () => {
    if (selectionScope === 'all') {
      const moduleEntries = await Promise.all(
        modules.map(async (module) => {
          const slides = await ensureSlidesLoaded(module.module_id);
          return [module.module_id, slides.map((slide) => slide.id)] as const;
        })
      );
      const next: Record<string, string[]> = {};
      moduleEntries.forEach(([moduleId, slideIds]) => {
        next[moduleId] = slideIds;
      });
      setSelectedSlidesByModule(next);
      return;
    }

    const slides = await ensureSlidesLoaded(selectionScope);
    toggleSelectAllForModule(selectionScope, slides);
  };

  const handleProcessBatch = async (forceProcessAll: boolean) => {
    const slideIds = getScopeSelectedSlideIds();
    const moduleIds = getScopeModuleIds();
    if (slideIds.length === 0) return;

    setBatchActionLoading(true);
    setProcessStatusForSlides(slideIds, 'Processing');
    try {
      const payload: ProcessBatchRequest = {
        slide_ids: slideIds,
        force_process_all: forceProcessAll,
      };
      const data = await startProcessBatchApi(payload);
      const jobId = data?.job_id || data?.batch_job_id;
      if (jobId) {
        const processJobId = String(jobId);
        const initialJobStatus = toProcessJobStatus(String(data?.status ?? 'queued'));
        setActiveProcessJobId(processJobId);
        upsertProcessJob(processJobId, {
          status: initialJobStatus,
          createdAtMs: Date.now(),
          queuedCount: slideIds.length,
          processingCount: 0,
          processedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          cancelledCount: 0,
          totalCount: slideIds.length,
          cancelRequested: false,
          scopeLabel: selectionScope,
          forceProcessAll,
          failedDetails: [],
          processingSlideIds: [],
          items: [],
          lastItemsUpdatedSignature: '',
        });
        clearSelectionForScope();
        dispatch(setJobPanelOpen(true));
        let syncedStatus: ProcessJobStatus = initialJobStatus;
        try {
          syncedStatus = await syncSingleJob(processJobId, moduleIds);
        } catch (syncError) {
          console.error('Failed to sync process job immediately after creation:', syncError);
        }
        if (!['completed', 'failed', 'cancelled'].includes(syncedStatus)) {
          showToast(`Job created: ${jobId}`);
        }
      } else {
        const processed = Number(data?.processed_count ?? 0);
        const skipped = Number(data?.skipped_count ?? 0);
        const failed = Number(data?.failed_count ?? 0);
        const cancelled = Number(data?.cancelled_count ?? 0);
        const firstError = humanizeProcessError(extractFailedDetails(data?.failed)[0]?.error);
        showToast(
          firstError
            ? `Processed ${processed}, Skipped ${skipped}, Failed ${failed}, Cancelled ${cancelled}. First error: ${firstError}`
            : `Processed ${processed}, Skipped ${skipped}, Failed ${failed}, Cancelled ${cancelled}`
        );
        await Promise.all(moduleIds.map((moduleId) => fetchSlides(moduleId)));
        setProcessStatusForSlides(extractSlideIdsFromResult(data?.processed), 'Processed');
        setProcessStatusForSlides(
          [...extractSlideIdsFromResult(data?.skipped), ...extractSlideIdsFromResult(data?.failed)],
          'Unprocessed'
        );
      }
      clearSelectionForScope();
    } catch (error) {
      console.error('Error processing slides in batch:', error);
      showToast('Failed to process selected slides.');
      setProcessStatusForSlides(slideIds, 'Unprocessed');
    } finally {
      setBatchActionLoading(false);
    }
  };

  useEffect(() => {
    if (!activePageImportJobId) return;
    let cancelled = false;
    let timeoutId: number | undefined;
    let consecutiveFailures = 0;

    const tick = async () => {
      if (cancelled || !activePageImportJobId) return;
      try {
        const status = await syncPageImportJob(activePageImportJobId, activePageImportModuleId ?? undefined);
        consecutiveFailures = 0;
        setPageImportPollFailureCount(0);
        setIsPageImportPollingReconnecting(false);
        if (!cancelled && !isTerminalBatchJobStatus(status)) {
          timeoutId = window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
        }
      } catch (error) {
        consecutiveFailures += 1;
        setPageImportPollFailureCount(consecutiveFailures);
        setIsPageImportPollingReconnecting(true);
        console.error('Failed to sync page import job:', error);
        if (!cancelled && consecutiveFailures < 10) {
          timeoutId = window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
        } else if (!cancelled) {
          showToast(`Page import polling paused after ${consecutiveFailures} failed attempts.`);
        }
      }
    };

    timeoutId = window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [activePageImportJobId, activePageImportModuleId, pageImportPollRestartNonce]);

  useEffect(() => {
    const runningJobs = processJobs.filter((job) => ['queued', 'processing', 'stopping'].includes(job.status));
    if (runningJobs.length === 0) {
      setIsProcessPollingReconnecting(false);
      setProcessPollFailureCount(0);
      return;
    }
    let cancelled = false;
    let timeoutId: number | undefined;
    let consecutiveFailures = 0;

    const tick = async () => {
      if (cancelled || isSyncingJobsRef.current) return;
      isSyncingJobsRef.current = true;
      try {
        for (const job of runningJobs) {
          const moduleIds = job.scopeLabel === 'all'
            ? modules.map((m) => m.module_id)
            : [job.scopeLabel];
          await syncSingleJob(job.jobId, moduleIds);
        }
        consecutiveFailures = 0;
        setProcessPollFailureCount(0);
        setIsProcessPollingReconnecting(false);
      } catch (error) {
        consecutiveFailures += 1;
        setProcessPollFailureCount(consecutiveFailures);
        setIsProcessPollingReconnecting(true);
        console.error('Failed to sync running jobs:', error);
      } finally {
        isSyncingJobsRef.current = false;
        if (!cancelled) {
          if (consecutiveFailures < 10) {
            timeoutId = window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
          } else {
            showToast(`Process polling paused after ${consecutiveFailures} failed attempts.`);
          }
        }
      }
    };

    timeoutId = window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [processJobs, modules, processPollRestartNonce]);

  const handleDeleteBatch = async () => {
    const slideIds = getScopeSelectedSlideIds();
    const moduleIds = getScopeModuleIds();
    if (slideIds.length === 0) return;

    const confirmed = window.confirm(`Delete ${slideIds.length} selected slide(s)? This cannot be undone.`);
    if (!confirmed) return;

    setBatchActionLoading(true);
    try {
      const payload: DeleteBatchRequest = { slide_ids: slideIds };
      const data = await deleteSlidesBatchApi(payload);
      const deletedCount = Number(data?.deleted_count ?? 0);
      showToast(`Deleted ${deletedCount} slide(s).`);
      await Promise.all(moduleIds.map((moduleId) => fetchSlides(moduleId)));
      clearSelectionForScope();
    } catch (error) {
      console.error('Error deleting slides in batch:', error);
      showToast('Failed to delete selected slides.');
    } finally {
      setBatchActionLoading(false);
    }
  };

  // Submit fetched slides metadata to the backend
  const handleCreateSlides = async () => {
    if (!selectedModuleForSlide || slideInfoList.length === 0) return;
    const uploadSlides = slideInfoList.map((slide, index) => {
      const normalizedCover = slide.slide_cover ? normalizeDataUrl(slide.slide_cover) : '';
      return {
        slide_google_id: slide.slide_google_id,
        slide_title: slide.slide_title,
        slide_url: slide.slide_url,
        slide_cover: normalizedCover,
        // Compatibility aliases for backend schema variants
        google_id: slide.slide_google_id,
        title: slide.slide_title,
        url: slide.slide_url,
        cover: normalizedCover,
        // Common defaults when backend model requires non-null flags/order
        gotVision: false,
        slide_order: index,
      };
    });

    try {
      const res = await uploadModuleSlidesBatchApi(selectedModuleForSlide, uploadSlides);
  
      if (res.status === 201) {
        const pageImportJobId = res.data?.page_import_job_id ? String(res.data.page_import_job_id) : null;
        if (pageImportJobId) {
          setActivePageImportJobId(pageImportJobId);
          setActivePageImportModuleId(selectedModuleForSlide);
          pageImportListRefreshCounterRef.current = 0;
          setPageImportJobState(null);
        }
        await fetchSlides(selectedModuleForSlide);
        setIsSlideModalOpen(false);
        setShowConfirmation(false);
        showToast(
          pageImportJobId
            ? `Slides uploaded. Page import started in background (${Number(res.data?.page_import_jobs_queued ?? slideInfoList.length)} jobs).`
            : 'Slides uploaded successfully!'
        );
      }
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        const detail = typeof error.response?.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response?.data);
        console.error('Error uploading slides:', status, error.response?.data);

        if (status === 500) {
          try {
            const slidesWithoutCover = uploadSlides.map((slide) => ({ ...slide, slide_cover: '' }));
            const retryRes = await uploadModuleSlidesBatchApi(selectedModuleForSlide, slidesWithoutCover);

            if (retryRes.status === 201) {
              const retryPageImportJobId = retryRes.data?.page_import_job_id ? String(retryRes.data.page_import_job_id) : null;
              if (retryPageImportJobId) {
                setActivePageImportJobId(retryPageImportJobId);
                setActivePageImportModuleId(selectedModuleForSlide);
                pageImportListRefreshCounterRef.current = 0;
                setPageImportJobState(null);
              }
              await fetchSlides(selectedModuleForSlide);
              setIsSlideModalOpen(false);
              setShowConfirmation(false);
              showToast(
                retryPageImportJobId
                  ? `Slides uploaded (without thumbnail cover). Page import started in background (${Number(retryRes.data?.page_import_jobs_queued ?? slideInfoList.length)} jobs).`
                  : 'Slides uploaded successfully (without thumbnail cover).'
              );
              return;
            }
          } catch (retryError: unknown) {
            if (retryError instanceof AxiosError) {
              const retryDetail = typeof retryError.response?.data === 'string'
                ? retryError.response.data
                : JSON.stringify(retryError.response?.data);
              alert(`Failed to upload slides (with and without cover). status=${retryError.response?.status ?? 'unknown'} detail=${retryDetail ?? retryError.message}`);
              return;
            }
          }
        }

        alert(`Failed to upload slides. status=${status ?? 'unknown'} detail=${detail ?? error.message}`);
      } else {
        console.error('Error uploading slides:', error);
        alert('Failed to upload slides.');
      }
    }
  };
  
  // Check if slides have been loaded for the module
  const handleModuleClick = (moduleId: string) => {
    if (!slidesByModule[moduleId]) {
      fetchSlides(moduleId); // Fetch slides only if not already fetched
    }
  };

  // Handle creating a new module
  const handleCreateModule = async () => {
    try {
      const moduleData = await createCourseModuleApi(courseId, newModuleTitle);

      setModules([...modules, moduleData]); // Add the new module to the list
      setNewModuleTitle(''); // Reset input field
      setIsModalOpen(false); // Close modal after creation
    } catch (error) {
      console.error('Error creating module:', error);
    }
  };

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!course) {
    return <p>Course not found</p>;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <ActionButton
        onClick={() => dispatch(setJobPanelOpen(!isJobPanelOpen))}
        className="fixed right-4 top-16 z-[70] rounded-full border-slate-800 bg-slate-800 text-white hover:bg-slate-900"
        variant="neutral"
        size="sm"
      >
        {isJobPanelOpen ? 'Hide Jobs' : `Jobs (${processJobs.length})`}
      </ActionButton>
      <JobSummaryPanel
        isOpen={isJobPanelOpen}
        jobs={processJobs}
        jobClockMs={jobClockMs}
        jobTimeoutWarningMs={JOB_TIMEOUT_WARNING_MS}
        slideTitleById={slideTitleById}
        formatJobDuration={formatJobDuration}
        onClose={() => dispatch(setJobPanelOpen(false))}
        onStopJob={handleStopJob}
      />
      {toastMessage && (
        <div className="fixed top-20 right-4 z-[60] rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-2 text-sm text-white shadow-xl backdrop-blur-sm">
          {toastMessage}
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
      <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Course
            </p>
            <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
              {course.course_title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
              {course.course_description ? course.course_description : 'No description provided.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-2 px-0 py-1 text-xs text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                Created at: {course.created_at}
              </div>
            </div>
          </div>
          <div className="shrink-0 md:pt-1">
            <ActionButton
              onClick={async () => {
                // await handlePublish()
              }}
              variant="primary"
              className="rounded-lg px-3.5 py-2"
            >
              Publish Course
            </ActionButton>
          </div>
        </div>
      </section>
      {/* Module Management */}
      <section className="">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Modules</h2>
            <p className="text-sm text-slate-500">Manage slides, batch processing jobs, and module-level imports with a consistent workflow.</p>
          </div>
          <ActionButton
            onClick={() => setIsModalOpen(true)}
            variant="primary"
            className="rounded-lg px-3.5 py-2"
          >
            Create New Module
          </ActionButton>
        </div>
        
        {modules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 shadow-sm">
            No modules available.
          </div>
        ) : (
          <>
            <div className="mb-5 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm ring-1 ring-white">
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectionScope('all')}
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium border ${
                    selectionScope === 'all'
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  All Modules
                </button>
                {modules.map((module) => (
                  <button
                    key={`scope-${module.module_id}`}
                    onClick={() => setSelectionScope(module.module_id)}
                    className={`inline-flex max-w-full items-center rounded-full px-3 py-1.5 text-sm font-medium border ${
                      selectionScope === module.module_id
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate max-w-[220px]">{module.module_title}</span>
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50/70 p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {getScopeSelectedSlideIds().length > 0 && (
                      <>
                        <ActionButton
                          onClick={() => handleProcessBatch(false)}
                          disabled={batchActionLoading || getScopeSelectedSlideIds().length === 0}
                          variant="primary"
                          size="sm"
                          className="rounded-xl"
                        >
                          Process Missing Info ({getScopeSelectedSlideIds().length})
                        </ActionButton>
                        <ActionButton
                          onClick={() => handleProcessBatch(true)}
                          disabled={batchActionLoading || getScopeSelectedSlideIds().length === 0}
                          variant="secondary"
                          size="sm"
                          className="rounded-xl"
                        >
                          Reprocess All ({getScopeSelectedSlideIds().length})
                        </ActionButton>
                        <ActionButton
                          onClick={handleDeleteBatch}
                          disabled={batchActionLoading || getScopeSelectedSlideIds().length === 0}
                          variant="danger"
                          size="sm"
                          className="rounded-xl"
                        >
                          Delete
                        </ActionButton>
                        <div className="w-full text-xs text-slate-500 lg:w-auto">
                          <span className="font-medium text-slate-700">Process Missing Info:</span> fill missing data only.{' '}
                          <span className="font-medium text-slate-700">Reprocess All:</span> recompute vision, summary, and vectors.
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <ActionButton
                      onClick={handleSelectAllForScope}
                      disabled={batchActionLoading}
                      variant="neutral"
                      size="sm"
                      className="rounded-xl"
                    >
                      {selectionScope === 'all' ? 'Select All Slides (All Modules)' : 'Select All Slides (Selected Module)'}
                    </ActionButton>
                    <ActionButton
                      onClick={clearSelectionForScope}
                      disabled={batchActionLoading}
                      variant="ghost"
                      size="sm"
                      className="rounded-xl"
                    >
                      Clear Selection
                    </ActionButton>
                  </div>
                </div>
              </div>

            </div>

            <div className="space-y-4">
              {modules.map((module) => {
                const moduleSlides = slidesByModule[module.module_id] ?? [];
                const selectedIds = getSelectedSlideIds(module.module_id);

                return (
                  <ModuleSlidesSection
                    key={module.module_id}
                    module={module}
                    slides={moduleSlides}
                    selectedIds={selectedIds}
                    batchActionLoading={batchActionLoading}
                    onModuleClick={handleModuleClick}
                    onRequestAddSlides={(moduleId) => {
                      setSelectedModuleForSlide(moduleId);
                      setIsSlideModalOpen(true);
                    }}
                    onDeleteModule={handleDeleteModule}
                    onToggleSlideSelection={toggleSlideSelection}
                  />
              )})}
            </div>
          </>
        )}
      </section>

      <AddSlidesModal
        isOpen={isSlideModalOpen && !showConfirmation}
        driveFolderLink={driveFolderLink}
        onChangeDriveFolderLink={setDriveFolderLink}
        onCancel={() => setIsSlideModalOpen(false)}
        onFetch={handleFetchSlidesFromFolder}
      />

      <CreateModuleModal
        isOpen={isModalOpen}
        newModuleTitle={newModuleTitle}
        onChangeTitle={setNewModuleTitle}
        onCancel={() => setIsModalOpen(false)}
        onCreate={handleCreateModule}
      />

      <ConfirmUploadModal
        isOpen={isSlideModalOpen && showConfirmation}
        slides={slideInfoList}
        onCancel={() => {
          setShowConfirmation(false);
          setIsSlideModalOpen(false);
        }}
        onUpload={handleCreateSlides}
      />
      </div>
    </main>
  );
};

export default CoursePage;
