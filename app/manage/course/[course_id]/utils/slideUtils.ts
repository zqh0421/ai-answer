import { Slide } from '@/app/types';
import type { RawInfoStatus, UiProcessStatus } from '../types';

export const asBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  return false;
};

export const normalizeSlideFromApi = (raw: unknown): Slide => {
  const s = (raw ?? {}) as Record<string, unknown>;
  const gotVision = asBool(s.gotVision ?? s.got_vision ?? s.has_vision ?? s.hasVision ?? s.vision_ready);
  const gotVectors = asBool(s.gotVectors ?? s.got_vectors ?? s.hasVectors ?? s.has_vectors ?? s.vectors_ready ?? s.vector_ready ?? s.has_embeddings);
  const rawInfoProgressValue = s.rawInfoProgress ?? s.raw_info_progress;
  const rawInfoProgress =
    rawInfoProgressValue && typeof rawInfoProgressValue === 'object'
      ? {
          total_steps: Number((rawInfoProgressValue as Record<string, unknown>).total_steps ?? (rawInfoProgressValue as Record<string, unknown>).totalSteps ?? 0),
          completed_steps: Number((rawInfoProgressValue as Record<string, unknown>).completed_steps ?? (rawInfoProgressValue as Record<string, unknown>).completedSteps ?? 0),
          current_step_label:
            (rawInfoProgressValue as Record<string, unknown>).current_step_label != null
              ? String((rawInfoProgressValue as Record<string, unknown>).current_step_label)
              : (rawInfoProgressValue as Record<string, unknown>).currentStepLabel != null
                ? String((rawInfoProgressValue as Record<string, unknown>).currentStepLabel)
                : null,
          error:
            (rawInfoProgressValue as Record<string, unknown>).error != null
              ? String((rawInfoProgressValue as Record<string, unknown>).error)
              : null,
        }
      : null;
  const rawInfoStatus = String(s.rawInfoStatus ?? s.raw_info_status ?? 'not_started').toLowerCase() as RawInfoStatus;

  return {
    ...(s as unknown as Slide),
    id: String(s.id ?? ''),
    slide_title: String(s.slide_title ?? s.title ?? ''),
    slide_google_id: String(s.slide_google_id ?? s.google_id ?? ''),
    slide_url: String(s.slide_url ?? s.url ?? ''),
    slide_cover: String(s.slide_cover ?? s.cover ?? ''),
    gotVision,
    gotVectors,
    gettingVision: asBool(s.gettingVision ?? s.getting_vision),
    updatingVision: asBool(s.updatingVision ?? s.updating_vision),
    updatingVectors: asBool(s.updatingVectors ?? s.updating_vectors),
    pageCount: Number(s.pageCount ?? s.page_count ?? 0),
    rawInfoStatus,
    rawInfoProgress,
    ...(gotVectors ? ({ gotVectors: true, hasVectors: true } as unknown as Slide) : {}),
  };
};

export const getSlideProcessBadgeStatus = (slide: Slide): UiProcessStatus => {
  const s = slide as unknown as Record<string, unknown>;
  const gotVision = asBool(s.gotVision ?? s.got_vision);
  const gotVectors = asBool(s.gotVectors ?? s.got_vectors ?? s.hasVectors ?? s.has_vectors);
  if (gotVision && gotVectors) return 'Processed';
  if (gotVision || gotVectors) return 'Partial';
  return 'Unprocessed';
};

export const normalizeDataUrl = (dataUrl: string): string => {
  const marker = 'base64,';
  const markerIndex = dataUrl.indexOf(marker);
  if (markerIndex === -1) return dataUrl;
  return `data:image/jpeg;base64,${dataUrl.slice(markerIndex + marker.length)}`;
};

export const getSlideGoogleOpenUrl = (slide: Slide): string => {
  const slideUrl = String(slide.slide_url ?? '');
  const googleId = String(slide.slide_google_id ?? '');

  if (!googleId) return slideUrl;

  if (slideUrl.includes('/export?mimeType=application/pdf') || slideUrl.includes('/drive/v3/files/')) {
    return `https://docs.google.com/presentation/d/${googleId}/edit`;
  }

  return `https://drive.google.com/file/d/${googleId}/view`;
};
