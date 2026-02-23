import axios, { AxiosError } from 'axios';
import { Course, Module, Slide } from '@/app/types';
import type {
  DeleteBatchRequest,
  MySlideJobSummary,
  MySlideJobsResponse,
  ProcessBatchRequest,
  UploadSlidesBatchResponse,
} from '../types';
import { normalizeDataUrl } from '../utils/slideUtils';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchCourseByIdApi = async (courseId: string): Promise<Course> => {
  const res = await axios.get(`/api/courses/by_id/${courseId}`);
  return res.data;
};

export const fetchCourseModulesApi = async (courseId: string): Promise<Module[]> => {
  const res = await axios.get(`/api/courses/by_id/${courseId}/modules`);
  return res.data?.modules ?? [];
};

export const updateCourseAuthorityApi = async (
  courseId: string,
  authority: 'public' | 'private',
): Promise<Course | null> => {
  const res = await axios.patch(`/api/courses/by_id/${courseId}/authority`, { authority });
  const data = res.data;
  if (data && typeof data === 'object') {
    if ('course' in data && data.course && typeof data.course === 'object') return data.course as Course;
    if ('authority' in data || 'course_id' in data || 'course_title' in data) return data as Course;
  }
  return null;
};

export const createCourseModuleApi = async (courseId: string, title: string): Promise<Module> => {
  const res = await axios.post(`/api/courses/by_id/${courseId}/modules`, { title });
  return res.data;
};

export const deleteModuleApi = async (moduleId: string): Promise<void> => {
  await axios.delete(`/api/modules/by_id/${moduleId}`);
};

export const fetchModuleSlidesApi = async (moduleId: string): Promise<unknown[]> => {
  const res = await axios.get(`/api/modules/${moduleId}/slides`);
  return res.data?.slides ?? [];
};

export const fetchDriveThumbnailAsBase64 = async (url: string): Promise<string | null> => {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await axios.get('/api/drive-thumbnail', {
        params: { thumbnailUrl: url },
        timeout: 20000,
      });
      return response.data?.dataUrl ?? null;
    } catch (error: unknown) {
      const status = error instanceof AxiosError ? error.response?.status : undefined;
      const isRetriable = status === 429 || (status !== undefined && status >= 500);

      if (!isRetriable || attempt === maxRetries) {
        console.error('Error fetching image:', error);
        return null;
      }

      const backoffMs = 500 * (2 ** attempt);
      await sleep(backoffMs);
    }
  }

  return null;
};

export const fetchDriveFolderFilesApi = async (folderId: string, apiKey?: string): Promise<Slide[]> => {
  try {
    const requestUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,thumbnailLink)&key=${apiKey}`;
    const res = await axios.get(requestUrl);

    const slidesInfo: Slide[] = [];
    const files: Array<{ id: string; name: string; mimeType: string; thumbnailLink?: string }> = res.data.files ?? [];

    for (const file of files) {
      const slide_cover = file.thumbnailLink ? await fetchDriveThumbnailAsBase64(file.thumbnailLink) : null;

      if (file.mimeType === 'application/vnd.google-apps.presentation') {
        const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=application/pdf&key=${apiKey}`;
        slidesInfo.push({
          slide_google_id: file.id,
          slide_title: file.name,
          slide_url: exportUrl,
          slide_cover: slide_cover ? normalizeDataUrl(slide_cover) : '',
        } as Slide);
      } else if (file.mimeType === 'application/pdf') {
        slidesInfo.push({
          slide_google_id: file.id,
          slide_title: file.name,
          slide_url: `https://drive.google.com/file/d/${file.id}/view`,
          slide_cover: slide_cover ? normalizeDataUrl(slide_cover) : '',
        } as Slide);
      }

      await sleep(120);
    }

    return slidesInfo;
  } catch (error: unknown) {
    if (error instanceof AxiosError) {
      console.error('Error fetching subfolders:', error.response?.data || error.message);
    } else {
      console.error('Unexpected error:', error);
    }
    return [];
  }
};

export const uploadModuleSlidesBatchApi = async (
  moduleId: string,
  slides: unknown[],
): Promise<{ status: number; data: UploadSlidesBatchResponse }> => {
  const res = await axios.post<UploadSlidesBatchResponse>(`/api/modules/${moduleId}/slides/batch`, { slides });
  return { status: res.status, data: res.data };
};

export const getPageImportBatchJobApi = async (jobId: string) => {
  const res = await axios.get(`/api/slides/page-import-batch/${jobId}`);
  return res.data;
};

export const getMySlideJobsApi = async (userId: string, limit = 20): Promise<MySlideJobsResponse> => {
  const res = await axios.get('/api/slides/jobs/mine', {
    params: { limit },
    headers: { 'X-User-Id': userId },
  });
  return res.data;
};

export const deleteMySlideJobApi = async (
  jobType: MySlideJobSummary['job_type'],
  jobId: string,
  userId: string,
) => {
  const normalizedType = jobType === 'page_import_batch' ? 'page_import_batch' : 'process_batch';
  const res = await axios.delete(`/api/slides/jobs/${normalizedType}/${jobId}`, {
    headers: { 'X-User-Id': userId },
  });
  return res.data;
};

export const startProcessBatchApi = async (payload: ProcessBatchRequest) => {
  const res = await axios.post('/api/slides/process-batch', payload);
  return res.data;
};

export const getProcessBatchJobApi = async (jobId: string) => {
  const res = await axios.get(`/api/slides/process-batch/${jobId}`);
  return res.data;
};

export const cancelProcessBatchJobApi = async (jobId: string): Promise<void> => {
  try {
    await axios.post(`/api/slides/process-batch/${jobId}/cancel`);
  } catch (firstError) {
    if (firstError instanceof AxiosError && firstError.response?.status === 404) {
      await axios.post(`/api/slides/process-batch/${jobId}/stop`);
      return;
    }
    throw firstError;
  }
};

export const deleteSlidesBatchApi = async (payload: DeleteBatchRequest) => {
  const res = await axios.post('/api/slides/delete-batch', payload);
  return res.data;
};
