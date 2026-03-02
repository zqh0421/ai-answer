"use client";
import axios from "axios";
import { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import ActionButton from "@/app/components/ActionButton";
import { Slide } from "@/app/types";
import ContentEditor from "@/app/components/ContentEditor";
import DynamicImage from "@/app/components/DynamicImage";
import ManageDataTable, { ManageTableColumn } from "@/app/components/manage/ManageDataTable";
import ManageListPanel from "@/app/components/manage/ManageListPanel";
import ManageModal from "@/app/components/manage/ManageModal";
import { useManagePermissionGuard } from "@/app/manage/hooks/useManagePermissionGuard";
import { formatDateTimeForUser } from "@/app/utils/datetime";
import { buildStaticPageTitle } from "@/app/utils/title";

export interface QuestionContent {
  type: string; // text, image, etc.
  content: string;
}

export interface MCQOption {
  text: string;
  feedback: string;
}

type CreateQuestionType = "single_choice" | "free_text";
type QuestionAccessScope = "private" | "public";
type ContentBlockType = "text" | "image" | "instruction" | "latex" | "html";
type SemanticQuestionType =
  | "single_choice"
  | "multi_choice"
  | "dropdown"
  | "true_false"
  | "free_text"
  | "essay";

type ContentBlockDraft = {
  block_type: ContentBlockType;
  text_content?: string;
  media_url?: string;
  alt_text?: string;
};

interface Course {
  course_id: string;
  course_title?: string;
}

interface Module {
  module_id: string;
  module_title?: string;
}

type QuestionSlideScopeEntry = {
  slide_scope_id?: string;
  slide_id: string;
  page_start?: number | null;
  page_end?: number | null;
  course_id?: string;
  course_title?: string;
  module_id?: string;
  module_title?: string;
  slide_title?: string;
};

export interface Question {
  question_id: string;
  question_version_id?: string;
  type: string; // "multiple choice" | "open ended"
  question_type_raw?: string;
  access_scope?: "public" | "private" | string;
  objective?: string[];
  slide_ids?: string[];
  slide_scope?: QuestionSlideScopeEntry[];
  created_at?: string;
  content: QuestionContent[];
  options?: Array<{ interaction_option_id?: string; text: string; isCorrect: boolean }>;
  mcq_human_feedback?: string[];
  feedback_links?: QuestionFeedbackLinkDraftSource[];
  text_preview?: string;
  content_block_count?: number;
  content_preview_nodes?: Array<{ block_type: string; preview: string }>;
  image_preview_url?: string;
}

interface SemanticQuestionListResponse {
  items?: any[];
  questions?: any[];
  results?: any[];
  data?: any[];
  total?: number;
  count?: number;
  limit?: number;
  offset?: number;
}

interface QuestionManageFeedbackAgent {
  agent_id: string;
  title?: string;
  role?: string;
  provider?: string;
  model?: string;
  access_scope?: string;
  prompt_text?: string;
  inputs?: Array<string | { input_key?: string }>;
  created_at?: string;
  updated_at?: string;
}

interface BatchQuestionMutationFailure {
  question_id?: string;
  code?: string;
  message?: string;
}

interface BatchQuestionMutationResponse {
  ok?: boolean;
  requested_count?: number;
  success_count?: number;
  failed_count?: number;
  success_ids?: string[];
  failed?: BatchQuestionMutationFailure[];
  queued_feedback_generation?: Array<{ question_id?: string; feedback_link_id?: string; job_id?: string }>;
  enqueue_failed?: Array<{ question_id?: string; message?: string; code?: string }>;
}

type QuestionFeedbackLinkDraftSource = {
  agent_id?: string;
  agent_title?: string;
  target_type?: string;
  target_id?: string;
  static_feedback_text?: string;
  generation_status?: string;
};

type PaginationToken = number | "ellipsis";
type SortKey = "type" | "preview" | "created_at";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 20;
const QUESTION_PREVIEW_LENGTH = 140;
const USER_ID_REGEX = /^us_[A-Za-z0-9]{13}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PROMPT_TEXT: Record<SemanticQuestionType, string> = {
  single_choice: "Multiple Choice Question - Select the best option.",
  multi_choice: "Multiple Choice Question - Choose all that apply.",
  dropdown: "Dropdown Question - Select the best option.",
  true_false: "True/False Question - Select true or false.",
  free_text: "Short Answer Question - Enter your response.",
  essay: "Essay Question - Write your response.",
};

const getPaginationTokens = (currentPage: number, totalPages: number): PaginationToken[] => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const tokens: PaginationToken[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  if (start > 2) tokens.push("ellipsis");
  for (let page = start; page <= end; page += 1) tokens.push(page);
  if (end < totalPages - 1) tokens.push("ellipsis");
  tokens.push(totalPages);
  return tokens;
};

const getQuestionTextPreview = (question: Question) => {
  const text = question.content?.find((item) => item.type === "text")?.content?.trim() ?? "";
  if (text) {
    return text.length > QUESTION_PREVIEW_LENGTH
      ? `${text.slice(0, QUESTION_PREVIEW_LENGTH)}...`
      : text;
  }
  return "-";
};

const getQuestionImagePreview = (question: Question) =>
  question.image_preview_url ?? question.content?.find((item) => item.type === "image")?.content ?? "";

const formatCreatedAt = (value?: string) => formatDateTimeForUser(value);
const formatDateTime = (value?: string) => formatDateTimeForUser(value);
const FEEDBACK_CSV_CELL_MAX_LENGTH = 2000;
const PASSED_GENERATION_STATUSES = new Set(["finished", "passed", "success", "succeeded"]);

const normalizeFeedbackAgentForQuestionManage = (raw: any): QuestionManageFeedbackAgent => ({
  agent_id: String(raw?.agent_id ?? raw?.id ?? ""),
  title: typeof raw?.title === "string" ? raw.title : typeof raw?.name === "string" ? raw.name : "",
  role: typeof raw?.role === "string" ? raw.role : undefined,
  provider: typeof raw?.provider === "string" ? raw.provider : undefined,
  model: typeof raw?.model === "string" ? raw.model : undefined,
  access_scope: typeof raw?.access_scope === "string" ? raw.access_scope : undefined,
  prompt_text: typeof raw?.prompt_text === "string" ? raw.prompt_text : undefined,
  inputs: Array.isArray(raw?.inputs) ? raw.inputs : [],
  created_at: typeof raw?.created_at === "string" ? raw.created_at : undefined,
  updated_at: typeof raw?.updated_at === "string" ? raw.updated_at : undefined,
});

const parseFeedbackAgentsForQuestionManage = (data: unknown): QuestionManageFeedbackAgent[] => {
  if (Array.isArray(data)) {
    return data.map(normalizeFeedbackAgentForQuestionManage).filter((agent) => agent.agent_id);
  }
  if (!data || typeof data !== "object") return [];
  const payload = data as Record<string, unknown>;
  const itemsCandidate =
    payload.items ?? payload.agents ?? payload.feedback_agents ?? payload.data ?? payload.results;
  if (!Array.isArray(itemsCandidate)) return [];
  return itemsCandidate.map(normalizeFeedbackAgentForQuestionManage).filter((agent) => agent.agent_id);
};

const getQuestionContentForFeedbackSheet = (question: Question) => {
  if (!Array.isArray(question.content) || question.content.length === 0) return "";
  return question.content
    .map((item) => {
      if (item.type === "text") return String(item.content ?? "").trim();
      if (item.type === "image") return `[image] ${String(item.content ?? "").trim()}`;
      return `[${item.type}] ${String(item.content ?? "").trim()}`;
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, FEEDBACK_CSV_CELL_MAX_LENGTH);
};

const sanitizeFeedbackSheetHeader = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const toCsvCell = (value: unknown) => {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
};

const toCsvText = (headers: string[], rows: Array<Record<string, string>>) => {
  const headerLine = headers.map((h) => toCsvCell(h)).join(",");
  const bodyLines = rows.map((row) => headers.map((h) => toCsvCell(row[h] ?? "")).join(","));
  return [headerLine, ...bodyLines].join("\n");
};

const parseCsvText = (source: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      if (inQuotes && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      pushCell();
      pushRow();
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      continue;
    }
    if (!inQuotes && ch === ",") {
      pushCell();
      continue;
    }
    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }
  return rows;
};

const parseFeedbackSheetCsv = (text: string) => {
  const matrix = parseCsvText(text);
  if (matrix.length === 0) {
    return { headers: [] as string[], rows: [] as Array<Record<string, string>> };
  }
  const headers = matrix[0].map((value, idx) => {
    const base = idx === 0 ? value.replace(/^\uFEFF/, "") : value;
    return String(base ?? "").trim();
  });
  const rows = matrix
    .slice(1)
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim().length > 0))
    .map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = String(cells[idx] ?? "");
      });
      return row;
    });
  return { headers, rows };
};

const isFeedbackSheetNullLike = (value: unknown) => {
  const text = String(value ?? "").trim();
  if (!text) return true;
  return /^n\/a$/i.test(text);
};

const parseManualSlideIdsCell = (value: unknown): string[] => {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  if (/^n\/a$/i.test(raw)) return [];
  const normalizeToken = (token: string) =>
    token
      .trim()
      .replace(/^\[+/, "")
      .replace(/\]+$/, "")
      .replace(/^['"]+/, "")
      .replace(/['"]+$/, "")
      .trim();
  const maybeJson = raw.startsWith("[") ? raw : "";
  if (maybeJson) {
    try {
      const parsed = JSON.parse(maybeJson);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(
            parsed
              .map((item) =>
                String(
                  typeof item === "string"
                    ? item
                    : (item as any)?.slide_id ?? (item as any)?.slideId ?? (item as any)?.id ?? ""
                )
                  .trim()
              )
              .map(normalizeToken)
              .filter(Boolean)
          )
        );
      }
    } catch {
      // Fallback to delimiter parsing.
    }
  }
  return Array.from(
    new Set(
      raw
        .split(/[,\n;|]/g)
        .map(normalizeToken)
        .filter(Boolean)
    )
  );
};

const buildQuestionVersionPayloadWithSlides = (
  rawDetail: any,
  createdBy: string,
  slideIds: string[]
) => {
  const currentVersion = rawDetail?.current_version ?? {};
  const questionType = String(
    currentVersion?.question_type ??
      rawDetail?.question_type ??
      rawDetail?.type ??
      (Array.isArray(rawDetail?.interactions) ? rawDetail.interactions[0]?.interaction_type : "") ??
      "free_text"
  ).trim();
  const contentBlocksSource = Array.isArray(rawDetail?.content_blocks)
    ? rawDetail.content_blocks
    : Array.isArray(currentVersion?.content_blocks)
      ? currentVersion.content_blocks
      : [];
  const interactionsSource = Array.isArray(rawDetail?.interactions)
    ? rawDetail.interactions
    : Array.isArray(currentVersion?.interactions)
      ? currentVersion.interactions
      : [];

  const content_blocks = contentBlocksSource.map((block: any) => ({
    block_type: String(block?.block_type ?? block?.type ?? "text"),
    text_content: block?.text_content ?? block?.content ?? block?.text ?? null,
    media_url: block?.media_url ?? block?.image_url ?? block?.src ?? null,
    alt_text: block?.alt_text ?? null,
  }));

  const interactions = interactionsSource.map((interaction: any, idx: number) => {
    const optionsSource = Array.isArray(interaction?.options)
      ? interaction.options
      : Array.isArray(interaction?.interaction_options)
        ? interaction.interaction_options
        : [];
    const interactionType = String(interaction?.interaction_type ?? interaction?.type ?? questionType ?? "free_text");
    return {
      interaction_type: interactionType,
      interaction_order: Number(interaction?.interaction_order ?? idx + 1),
      prompt_text: interaction?.prompt_text ?? null,
      is_required: Boolean(interaction?.is_required ?? true),
      max_score:
        typeof interaction?.max_score === "number"
          ? interaction.max_score
          : typeof currentVersion?.score_maximum === "number"
            ? currentVersion.score_maximum
            : 1,
      options: optionsSource.map((option: any, optionIdx: number) => ({
        option_order: Number(option?.option_order ?? optionIdx + 1),
        option_value: String(option?.option_value ?? option?.option_label ?? option?.text ?? "").trim(),
        option_label: String(option?.option_label ?? option?.option_value ?? option?.text ?? "").trim(),
        is_correct: Boolean(option?.is_correct ?? option?.isCorrect ?? option?.correct ?? false),
      })),
    };
  });

  const slide_scope = slideIds.map((slideId) => ({
    slide_id: slideId,
    page_start: null,
    page_end: null,
  }));

  return {
    question_type: questionType,
    title: currentVersion?.title ?? rawDetail?.title ?? null,
    content_blocks,
    interactions,
    slide_scope,
    scoring_policy: {
      score_maximum:
        typeof currentVersion?.score_maximum === "number"
          ? currentVersion.score_maximum
          : typeof rawDetail?.score_maximum === "number"
            ? rawDetail.score_maximum
            : 1,
      score_input_format: currentVersion?.score_input_format ?? rawDetail?.score_input_format ?? "fraction",
      score_normalize_to_maximum:
        typeof currentVersion?.score_normalize_to_maximum === "boolean"
          ? currentVersion.score_normalize_to_maximum
          : typeof rawDetail?.score_normalize_to_maximum === "boolean"
            ? rawDetail.score_normalize_to_maximum
            : true,
      score_rounding_mode: currentVersion?.score_rounding_mode ?? rawDetail?.score_rounding_mode ?? "none",
      score_rounding_step:
        typeof currentVersion?.score_rounding_step === "number"
          ? currentVersion.score_rounding_step
          : typeof rawDetail?.score_rounding_step === "number"
            ? rawDetail.score_rounding_step
            : 1,
    },
    created_by: createdBy,
    change_note: "Update linked slides from feedback sheet upload",
    copy_feedback_links_from_previous: true,
  };
};

const parseAttachedAgentsPayload = (payload: any): Array<{
  attachment_id?: string;
  agent_id: string;
  title?: string;
  role?: string;
  question_feedback_text?: string;
  option_feedback_count?: number;
  generation_status?: string;
}> => {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.agents)
        ? payload.agents
      : Array.isArray(payload?.attached_agents)
        ? payload.attached_agents
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return items
    .map((item: any) => {
      const optionFeedbackCount = Number(item?.option_feedback_count);
      return {
        attachment_id: readFirstString(item?.attachment_id, item?.question_attachment_id, item?.id) || undefined,
        agent_id: String(item?.agent_id ?? item?.id ?? "").trim(),
        title: String(item?.title ?? item?.agent_title ?? item?.name ?? "").trim() || undefined,
        role: String(item?.role ?? "").trim().toLowerCase() || undefined,
        question_feedback_text: String(item?.question_feedback_text ?? item?.static_feedback_text ?? "").trim() || undefined,
        option_feedback_count: Number.isFinite(optionFeedbackCount) ? optionFeedbackCount : undefined,
        generation_status: String(item?.generation_status ?? item?.generation?.status ?? "").trim() || undefined,
      };
    })
    .filter((item: { agent_id: string }) => item.agent_id);
};

const parseFeedbackSheetAgentColumn = (header: string, sortedKnownAgentIds: string[]) => {
  const questionSuffix = "_question_feedback";
  const optionMatch = header.match(/_option_(\d+)_feedback$/);
  const suffix = optionMatch ? optionMatch[0] : header.endsWith(questionSuffix) ? questionSuffix : "";
  if (!suffix) return null;
  for (const agentId of sortedKnownAgentIds) {
    if (header.startsWith(`agent_${agentId}_`)) {
      return {
        header,
        agent_id: agentId,
        type: optionMatch ? ("option" as const) : ("question" as const),
        optionIndex: optionMatch ? Number(optionMatch[1]) : undefined,
      };
    }
  }
  return null;
};

const getFeedbackAgentInputKeys = (agent?: QuestionManageFeedbackAgent | null) => {
  if (!agent?.inputs?.length) return [];
  return agent.inputs
    .map((input) => (typeof input === "string" ? input : String(input?.input_key ?? "")))
    .map((value) => value.trim())
    .filter(Boolean);
};

const summarizeBatchQuestionMutation = (
  actionLabel: string,
  response: BatchQuestionMutationResponse | undefined,
  requestedCount: number
) => {
  const successCount = Number(response?.success_count ?? response?.success_ids?.length ?? 0);
  const failedCount = Number(response?.failed_count ?? response?.failed?.length ?? 0);
  const parts = [`${actionLabel}: ${successCount}/${requestedCount} succeeded`];
  if (failedCount > 0) parts.push(`${failedCount} failed`);
  return parts.join(". ") + ".";
};

const normalizeTargetTypeForFeedbackLink = (value?: string) => (value ?? "").trim().toLowerCase();

const isQuestionLevelFeedbackTarget = (link: QuestionFeedbackLinkDraftSource) => {
  const targetType = normalizeTargetTypeForFeedbackLink(link.target_type);
  return targetType.includes("question_version") || targetType.includes("question-version");
};

const isOptionLevelFeedbackTarget = (link: QuestionFeedbackLinkDraftSource) => {
  const targetType = normalizeTargetTypeForFeedbackLink(link.target_type);
  return targetType.includes("interaction_option") || targetType.includes("interaction-option");
};

const normalizeQuestionType = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.toLowerCase().replace(/[_-]+/g, " ");
  if (
    normalized === "multiple choice" ||
    normalized === "mcq" ||
    normalized === "single choice" ||
    normalized === "single select"
  ) {
    return "multiple choice";
  }
  if (
    normalized === "open ended" ||
    normalized === "open ended question" ||
    normalized === "oeq" ||
    normalized === "free text" ||
    normalized === "text"
  ) {
    return "open ended";
  }
  return raw;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
};

const firstNonEmptyStringArray = (...candidates: unknown[]): string[] => {
  for (const candidate of candidates) {
    const values = toStringArray(candidate);
    if (values.length > 0) return values;
  }
  return [];
};

const extractSlideIdsFromEntries = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") {
        return String(item).trim();
      }
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return readFirstString(
        record.slide_id,
        record.slideId,
        record.id,
        getNested(record, "slide.slide_id"),
        getNested(record, "slide.id")
      );
    })
    .filter(Boolean);
  return Array.from(new Set(ids));
};

const extractSlideIdsFromFeedbackLinks = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      const kind = String(
        record.link_type ??
          record.target_type ??
          record.resource_type ??
          record.entity_type ??
          record.object_type ??
          ""
      )
        .trim()
        .toLowerCase();

      const candidateId = readFirstString(
        record.slide_id,
        record.slideId,
        getNested(record, "slide.slide_id"),
        getNested(record, "slide.id"),
        kind.includes("slide") ? record.target_id : undefined,
        kind.includes("slide") ? record.resource_id : undefined,
        kind.includes("slide") ? record.entity_id : undefined,
        kind.includes("slide") ? record.object_id : undefined
      );
      return candidateId;
    })
    .filter(Boolean);
  return Array.from(new Set(ids));
};

const extractFeedbackLinksForDraftPrefill = (value: unknown): QuestionFeedbackLinkDraftSource[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const target_type = String(
        record.target_type ??
          record.link_type ??
          record.resource_type ??
          record.entity_type ??
          record.object_type ??
          ""
      )
        .trim()
        .toLowerCase();
      const target_id = readFirstString(
        record.target_id,
        record.resource_id,
        record.entity_id,
        record.object_id,
        record.question_version_id,
        record.interaction_option_id
      );
      const agent_id = readFirstString(
        record.agent_id,
        record.feedback_agent_id,
        getNested(record, "feedback_agent.agent_id"),
        getNested(record, "agent.agent_id"),
        getNested(record, "feedback_agent.id"),
        getNested(record, "agent.id")
      );
      const agent_title = readFirstString(
        getNested(record, "feedback_agent.title"),
        getNested(record, "feedback_agent.name"),
        getNested(record, "agent.title"),
        getNested(record, "agent.name")
      );
      const static_feedback_text = readFirstString(
        record.static_feedback_text,
        record.feedback_text,
        record.text
      );
      const generation_status = readFirstString(
        record.generation_status,
        getNested(record, "generation.status")
      );
      if (!agent_id || !target_id) return null;
      return {
        agent_id,
        agent_title: agent_title || undefined,
        target_type: target_type || undefined,
        target_id,
        static_feedback_text: static_feedback_text || undefined,
        generation_status: generation_status || undefined,
      };
    })
    .filter(Boolean) as QuestionFeedbackLinkDraftSource[];
};

const extractQuestionSlideScope = (value: unknown): QuestionSlideScopeEntry[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: QuestionSlideScopeEntry[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const slideRecord =
      record.slide && typeof record.slide === "object" ? (record.slide as Record<string, unknown>) : undefined;

    const slide_id = readFirstString(
      record.slide_id,
      record.slideId,
      slideRecord?.slide_id,
      slideRecord?.slideId,
      slideRecord?.id,
      record.id
    );
    if (!slide_id) continue;
    if (seen.has(slide_id)) continue;
    seen.add(slide_id);

    const pageStartRaw = record.page_start ?? record.pageStart;
    const pageEndRaw = record.page_end ?? record.pageEnd;

    entries.push({
      slide_scope_id: readFirstString(record.slide_scope_id, record.slideScopeId),
      slide_id,
      page_start: typeof pageStartRaw === "number" ? pageStartRaw : pageStartRaw == null ? null : null,
      page_end: typeof pageEndRaw === "number" ? pageEndRaw : pageEndRaw == null ? null : null,
      course_id: readFirstString(record.course_id, slideRecord?.course_id),
      course_title: readFirstString(record.course_title, slideRecord?.course_title),
      module_id: readFirstString(record.module_id, slideRecord?.module_id),
      module_title: readFirstString(record.module_title, slideRecord?.module_title),
      slide_title: readFirstString(record.slide_title, slideRecord?.slide_title),
    });
  }

  return entries;
};

const readFirstString = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "";
};

const getNested = (obj: unknown, path: string): unknown => {
  if (!obj || typeof obj !== "object") return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
};

const extractBlockText = (block: unknown): string => {
  const direct = readFirstString(
    getNested(block, "content"),
    getNested(block, "text"),
    getNested(block, "text_content"),
    getNested(block, "value"),
    getNested(block, "body"),
    getNested(block, "payload"),
    getNested(block, "data"),
    getNested(block, "metadata.text"),
    getNested(block, "payload.text"),
    getNested(block, "payload.content"),
    getNested(block, "payload.value"),
    getNested(block, "data.text"),
    getNested(block, "data.content"),
    getNested(block, "data.value")
  );
  if (direct) return direct;

  const objectCandidates = [
    getNested(block, "content"),
    getNested(block, "payload"),
    getNested(block, "data"),
    getNested(block, "body"),
  ];
  for (const candidate of objectCandidates) {
    if (candidate && typeof candidate === "object") {
      const nested = readFirstString(
        getNested(candidate, "text"),
        getNested(candidate, "text_content"),
        getNested(candidate, "content"),
        getNested(candidate, "value"),
        getNested(candidate, "plain_text"),
        getNested(candidate, "markdown")
      );
      if (nested) return nested;
    }
  }
  return "";
};

const extractBlockImageUrl = (block: unknown): string => {
  return readFirstString(
    getNested(block, "url"),
    getNested(block, "src"),
    getNested(block, "image_url"),
    getNested(block, "media_url"),
    getNested(block, "content.url"),
    getNested(block, "content.src"),
    getNested(block, "payload.url"),
    getNested(block, "payload.src"),
    getNested(block, "payload.image_url"),
    getNested(block, "payload.media_url"),
    getNested(block, "data.url"),
    getNested(block, "data.src"),
    getNested(block, "data.image_url"),
    getNested(block, "data.media_url")
  );
};

const extractSemanticOptions = (raw: any): Array<{ interaction_option_id?: string; text: string; isCorrect: boolean }> => {
  const direct = Array.isArray(raw?.options) ? raw.options : [];
  const directInteractionOptions = Array.isArray(raw?.interaction_options) ? raw.interaction_options : [];
  const fromInteraction = Array.isArray(raw?.interactions)
    ? raw.interactions.flatMap((interaction: any) =>
        Array.isArray(interaction?.options)
          ? interaction.options
          : Array.isArray(interaction?.interaction_options)
            ? interaction.interaction_options
            : Array.isArray(interaction?.current_version?.options)
              ? interaction.current_version.options
              : Array.isArray(interaction?.current_version?.interaction_options)
                ? interaction.current_version.interaction_options
            : []
      )
    : [];
  const source =
    direct.length > 0 ? direct : directInteractionOptions.length > 0 ? directInteractionOptions : fromInteraction;
  return source
    .map((option: any) => ({
      interaction_option_id: readFirstString(
        option?.interaction_option_id,
        option?.interactionOptionId,
        option?.option_id,
        option?.id
      ) || undefined,
      text: String(
        option?.text ??
          option?.option_text ??
          option?.label ??
          option?.option_label ??
          option?.option_value ??
          option?.content ??
          ""
      ),
      isCorrect: Boolean(option?.is_correct ?? option?.isCorrect ?? option?.correct),
    }))
    .filter((option: { text: string; isCorrect: boolean }) => option.text || option.isCorrect);
};

const extractSemanticContentBlocks = (raw: any): QuestionContent[] => {
  const blocks = Array.isArray(raw?.content_blocks)
    ? raw.content_blocks
    : Array.isArray(raw?.current_version?.content_blocks)
      ? raw.current_version.content_blocks
      : [];

  return [...blocks]
    .sort((a: any, b: any) => Number(a?.block_order ?? 0) - Number(b?.block_order ?? 0))
    .map((block: any) => {
      const compatType = String(block?.block_type ?? block?.type ?? "").toLowerCase();
      const compatImage = readFirstString(block?.media_url, block?.image_url, block?.src);
      const compatText = readFirstString(block?.text_content);

      if (compatType.includes("image")) {
        const img = compatImage || extractBlockImageUrl(block);
        return { type: "image", content: img };
      }
      if (compatText) {
        return { type: "text", content: compatText };
      }
      if (compatImage) {
        return { type: "image", content: compatImage };
      }
      if (typeof block?.content === "string" && block.content.trim()) {
        return { type: "text", content: block.content.trim() };
      }

      const rawType = String(
        block?.block_type ?? block?.type ?? block?.content_type ?? block?.kind ?? block?.node_type ?? ""
      ).toLowerCase();
      const looksLikeImageType = rawType.includes("image");
      const imageUrl = extractBlockImageUrl(block);
      const text = extractBlockText(block);
      const type = looksLikeImageType || (!!imageUrl && !text) ? "image" : "text";
      const content = type === "image" ? imageUrl : text;
      return { type, content };
    })
    .filter((block) => block.content);
};

const extractRawContentBlocks = (raw: any): any[] => {
  if (Array.isArray(raw?.content_blocks)) return raw.content_blocks;
  if (Array.isArray(raw?.current_version?.content_blocks)) return raw.current_version.content_blocks;
  return [];
};

const extractImagePreviewUrlFromRaw = (raw: any): string => {
  const blocks = extractRawContentBlocks(raw);
  const imageBlock = [...blocks]
    .sort((a: any, b: any) => Number(a?.block_order ?? 0) - Number(b?.block_order ?? 0))
    .find((block: any) => {
      const mediaUrl = readFirstString(block?.media_url, block?.image_url, block?.src);
      if (mediaUrl) return true;
      return Boolean(extractBlockImageUrl(block));
    });
  if (!imageBlock) return "";
  return (
    readFirstString(imageBlock?.media_url, imageBlock?.image_url, imageBlock?.src) ||
    extractBlockImageUrl(imageBlock)
  );
};

const extractInteractionPromptContent = (raw: any): QuestionContent[] => {
  const interactions = Array.isArray(raw?.interactions)
    ? raw.interactions
    : Array.isArray(raw?.current_version?.interactions)
      ? raw.current_version.interactions
      : [];
  const first = interactions[0];
  if (!first) return [];

  const promptText = readFirstString(
    first?.prompt,
    first?.prompt_text,
    first?.question_text,
    first?.text,
    first?.label,
    first?.stem,
    getNested(first, "prompt.text"),
    getNested(first, "prompt.content"),
    getNested(first, "prompt.value"),
    getNested(first, "question.text"),
    getNested(first, "question.content")
  );
  if (!promptText) return [];
  return [{ type: "text", content: promptText }];
};

const parseSemanticQuestion = (raw: any): Question => {
  const slideScope = raw?.slide_scope ?? raw?.current_version?.slide_scope;
  const normalizedSlideScope = extractQuestionSlideScope(slideScope);
  const slideIds =
    firstNonEmptyStringArray(raw?.slide_ids, raw?.current_version?.slide_ids, slideScope?.slide_ids) ||
    [];
  const slideIdsFromScope = normalizedSlideScope.map((entry) => entry.slide_id).filter(Boolean);
  const normalizedSlideIds =
    slideIds.length > 0
      ? slideIds
      : slideIdsFromScope.length > 0
        ? slideIdsFromScope
      : (() => {
          const fromScopeEntries = extractSlideIdsFromEntries(
            Array.isArray(slideScope)
              ? slideScope
              : Array.isArray(raw?.slides)
                ? raw.slides
                : Array.isArray(raw?.current_version?.slides)
                  ? raw.current_version.slides
                  : []
          );
          if (fromScopeEntries.length > 0) return fromScopeEntries;

          return extractSlideIdsFromFeedbackLinks(
            Array.isArray(raw?.feedback_links)
              ? raw.feedback_links
              : Array.isArray(raw?.current_version?.feedback_links)
                ? raw.current_version.feedback_links
                : []
          );
        })();

  const interactions = Array.isArray(raw?.interactions)
    ? raw.interactions
    : Array.isArray(raw?.current_version?.interactions)
      ? raw.current_version.interactions
      : [];

  const firstInteraction = interactions[0] ?? {};
  const objective = firstNonEmptyStringArray(
    raw?.objective,
    raw?.objectives,
    firstInteraction?.objective,
    firstInteraction?.learning_objectives
  );

  const mcqHumanFeedback = Array.isArray(raw?.mcq_human_feedback)
    ? raw.mcq_human_feedback
    : Array.isArray(firstInteraction?.mcq_human_feedback)
      ? firstInteraction.mcq_human_feedback
      : [];
  const contentPreviewNodes = Array.isArray(raw?.content_preview_nodes)
    ? raw.content_preview_nodes
        .map((node: any) => ({
          block_type: String(node?.block_type ?? node?.type ?? "").trim(),
          preview: String(node?.preview ?? node?.text_preview ?? "").trim(),
        }))
        .filter((node: { block_type: string; preview: string }) => node.block_type || node.preview)
    : [];

  const contentBlocks = extractSemanticContentBlocks(raw);
  const feedbackLinks = extractFeedbackLinksForDraftPrefill(
    Array.isArray(raw?.feedback_links)
      ? raw.feedback_links
      : Array.isArray(raw?.current_version?.feedback_links)
        ? raw.current_version.feedback_links
        : []
  );

  return {
    question_id: String(raw?.question_id ?? raw?.id ?? ""),
    question_version_id:
      readFirstString(
        raw?.question_version_id,
        raw?.current_question_version_id,
        raw?.current_version?.question_version_id,
        raw?.current_version?.id
      ) || undefined,
    type: normalizeQuestionType(raw?.question_type ?? raw?.type),
    question_type_raw:
      typeof raw?.question_type === "string"
        ? raw.question_type
        : typeof raw?.type === "string"
          ? raw.type
          : undefined,
    access_scope:
      typeof raw?.access_scope === "string"
        ? raw.access_scope
        : typeof raw?.current_version?.access_scope === "string"
          ? raw.current_version.access_scope
          : undefined,
    objective,
    slide_ids: normalizedSlideIds,
    slide_scope: normalizedSlideScope,
    created_at: raw?.created_at ?? raw?.current_version?.created_at,
    content: contentBlocks.length > 0 ? contentBlocks : extractInteractionPromptContent(raw),
    options: extractSemanticOptions(raw),
    mcq_human_feedback: mcqHumanFeedback.map((item: any) => String(item ?? "")),
    feedback_links: feedbackLinks,
    text_preview: typeof raw?.text_preview === "string" ? raw.text_preview : undefined,
    content_block_count:
      typeof raw?.content_block_count === "number" ? raw.content_block_count : undefined,
    content_preview_nodes: contentPreviewNodes,
    image_preview_url: extractImagePreviewUrlFromRaw(raw) || undefined,
  };
};

const QuestionExpandedContent = ({ question }: { question: Question }) => {
  const imagePreview = getQuestionImagePreview(question);
  const objectiveText = question.objective?.filter(Boolean).join("; ") || "";
  const feedbackAttachmentRows = Array.from(
    (question.feedback_links ?? []).reduce((acc, link) => {
      const agentId = link.agent_id || "(unknown agent)";
      const existing = acc.get(agentId) ?? {
        agentId,
        agentTitle: link.agent_title || "",
        linkCount: 0,
        staticCount: 0,
        generationStatuses: new Set<string>(),
      };
      existing.linkCount += 1;
      if (link.static_feedback_text?.trim()) existing.staticCount += 1;
      if (link.generation_status) existing.generationStatuses.add(link.generation_status);
      if (!existing.agentTitle && link.agent_title) existing.agentTitle = link.agent_title;
      acc.set(agentId, existing);
      return acc;
    }, new Map<string, { agentId: string; agentTitle: string; linkCount: number; staticCount: number; generationStatuses: Set<string> }>())
  ).map(([, row]) => row);
  const slideScopeLines = (question.slide_scope ?? []).map((entry) => {
    const path = [entry.course_title, entry.module_title, entry.slide_title].filter(Boolean).join(" / ");
    return {
      key: entry.slide_scope_id || entry.slide_id,
      label: path || entry.slide_id,
    };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Question Content Preview
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {getQuestionTextPreview(question)}
          </p>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Linked Slides
          </div>
          {slideScopeLines.length > 0 ? (
            <ul className="space-y-1">
              {slideScopeLines.map((line) => (
                <li key={line.key} className="text-sm text-slate-700">
                  <div className="break-words">{line.label}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="break-all text-sm text-slate-700">
              {question.slide_ids?.length ? question.slide_ids.join(", ") : "None"}
            </p>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Feedback Attachments
          </div>
          {feedbackAttachmentRows.length > 0 ? (
            <div className="space-y-2">
              {feedbackAttachmentRows.map((row) => (
                <div key={`${question.question_id}-fb-agent-${row.agentId}`} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-800">{row.agentTitle || row.agentId}</span>
                    {row.agentTitle ? (
                      <span className="font-mono text-[11px] text-slate-500">{row.agentId}</span>
                    ) : null}
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                      {row.linkCount} link{row.linkCount === 1 ? "" : "s"}
                    </span>
                    {row.staticCount > 0 ? (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        {row.staticCount} static
                      </span>
                    ) : null}
                    {Array.from(row.generationStatuses).map((status) => (
                      <span
                        key={`${question.question_id}-${row.agentId}-status-${status}`}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                      >
                        gen: {status}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-400">(none)</div>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {imagePreview ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <DynamicImage
              src={imagePreview}
              alt="Question image"
              maxWidth={360}
              className="w-full object-contain"
            />
          </div>
        ) : null}
        {question.type === "multiple choice" && question.options?.length ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Options
            </div>
            <ul className="space-y-2">
              {question.options.map((option, idx) => (
                <li key={`${question.question_id}-opt-${idx}`} className="text-sm text-slate-700">
                  <span className="mr-2 inline-flex min-w-5 justify-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                    {idx + 1}
                  </span>
                  {option.text || "(Empty option)"}
                  {option.isCorrect ? (
                    <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Correct
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const getQuestionsPageItems = (payload: SemanticQuestionListResponse | any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.questions)) return payload.questions;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const toLegacyContentsFromBlocks = (blocks: ContentBlockDraft[]): QuestionContent[] =>
  blocks
    .map((block) => {
      if (block.block_type === "image") {
        return { type: "image", content: String(block.media_url ?? "").trim() };
      }
      return { type: "text", content: String(block.text_content ?? "").trim() };
    })
    .filter((item) => item.content);

const buildSingleChoiceOptions = (options: MCQOption[], correctIndex: number | null) => {
  const normalized = options
    .map((opt, index) => {
      const text = String(opt.text ?? "").trim();
      return {
      option_order: index + 1,
      text,
      option_text: text,
      option_label: text,
      option_value: text.slice(0, 2000),
      is_correct: index === correctIndex,
      feedback_text: String(opt.feedback ?? "").trim() || null,
    };
    })
    .filter((opt) => opt.text);

  return normalized;
};

const buildSingleChoiceOptionsForBatch = (choices: string[], correctIndex: number | null) =>
  choices
    .map((choice, index) => {
      const text = String(choice ?? "").trim();
      return {
      option_order: index + 1,
      text,
      option_label: text,
      option_value: text.slice(0, 2000),
      is_correct: index === correctIndex,
    };
    })
    .filter((opt) => opt.text);

const getBatchDraftIssues = (
  draft: BatchUploadParsedDraft,
  options: { requireQuestionLevelFeedback: boolean; requireOptionLevelFeedback: boolean }
): string[] => {
  const issues: string[] = [];
  if (!draft.stem.trim()) issues.push("stem is empty");
  if (draft.slideIds.some((id) => !UUID_REGEX.test(String(id)))) {
    issues.push("contains non-UUID slide_id");
  }
  if (draft.kind === "notebook") {
    if (options.requireQuestionLevelFeedback && !String(draft.questionFeedbackText ?? "").trim()) {
      issues.push("question-level feedback is empty");
    }
    return issues;
  }

  const choices = draft.choices ?? [];
  const feedbacks = draft.optionFeedbacks ?? [];
  if (choices.length < 2) issues.push("MCQ requires at least 2 choices");
  if (typeof draft.correctChoiceIndex !== "number" || draft.correctChoiceIndex < 0 || draft.correctChoiceIndex >= choices.length) {
    issues.push("correct is missing or out of range");
  }
  if (options.requireOptionLevelFeedback && feedbacks.length !== choices.length) {
    issues.push(`feedback count (${feedbacks.length}) != choice count (${choices.length})`);
  }
  if (choices.some((choice) => !String(choice ?? "").trim())) issues.push("contains empty choice text");
  if (options.requireOptionLevelFeedback && feedbacks.some((feedback) => !String(feedback ?? "").trim())) {
    issues.push("contains empty option feedback");
  }
  return issues;
};

const resolvePromptText = (questionType: SemanticQuestionType, userInput?: string | null): string | null => {
  const trimmed = (userInput ?? "").trim();
  return trimmed || DEFAULT_PROMPT_TEXT[questionType] || null;
};

type BatchUploadParsedDraft = {
  kind: "notebook" | "mcq";
  stem: string;
  lo?: string;
  slideIds: string[];
  questionFeedbackText?: string;
  choices?: string[];
  optionFeedbacks?: string[];
  correctChoiceIndex?: number;
  contentBlocks: ContentBlockDraft[];
  sourceTable: Record<string, string>;
};

type BatchAttachedAgentConfig = {
  agent_id: string;
  title?: string;
  role?: string;
  mapFeedback: boolean;
  questionFeedbackKey: string;
  optionFeedbackPrefix: string;
};

type BatchUploadFieldMapping = {
  kindKey: string;
  kindNotebookValue: string;
  kindMcqValue: string;
  stemKey: string;
  loKey: string;
  slideIdsKey: string;
  questionFeedbackKey: string;
  correctKey: string;
  choicePrefix: string;
  optionFeedbackPrefix: string;
};
type BatchUploadWizardStep = 1 | 2 | 3 | 4;

const DEFAULT_BATCH_UPLOAD_FIELD_MAPPING: BatchUploadFieldMapping = {
  kindKey: "customelement",
  kindNotebookValue: "notebook",
  kindMcqValue: "mcq",
  stemKey: "stem",
  loKey: "lo",
  slideIdsKey: "slide_ids",
  questionFeedbackKey: "feedback",
  correctKey: "correct",
  choicePrefix: "choice",
  optionFeedbackPrefix: "feedback",
};

const IMAGE_REF_LINE_REGEX = /^!\[\]\[([^\]]+)\]\s*$/;
const IMAGE_DEF_REGEX = /^\[([^\]]+)\]:\s*<([^>]+)>\s*$/;

const parseImageRefsFromMarkdown = (markdown: string) => {
  const lines = markdown.split(/\r?\n/);
  const imageMap: Record<string, string> = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(IMAGE_DEF_REGEX);
    if (!match) continue;
    const key = match[1].trim();
    const url = match[2].trim();
    if (key && url) imageMap[key] = url;
  }
  return imageMap;
};

const buildContentBlocksFromStem = (stem: string, imageMap: Record<string, string>): ContentBlockDraft[] => {
  const blocks: ContentBlockDraft[] = [];
  const parts = stem
    .split(/\r?\n\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const part of parts) {
    const imageRefMatch = part.match(IMAGE_REF_LINE_REGEX);
    if (imageRefMatch) {
      const imageKey = imageRefMatch[1].trim();
      const mediaUrl = imageMap[imageKey];
      if (mediaUrl) {
        blocks.push({ block_type: "image", media_url: mediaUrl, alt_text: imageKey });
        continue;
      }
    }
    blocks.push({ block_type: "text", text_content: part });
  }
  return blocks;
};

const parseKeyValueTablesFromMarkdown = (markdown: string): Array<Record<string, string>> => {
  const lines = markdown.split(/\r?\n/);
  const tables: Array<Record<string, string>> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line.startsWith("|")) {
      index += 1;
      continue;
    }

    const blockLines: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      blockLines.push(lines[index].trim());
      index += 1;
    }
    if (blockLines.length < 2) continue;

    const table: Record<string, string> = {};
    for (const rowLine of blockLines) {
      const cells = rowLine
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length < 2) continue;
      const left = cells[0].toLowerCase();
      const right = cells.slice(1).join(" | ").trim();
      if (!left) continue;
      if (/^:?-{2,}:?$/.test(left) || /^:?-{2,}:?$/.test(right)) continue;
      table[left] = right;
    }
    if (Object.keys(table).length > 0) tables.push(table);
  }
  return tables;
};

const parseBatchMarkdownToDrafts = (
  markdown: string,
  mapping: BatchUploadFieldMapping
): BatchUploadParsedDraft[] => {
  if (!markdown.trim()) return [];
  const imageMap = parseImageRefsFromMarkdown(markdown);
  const tables = parseKeyValueTablesFromMarkdown(markdown);
  const drafts: BatchUploadParsedDraft[] = [];
  const norm = (value: string) => value.trim().toLowerCase();
  const kindKey = norm(mapping.kindKey);
  const stemKey = norm(mapping.stemKey);
  const loKey = norm(mapping.loKey);
  const slideIdsKey = norm(mapping.slideIdsKey);
  const questionFeedbackKey = norm(mapping.questionFeedbackKey);
  const correctKey = norm(mapping.correctKey);
  const choicePrefix = norm(mapping.choicePrefix);
  const optionFeedbackPrefix = norm(mapping.optionFeedbackPrefix);
  const notebookValue = norm(mapping.kindNotebookValue);
  const mcqValue = norm(mapping.kindMcqValue);
  const notebookEnabled = Boolean(notebookValue);
  const mcqEnabled = Boolean(mcqValue);
  const parseSlideIds = (table: Record<string, string>): string[] => {
    const candidateKeys = [
      slideIdsKey,
      "slide_ids",
      "slide_id",
      "slideids",
      "slideid",
      "slides",
      "slide",
    ].filter(Boolean);
    const deduped = Array.from(new Set(candidateKeys));
    const found: string[] = [];
    for (const key of deduped) {
      const raw = String(table[key] ?? "").trim();
      if (!raw) continue;
      const maybeJson = raw.startsWith("[") ? raw : "";
      if (maybeJson) {
        try {
          const parsed = JSON.parse(maybeJson);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const value = String(
                typeof item === "string" ? item : (item as any)?.slide_id ?? (item as any)?.slideId ?? (item as any)?.id ?? ""
              ).trim();
              if (value) found.push(value);
            }
            continue;
          }
        } catch {
          // Fall through to delimited parsing.
        }
      }
      const tokens = raw
        .split(/[,\n;|]/g)
        .map((token) => token.trim())
        .filter(Boolean);
      found.push(...tokens);
    }
    return Array.from(new Set(found));
  };

  for (const table of tables) {
    const customElement = String(table[kindKey] ?? "").trim().toLowerCase();
    const isNotebookRow = notebookEnabled && customElement === notebookValue;
    const isMcqRow = mcqEnabled && customElement === mcqValue;
    if (!isNotebookRow && !isMcqRow) continue;

    const stem = String(table[stemKey] ?? "").trim();
    if (!stem) continue;
    const lo = String(table[loKey] ?? "").trim() || undefined;
    const slideIds = parseSlideIds(table);
    const contentBlocks = buildContentBlocksFromStem(stem, imageMap);

    if (isNotebookRow) {
      const feedback = String(table[questionFeedbackKey] ?? "").trim();
      drafts.push({
        kind: "notebook",
        stem,
        lo,
        slideIds,
        questionFeedbackText: feedback || undefined,
        contentBlocks,
        sourceTable: table,
      });
      continue;
    }

    const choices: string[] = [];
    const feedbacks: string[] = [];
    const choicePairs = Object.entries(table)
      .map(([key, value]) => ({ key, value }))
      .filter((item) => item.key.toLowerCase().startsWith(choicePrefix))
      .sort((a, b) => Number(a.key.replace(/\D/g, "")) - Number(b.key.replace(/\D/g, "")));
    for (const pair of choicePairs) {
      const suffix = pair.key.toLowerCase().slice(choicePrefix.length);
      const idx = Number(suffix.replace(/\D/g, ""));
      if (!Number.isFinite(idx) || idx <= 0) continue;
      choices.push(String(pair.value ?? "").trim());
      feedbacks.push(String(table[`${optionFeedbackPrefix}${idx}`] ?? "").trim());
    }
    const correctRaw = String(table[correctKey] ?? "").trim().toLowerCase();
    const correctPattern = new RegExp(`^${choicePrefix}\\d+$`);
    const correctIdx = correctPattern.test(correctRaw)
      ? Number(correctRaw.replace(/\D/g, "")) - 1
      : Number.isFinite(Number(correctRaw))
        ? Number(correctRaw) - 1
        : -1;

    drafts.push({
      kind: "mcq",
      stem,
      lo,
      slideIds,
      choices,
      optionFeedbacks: feedbacks,
      correctChoiceIndex: correctIdx >= 0 ? correctIdx : undefined,
      contentBlocks,
      sourceTable: table,
    });
  }

  return drafts;
};

const QuestionOverview = () => {
  const [questions, setQuestions] = useState<Question[]>([]);

  // ---- course/module/slide hierarchy ----
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableModules, setAvailableModules] = useState<Module[]>([]);
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);
  const [course, setCourse] = useState<string | null>(null);
  const [module, setModule] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [topToastMessage, setTopToastMessage] = useState<string | null>(null);
  const topToastTimerRef = useRef<number | null>(null);

  // UX flags
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [slidesLoading, setSlidesLoading] = useState(false);

  // form state
  const [newQuestionTitle, setNewQuestionTitle] = useState("");
  const [newQuestionType, setNewQuestionType] = useState<CreateQuestionType>("single_choice");
  const [accessScope, setAccessScope] = useState<QuestionAccessScope>("private");
  const [contentBlocks, setContentBlocks] = useState<ContentBlockDraft[]>([
    { block_type: "text", text_content: "" },
  ]);
  const [interactionPromptText, setInteractionPromptText] = useState(DEFAULT_PROMPT_TEXT.single_choice);
  const [interactionMaxScore, setInteractionMaxScore] = useState<number>(1);
  const [newMcqOptions, setNewMcqOptions] = useState<MCQOption[]>([]);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState<number | null>(null);
  const [newSlideIds, setNewSlideIds] = useState<string[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [isAttachAgentModalOpen, setIsAttachAgentModalOpen] = useState(false);
  const [isFetchingAttachAgents, setIsFetchingAttachAgents] = useState(false);
  const [attachAgentsError, setAttachAgentsError] = useState<string | null>(null);
  const [attachAgents, setAttachAgents] = useState<QuestionManageFeedbackAgent[]>([]);
  const [selectedAttachAgentId, setSelectedAttachAgentId] = useState("");
  const [isAttachingAgent, setIsAttachingAgent] = useState(false);
  const [isBatchUploadModalOpen, setIsBatchUploadModalOpen] = useState(false);
  const [batchMarkdownContent, setBatchMarkdownContent] = useState("");
  const [batchAttachedAgents, setBatchAttachedAgents] = useState<BatchAttachedAgentConfig[]>([]);
  const [batchAttachAgentCandidateId, setBatchAttachAgentCandidateId] = useState("");
  const [batchUploadError, setBatchUploadError] = useState<string | null>(null);
  const [batchUploadRunning, setBatchUploadRunning] = useState(false);
  const [batchUploadProgressText, setBatchUploadProgressText] = useState<string | null>(null);
  const [batchUploadResultLines, setBatchUploadResultLines] = useState<string[]>([]);
  const [showBatchMarkdownContent, setShowBatchMarkdownContent] = useState(false);
  const [batchUploadStep, setBatchUploadStep] = useState<BatchUploadWizardStep>(1);
  const [batchUploadMaxStep, setBatchUploadMaxStep] = useState<BatchUploadWizardStep>(1);
  const [batchUploadMapping, setBatchUploadMapping] = useState<BatchUploadFieldMapping>(
    DEFAULT_BATCH_UPLOAD_FIELD_MAPPING
  );
  const feedbackSheetInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingFeedbackSheet, setIsUploadingFeedbackSheet] = useState(false);
  const [isFeedbackUploadResultModalOpen, setIsFeedbackUploadResultModalOpen] = useState(false);
  const [feedbackUploadSummary, setFeedbackUploadSummary] = useState<string>("");
  const [feedbackUploadResultLines, setFeedbackUploadResultLines] = useState<string[]>([]);
  const [attachedAgentsByQuestionId, setAttachedAgentsByQuestionId] = useState<
    Record<
      string,
      Array<{
        attachment_id?: string;
        agent_id: string;
        title?: string;
        role?: string;
        question_feedback_text?: string;
        option_feedback_count?: number;
        generation_status?: string;
      }>
    >
  >({});

  const { data } = useSession();
  const { hasManagePermission, isPermissionChecking, manageUserId } = useManagePermissionGuard();
  const searchParams = useSearchParams();
  const isDeepLinkMode = searchParams.get("lti_mode") === "deep_link";
  const launchId = searchParams.get("launch_id");
  const ltiLaunchId = searchParams.get("lti_launch_id");
  const ltiUserId = searchParams.get("lti_user_id");
  useEffect(() => {
    document.title = buildStaticPageTitle("Question Management");
  }, []);
  const ltiParams = new URLSearchParams();
  if (isDeepLinkMode) {
    ltiParams.set("lti_mode", "deep_link");
    if (launchId) ltiParams.set("launch_id", launchId);
    if (ltiLaunchId) ltiParams.set("lti_launch_id", ltiLaunchId);
    if (ltiUserId) ltiParams.set("lti_user_id", ltiUserId);
  }
  const ltiQuery = ltiParams.toString() ? `?${ltiParams.toString()}` : "";

  const showTopToast = useCallback((text: string) => {
    if (topToastTimerRef.current) {
      window.clearTimeout(topToastTimerRef.current);
      topToastTimerRef.current = null;
    }
    setTopToastMessage(text);
    topToastTimerRef.current = window.setTimeout(() => {
      setTopToastMessage(null);
      topToastTimerRef.current = null;
    }, 2800);
  }, []);

  const showFeedbackUploadResultModal = useCallback((summary: string, lines: string[] = []) => {
    setFeedbackUploadSummary(summary);
    setFeedbackUploadResultLines(lines);
    setIsFeedbackUploadResultModalOpen(true);
  }, []);

  useEffect(() => {
    return () => {
      if (topToastTimerRef.current) {
        window.clearTimeout(topToastTimerRef.current);
        topToastTimerRef.current = null;
      }
    };
  }, []);

  // normalize different backend shapes into { id, slide_title, ... }
  const normalizeSlide = (s: any) => ({
    id: s.id ?? s._id ?? s.slide_id,
    slide_title: s.slide_title ?? s.title ?? s.name ?? "Untitled slide",
    ...s,
  });

  // unique by id
  const uniqueById = <T extends { id?: string }>(arr: T[]) => {
    const seen = new Set<string>();
    return arr.filter((x) => {
      if (!x.id) return false;
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  };

  // 1) Fetch public courses on mount
  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    let cancelled = false;
    (async () => {
      setCoursesLoading(true);
      setMessage(null);
      try {
        const { data } = await axios.get("/api/courses/public");
        if (cancelled) return;

        // store courses as-is
        setCourses(Array.isArray(data) ? data : []);

        // auto-select the first course if none selected
        const first = Array.isArray(data) && data.length ? data[0] : null;
        const firstId: string | undefined = first?.id ?? first?.course_id;
        if (!course && firstId) setCourse(firstId);
      } catch (error) {
        console.error("Error fetching the courses:", error);
        if (!cancelled) setMessage("Failed to load courses.");
      } finally {
        if (!cancelled) setCoursesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // include `course` so we don't overwrite user-chosen course later
  }, [course, hasManagePermission, isPermissionChecking]);


  // 2) When a course is picked, fetch its modules
  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    if (!course) {
      setAvailableModules([]);
      setModule([]);
      setAvailableSlides([]);
      setNewSlideIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setModulesLoading(true);
      setMessage(null);
      try {
        const { data } = await axios.get(`/api/courses/by_id/${course}/modules`);
        const mods: Module[] = data?.modules ?? [];
        if (cancelled) return;

        setAvailableModules(mods);

        // auto-select all only if user hasn't selected anything yet
        if (module.length === 0) {
          setModule(mods.map((m) => (m.module_id ?? (m as any).id)));
        }
      } catch (error) {
        console.error("Error fetching the modules:", error);
        if (!cancelled) setMessage("Failed to load modules.");
        if (!cancelled) {
          setAvailableModules([]);
          setModule([]);
        }
      } finally {
        if (!cancelled) setModulesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // include `module` so we can check if it's empty
  }, [course, hasManagePermission, isPermissionChecking, module.length]);


  // 3) When module selection changes, fetch slides for those modules
  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    let cancelled = false;

    if (!module.length) {
      setAvailableSlides([]);
      setNewSlideIds([]);
      return;
    }

    (async () => {
      setSlidesLoading(true);
      try {
        const requests = module.map((modId) => axios.get(`/api/modules/${modId}/slides`));
        const responses = await Promise.all(requests);

        // flatten -> normalize -> unique
        const allSlidesRaw = responses.flatMap((res) => res.data?.slides ?? []);
        const normalized = uniqueById(allSlidesRaw.map(normalizeSlide));

        if (cancelled) return;

        setAvailableSlides(normalized);

        // auto-select all slides by default (optional)
        setNewSlideIds(normalized.map((s) => s.id as string));
      } catch (error) {
        console.error("Error fetching the slides:", error);
        if (!cancelled) {
          setAvailableSlides([]);
          setNewSlideIds([]);
        }
      } finally {
        if (!cancelled) setSlidesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasManagePermission, isPermissionChecking, module]);

  // Fetch questions
  const fetchQuestions = useCallback(async () => {
    if (!hasManagePermission || !manageUserId) return;
    setIsFetchingQuestions(true);
    try {
      const limit = 100;
      let offset = 0;
      let allRows: any[] = [];

      while (true) {
        const res = await axios.get(`/api/questions`, {
          params: {
            user_id: manageUserId,
            limit,
            offset,
            include: "current_version,content_blocks,interactions,options,slide_scope,feedback_links",
          },
        });
        const pageItems = getQuestionsPageItems(res.data);
        allRows = allRows.concat(pageItems);
        if (pageItems.length < limit) break;
        offset += limit;
      }

      setQuestions(allRows.map(parseSemanticQuestion).filter((q) => q.question_id));
    } catch (err) {
      console.error("Error fetching questions:", err);
      setQuestions([]);
    } finally {
      setIsFetchingQuestions(false);
    }
  }, [hasManagePermission, manageUserId]);

  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission || !manageUserId) return;
    fetchQuestions();
  }, [fetchQuestions, hasManagePermission, isPermissionChecking, manageUserId]);

  const fetchAttachableFeedbackAgents = useCallback(async () => {
    if (!hasManagePermission) return;
    setIsFetchingAttachAgents(true);
    setAttachAgentsError(null);
    try {
      const res = await axios.get("/api/feedback-agents", {
        params: {
          include_inputs: true,
          user_id: manageUserId || undefined,
        },
      });
      setAttachAgents(parseFeedbackAgentsForQuestionManage(res.data));
    } catch (error) {
      console.error("Error fetching feedback agents for attach modal:", error);
      setAttachAgents([]);
      setAttachAgentsError("Failed to load feedback agents.");
    } finally {
      setIsFetchingAttachAgents(false);
    }
  }, [hasManagePermission, manageUserId]);

  useEffect(() => {
    if (!isAttachAgentModalOpen) return;
    fetchAttachableFeedbackAgents();
  }, [fetchAttachableFeedbackAgents, isAttachAgentModalOpen]);
  useEffect(() => {
    if (!isBatchUploadModalOpen) return;
    if (attachAgents.length > 0) return;
    fetchAttachableFeedbackAgents();
  }, [attachAgents.length, fetchAttachableFeedbackAgents, isBatchUploadModalOpen]);

  useEffect(() => {
    setSelectedQuestionIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(questions.map((q) => q.question_id).filter(Boolean));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [questions]);

  // Multiple-choice option editor helpers
  const addOption = () => {
    setNewMcqOptions((opts) => [...opts, { text: "", feedback: "" }]);
  };
  
  const updateOption = (index: number, value: string) => {
    setNewMcqOptions((opts) => 
      opts.map((o, i) => (i === index ? { ...o, text: value } : o))
    );
  };
  
  const removeOption = (index: number) => {
    setNewMcqOptions((opts) => opts.filter((_, i) => i !== index));
    // Adjust correct answer index if needed
    if (correctAnswerIndex !== null) {
      if (correctAnswerIndex === index) {
        setCorrectAnswerIndex(null);
      } else if (correctAnswerIndex > index) {
        setCorrectAnswerIndex(correctAnswerIndex - 1);
      }
    }
  };

  const clearForm = () => {
    setNewQuestionTitle("");
    setNewQuestionType("single_choice");
    setAccessScope("private");
    setContentBlocks([{ block_type: "text", text_content: "" }]);
    setInteractionPromptText(DEFAULT_PROMPT_TEXT.single_choice);
    setInteractionMaxScore(1);
    setNewMcqOptions([]);
    setCorrectAnswerIndex(null);
    setNewSlideIds([]);
  };

  const handleCloseCreateModal = () => {
    setIsModalOpen(false);
    clearForm();
  };

  // Handle question creation
  const handleCreateQuestion = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) {
      e.preventDefault();
    }
    if (!manageUserId || !USER_ID_REGEX.test(manageUserId)) {
      alert("Invalid user_id. Expected database user ID like us_xxxxxxxxxxxxx.");
      return;
    }

    const normalizedBlocks = contentBlocks
      .map((block) => ({
        block_type: block.block_type,
        text_content: block.text_content?.trim() || "",
        media_url: block.media_url?.trim() || "",
        alt_text: block.alt_text?.trim() || "",
      }))
      .filter((block) => {
        if (block.block_type === "image") return Boolean(block.media_url);
        return Boolean(block.text_content);
      });

    if (normalizedBlocks.length === 0) {
      alert("Please add at least one content block.");
      return;
    }

    const nonUuidSlideIds = newSlideIds.filter((id) => !UUID_REGEX.test(String(id)));
    if (nonUuidSlideIds.length > 0) {
      alert("Selected slide IDs must be DB UUIDs. Please reselect slides.");
      return;
    }

    const optionsPayload =
      newQuestionType === "single_choice" ? buildSingleChoiceOptions(newMcqOptions, correctAnswerIndex) : [];

    if (newQuestionType === "single_choice") {
      if (optionsPayload.length < 2) {
        alert("Single choice requires at least 2 non-empty options.");
        return;
      }
      const correctCount = optionsPayload.filter((option) => option.is_correct).length;
      if (correctCount !== 1) {
        alert("Single choice must have exactly one correct option.");
        return;
      }
    }

    if (newQuestionType === "free_text" && optionsPayload.length > 0) {
      alert("free_text cannot include options.");
      return;
    }

    const interactionPayload: any = {
      interaction_type: newQuestionType,
      interaction_order: 1,
      prompt_text: resolvePromptText(newQuestionType, interactionPromptText),
      is_required: true,
      max_score: Number.isFinite(interactionMaxScore) ? Math.max(0, interactionMaxScore) : 1,
      options: newQuestionType === "single_choice" ? optionsPayload : [],
    };

    if (newQuestionType === "free_text") {
      delete interactionPayload.options;
    }

    const payload = {
      question_type: newQuestionType,
      title: newQuestionTitle.trim() || null,
      access_scope: accessScope,
      created_by: manageUserId,
      content_blocks: normalizedBlocks.map((b) => ({
        block_type: b.block_type,
        text_content: b.text_content || null,
        media_url: b.media_url || null,
        alt_text: b.alt_text || null,
      })),
      interactions: [interactionPayload],
      slide_ids: newSlideIds,
      slide_scope: newSlideIds.map((slideId) => ({
        slide_id: slideId,
        page_start: null,
        page_end: null,
      })),
      scoring_policy: {
        score_maximum: 1,
        score_input_format: "fraction",
        score_normalize_to_maximum: true,
        score_rounding_mode: "none",
        score_rounding_step: 1,
      },
    };

    if (payload.interactions.length !== 1) {
      alert("Only one interaction is supported.");
      return;
    }
    if (payload.interactions[0].interaction_type !== payload.question_type) {
      alert("Interaction type must match question type.");
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post("/api/questions", payload);
      if (res.status === 200 || res.status === 201) {
        await fetchQuestions();
        clearForm();
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Error creating question:", error);
      if (axios.isAxiosError(error)) {
        const responseData = error.response?.data as any;
        const detail = responseData?.detail;
        if (error.response?.status === 422 && detail !== undefined) {
          if (typeof detail === "object" && detail !== null) {
            alert(`422 Validation Error\n${JSON.stringify(detail, null, 2)}`);
            return;
          }
          alert(`422 Validation Error\n${String(detail)}`);
          return;
        }
        if (typeof detail === "string") {
          alert(detail);
          return;
        }
        if (typeof responseData?.message === "string") {
          alert(responseData.message);
          return;
        }
      }
      alert("Failed to create question. Check payload fields and try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleQuestionSelection = (questionId: string, checked: boolean) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredQuestions = useMemo(() => {
    return questions.filter((question) => {
      if (typeFilter !== "all" && (question.type ?? "") !== typeFilter) return false;
      if (!normalizedSearch) return true;

      const id = String(question.question_id ?? "").toLowerCase();
      const type = String(question.type ?? "").toLowerCase();
      const preview = getQuestionTextPreview(question).toLowerCase();
      return id.includes(normalizedSearch) || type.includes(normalizedSearch) || preview.includes(normalizedSearch);
    });
  }, [normalizedSearch, questions, typeFilter]);

  const sortedQuestions = useMemo(() => {
    const list = [...filteredQuestions];
    list.sort((a, b) => {
      let aValue = "";
      let bValue = "";

      if (sortKey === "created_at") {
        aValue = String(a.created_at ?? "");
        bValue = String(b.created_at ?? "");
      } else if (sortKey === "type") {
        aValue = String(a.type ?? "");
        bValue = String(b.type ?? "");
      } else {
        aValue = getQuestionTextPreview(a);
        bValue = getQuestionTextPreview(b);
      }

      const base = aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? base : -base;
    });
    return list;
  }, [filteredQuestions, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedQuestions.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedQuestions = sortedQuestions.slice(pageStart, pageStart + PAGE_SIZE);
  const displayedCount = pagedQuestions.length;
  const paginationTokens = getPaginationTokens(currentPage, totalPages);
  const sortIndicator = (key: SortKey) => (sortKey !== key ? "↕" : sortDirection === "asc" ? "↑" : "↓");
  const typeOptions = useMemo(() => {
    const uniqueTypes = Array.from(new Set(questions.map((q) => q.type).filter(Boolean) as string[])).sort();
    return ["all", ...uniqueTypes];
  }, [questions]);
  const filteredQuestionIds = useMemo(
    () => filteredQuestions.map((question) => question.question_id).filter(Boolean),
    [filteredQuestions]
  );
  const pagedQuestionIds = useMemo(
    () => pagedQuestions.map((question) => question.question_id).filter(Boolean),
    [pagedQuestions]
  );
  const missingPagedQuestionIds = useMemo(
    () => pagedQuestionIds.filter((questionId) => attachedAgentsByQuestionId[questionId] === undefined),
    [attachedAgentsByQuestionId, pagedQuestionIds]
  );
  const selectedCount = selectedQuestionIds.size;
  const selectedQuestions = useMemo(
    () => questions.filter((question) => selectedQuestionIds.has(question.question_id)),
    [questions, selectedQuestionIds]
  );
  const selectedFilteredCount = filteredQuestionIds.filter((id) => selectedQuestionIds.has(id)).length;
  const allFilteredSelected = filteredQuestionIds.length > 0 && selectedFilteredCount === filteredQuestionIds.length;
  const selectedPageCount = pagedQuestionIds.filter((id) => selectedQuestionIds.has(id)).length;
  const allPageSelected = pagedQuestionIds.length > 0 && selectedPageCount === pagedQuestionIds.length;

  useEffect(() => {
    if (!hasManagePermission || missingPagedQuestionIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        missingPagedQuestionIds.map((questionId) => axios.get(`/api/questions/${questionId}/attached-agents`))
      );
      if (cancelled) return;
      setAttachedAgentsByQuestionId((prev) => {
        const next = { ...prev };
        missingPagedQuestionIds.forEach((questionId, index) => {
          const result = results[index];
          if (result.status === "fulfilled") {
            next[questionId] = parseAttachedAgentsPayload(result.value.data);
          } else if (next[questionId] === undefined) {
            next[questionId] = [];
          }
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [hasManagePermission, missingPagedQuestionIds]);

  const handleSelectAllFiltered = () => {
    setSelectedQuestionIds(new Set(filteredQuestionIds));
  };

  const handleSelectAllPublished = () => {
    const publishedIds = filteredQuestions
      .filter((question) => question.access_scope === "public")
      .map((question) => question.question_id)
      .filter(Boolean);
    setSelectedQuestionIds(new Set(publishedIds));
  };

  const handleToggleSelectAllPage = (checked: boolean) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      pagedQuestionIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedQuestionIds(new Set());
  };

  const handleDownloadFeedbackSheet = async () => {
    if (selectedQuestions.length === 0) {
      showTopToast("Please select at least one question.");
      return;
    }

    const sortedQuestions = [...selectedQuestions].sort((a, b) =>
      String(a.question_id).localeCompare(String(b.question_id), undefined, { numeric: true, sensitivity: "base" })
    );
    const maxOptionCount = sortedQuestions.reduce(
      (max, question) => Math.max(max, question.options?.length ?? 0),
      0
    );

    const headers: string[] = [
      "question_id",
      "question_type",
      "question_content",
      "manual_slide_ids",
    ];
    for (let idx = 1; idx <= maxOptionCount; idx += 1) {
      headers.push(`option_${idx}_id`, `option_${idx}_text`);
    }

    const attachedHumanAgentMap = new Map<string, { agent_id: string; title?: string }>();
    try {
      const attachedAgentResponses = await Promise.allSettled(
        sortedQuestions.map((question) => axios.get(`/api/questions/${question.question_id}/attached-agents`))
      );
      attachedAgentResponses.forEach((result) => {
        if (result.status !== "fulfilled") return;
        parseAttachedAgentsPayload(result.value.data).forEach((item) => {
          const agentId = item.agent_id;
          const role = item.role ?? "";
          if (!agentId) return;
          if (role && role !== "human") return;
          attachedHumanAgentMap.set(agentId, {
            agent_id: agentId,
            title: item.title || undefined,
          });
        });
      });
    } catch (error) {
      console.error("Failed to fetch attached agents for feedback sheet:", error);
    }

    const normalizedAgents = Array.from(attachedHumanAgentMap.values()).map((agent) => ({
      ...agent,
      headerPrefix: `agent_${agent.agent_id}_${sanitizeFeedbackSheetHeader(agent.title || "untitled")}`,
    }));
    if (normalizedAgents.length === 0) {
      showTopToast("No attached feedback agents found on selected questions.");
    }

    normalizedAgents.forEach((agent) => {
      headers.push(`${agent.headerPrefix}_question_feedback`);
      for (let idx = 1; idx <= maxOptionCount; idx += 1) {
        headers.push(`${agent.headerPrefix}_option_${idx}_feedback`);
      }
    });

    const rows: Array<Record<string, string>> = sortedQuestions.map((question) => {
      const optionCount = question.options?.length ?? 0;
      const isFreeTextQuestion = String(question.question_type_raw || question.type || "")
        .toLowerCase()
        .includes("free");
      const row: Record<string, string> = {
        question_id: question.question_id,
        question_type: String(question.question_type_raw || question.type || ""),
        question_content: getQuestionContentForFeedbackSheet(question),
        manual_slide_ids: "",
      };

      for (let idx = 1; idx <= maxOptionCount; idx += 1) {
        const option = question.options?.[idx - 1];
        row[`option_${idx}_id`] = option ? String(option.interaction_option_id ?? "") : "N/A";
        row[`option_${idx}_text`] = option ? String(option.text ?? "") : "N/A";
      }

      normalizedAgents.forEach((agent) => {
        row[`${agent.headerPrefix}_question_feedback`] = isFreeTextQuestion ? "" : "N/A";
        for (let idx = 1; idx <= maxOptionCount; idx += 1) {
          row[`${agent.headerPrefix}_option_${idx}_feedback`] = idx <= optionCount ? "" : "N/A";
        }
      });

      return row;
    });

    const csv = toCsvText(headers, rows);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    anchor.href = url;
    anchor.download = `feedback_sheet_${ts}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
    showTopToast(
      `Feedback sheet downloaded: ${sortedQuestions.length} question${sortedQuestions.length === 1 ? "" : "s"}, ${normalizedAgents.length} agent${normalizedAgents.length === 1 ? "" : "s"}.`
    );
  };

  const handleUploadFeedbackSheet = async (file: File) => {
    if (!manageUserId) {
      showFeedbackUploadResultModal("Upload feedback sheet failed.", [
        "[ERR] Missing user ID. Please refresh and try again.",
      ]);
      return;
    }

    setIsUploadingFeedbackSheet(true);
    setFeedbackUploadSummary("");
    setFeedbackUploadResultLines([]);
    setIsFeedbackUploadResultModalOpen(false);
    try {
      const text = await file.text();
      const { headers, rows } = parseFeedbackSheetCsv(text);
      if (headers.length === 0 || rows.length === 0) {
        showFeedbackUploadResultModal("Upload feedback sheet failed.", [
          "[ERR] Feedback sheet is empty.",
        ]);
        return;
      }

      const lowerHeaderMap = new Map<string, string>();
      headers.forEach((header) => lowerHeaderMap.set(header.trim().toLowerCase(), header));
      const questionIdHeader = lowerHeaderMap.get("question_id");
      const manualSlideIdsHeader = lowerHeaderMap.get("manual_slide_ids");
      if (!questionIdHeader) {
        showFeedbackUploadResultModal("Upload feedback sheet failed.", [
          "[ERR] Invalid sheet: missing question_id column.",
        ]);
        return;
      }

      const optionIdHeaders = new Map<number, string>();
      headers.forEach((header) => {
        const match = header.trim().toLowerCase().match(/^option_(\d+)_id$/);
        if (!match) return;
        optionIdHeaders.set(Number(match[1]), header);
      });

      const questionIdsInSheet = Array.from(
        new Set(
          rows
            .map((row) => String(row[questionIdHeader] ?? "").trim())
            .filter(Boolean)
        )
      );
      if (questionIdsInSheet.length === 0) {
        showFeedbackUploadResultModal("Upload feedback sheet failed.", [
          "[ERR] Invalid sheet: no question_id values found.",
        ]);
        return;
      }
      const perQuestionHumanAgentIds = new Map<string, Set<string>>();
      const knownHumanAgentIds = new Set<string>();
      const attachedAgentResults = await Promise.allSettled(
        questionIdsInSheet.map((questionId) => axios.get(`/api/questions/${questionId}/attached-agents`))
      );
      attachedAgentResults.forEach((result, idx) => {
        const questionId = questionIdsInSheet[idx];
        const ids = new Set<string>();
        if (result.status === "fulfilled") {
          parseAttachedAgentsPayload(result.value.data).forEach((agent) => {
            if (agent.role && agent.role !== "human") return;
            ids.add(agent.agent_id);
            knownHumanAgentIds.add(agent.agent_id);
          });
        }
        perQuestionHumanAgentIds.set(questionId, ids);
      });
      const sortedKnownAgentIds = Array.from(knownHumanAgentIds).sort((a, b) => b.length - a.length);
      if (sortedKnownAgentIds.length === 0 && !manualSlideIdsHeader) {
        showFeedbackUploadResultModal("Upload feedback sheet failed.", [
          "[ERR] No attached feedback agents found on selected questions, and manual_slide_ids column is missing.",
        ]);
        return;
      }

      const agentColumns = headers
        .map((header) => parseFeedbackSheetAgentColumn(header, sortedKnownAgentIds))
        .filter(Boolean) as Array<{ header: string; agent_id: string; type: "question" | "option"; optionIndex?: number }>;
      if (agentColumns.length === 0 && !manualSlideIdsHeader) {
        showFeedbackUploadResultModal("Upload feedback sheet failed.", [
          "[ERR] No feedback columns found in sheet and manual_slide_ids column is missing.",
        ]);
        return;
      }

      const resultLines: string[] = [];
      let updatedRowCount = 0;
      let failedRowCount = 0;
      let skippedRowCount = 0;

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx += 1) {
        const row = rows[rowIdx];
        const displayRow = rowIdx + 2;
        const questionId = String(row[questionIdHeader] ?? "").trim();
        if (!questionId) {
          skippedRowCount += 1;
          resultLines.push(`[SKIP] Row ${displayRow}: missing question_id.`);
          continue;
        }

        const allowedAgentIds = perQuestionHumanAgentIds.get(questionId) ?? new Set<string>();

        try {
          const manualSlideIds = manualSlideIdsHeader
            ? parseManualSlideIdsCell(row[manualSlideIdsHeader])
            : [];
          const nonUuidSlideIds = manualSlideIds.filter((id) => !UUID_REGEX.test(id));
          if (nonUuidSlideIds.length > 0) {
            throw new Error(`manual_slide_ids contains non-UUID values: ${nonUuidSlideIds.slice(0, 5).join(", ")}`);
          }

          let rowUpdateCalls = 0;
          if (manualSlideIds.length > 0) {
            const detailRes = await axios.get(`/api/questions/${questionId}`, {
              params: {
                include: "current_version,content_blocks,interactions,options,interaction_options,slide_scope,feedback_links",
              },
            });
            const versionPayload = buildQuestionVersionPayloadWithSlides(detailRes.data, manageUserId, manualSlideIds);
            await axios.post(`/api/questions/${questionId}/versions`, versionPayload);
            rowUpdateCalls += 1;
          }

          const updatesByAgent = new Map<
            string,
            { questionFeedbackText?: string; optionFeedbackByIndex: Map<number, string> }
          >();
          agentColumns.forEach((column) => {
            if (!allowedAgentIds.has(column.agent_id)) return;
            const value = String(row[column.header] ?? "").trim();
            if (isFeedbackSheetNullLike(value)) return;
            const existing = updatesByAgent.get(column.agent_id) ?? { optionFeedbackByIndex: new Map<number, string>() };
            if (column.type === "question") {
              existing.questionFeedbackText = value;
            } else if (column.optionIndex && column.optionIndex > 0) {
              existing.optionFeedbackByIndex.set(column.optionIndex, value);
            }
            updatesByAgent.set(column.agent_id, existing);
          });

          const hasFeedbackUpdates = updatesByAgent.size > 0;
          if (hasFeedbackUpdates && allowedAgentIds.size === 0) {
            throw new Error("has feedback values but no attached human agents on this question.");
          }

          let currentOptionIdByIndex = new Map<number, string>();
          if (hasFeedbackUpdates) {
            const latestDetailRes = await axios.get(`/api/questions/${questionId}`, {
              params: {
                include: "current_version,content_blocks,interactions,options,interaction_options,slide_scope,feedback_links",
              },
            });
            const latestQuestion = parseSemanticQuestion(latestDetailRes.data);
            currentOptionIdByIndex = new Map(
              (latestQuestion.options ?? [])
                .map((option, idx) => [idx + 1, String(option.interaction_option_id ?? "").trim()] as const)
                .filter(([, optionId]) => Boolean(optionId))
            );
          }

          for (const [agentId, update] of updatesByAgent.entries()) {
            const hasOptionFeedback = update.optionFeedbackByIndex.size > 0;
            if (update.questionFeedbackText && !hasOptionFeedback) {
              await axios.patch(`/api/questions/${questionId}/attached-agents/${agentId}/static-feedback`, {
                updated_by: manageUserId,
                question_feedback_text: update.questionFeedbackText,
              });
              rowUpdateCalls += 1;
            }

            if (update.optionFeedbackByIndex.size > 0) {
              const optionIndices = Array.from(update.optionFeedbackByIndex.keys()).sort((a, b) => a - b);
              const option_feedback = optionIndices.map((index) => {
                const interaction_option_id = currentOptionIdByIndex.get(index) ?? "";
                const feedback_text = String(update.optionFeedbackByIndex.get(index) ?? "").trim();
                return { interaction_option_id, feedback_text };
              });
              if (option_feedback.some((item) => !item.interaction_option_id || !item.feedback_text)) {
                throw new Error(
                  `agent ${agentId} option feedback is incomplete, please fill all option feedback cells.`
                );
              }
              await axios.patch(`/api/questions/${questionId}/attached-agents/${agentId}/static-feedback`, {
                updated_by: manageUserId,
                expected_option_count: option_feedback.length,
                option_feedback,
              });
              rowUpdateCalls += 1;
            }
          }

          if (rowUpdateCalls === 0) {
            skippedRowCount += 1;
            resultLines.push(`[SKIP] Row ${displayRow}: ${questionId} has no manual_slide_ids or feedback updates.`);
            continue;
          }

          updatedRowCount += 1;
          resultLines.push(
            `[OK] Row ${displayRow}: ${questionId} updated (${rowUpdateCalls} request${rowUpdateCalls === 1 ? "" : "s"}).`
          );
        } catch (error) {
          failedRowCount += 1;
          const text = (() => {
            if (axios.isAxiosError(error)) {
              const data = error.response?.data as any;
              const detail = data?.detail;
              if (typeof detail === "string" && detail.trim()) return detail;
              if (detail !== undefined) {
                try {
                  return JSON.stringify(detail);
                } catch {
                  return String(detail);
                }
              }
              if (typeof data?.message === "string" && data.message.trim()) return data.message;
              return error.message;
            }
            if (error instanceof Error) return error.message;
            return "Unknown error";
          })();
          resultLines.push(`[ERR] Row ${displayRow}: ${questionId} failed (${text}).`);
        }
      }

      await fetchQuestions();
      const summary = `Upload feedback sheet finished: ${updatedRowCount} updated, ${failedRowCount} failed, ${skippedRowCount} skipped.`;
      showFeedbackUploadResultModal(summary, resultLines);
    } catch (error) {
      const detail = (() => {
        if (axios.isAxiosError(error)) {
          const data = error.response?.data as any;
          const message = typeof data?.message === "string" ? data.message.trim() : "";
          if (message) return message;
          const rawDetail = data?.detail;
          if (typeof rawDetail === "string" && rawDetail.trim()) return rawDetail;
          if (rawDetail !== undefined) {
            try {
              return JSON.stringify(rawDetail);
            } catch {
              return String(rawDetail);
            }
          }
          return error.message;
        }
        if (error instanceof Error) return error.message;
        return "Unknown error";
      })();
      showFeedbackUploadResultModal("Upload feedback sheet failed.", [`[ERR] ${detail}`]);
    } finally {
      setIsUploadingFeedbackSheet(false);
    }
  };

  const handleFeedbackSheetInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await handleUploadFeedbackSheet(file);
  };

  const runBatchQuestionMutation = async (endpoint: string, ids: string[], actionLabel: string) => {
    if (!manageUserId) {
      throw new Error("Missing user ID. Please refresh and try again.");
    }
    const res = await axios.post<BatchQuestionMutationResponse>(endpoint, {
      question_ids: ids,
      updated_by: manageUserId,
    });
    const summary = summarizeBatchQuestionMutation(actionLabel, res.data, ids.length);
    setMessage(summary);
    if (res.data?.failed_count || (res.data?.failed?.length ?? 0) > 0) {
      const failedPreview = (res.data.failed ?? [])
        .slice(0, 3)
        .map((item) => `${item.question_id ?? "unknown"} (${item.code ?? "ERROR"})`)
        .join(", ");
      if (failedPreview) {
        setMessage(`${summary} Failed: ${failedPreview}${(res.data.failed?.length ?? 0) > 3 ? ", ..." : ""}`);
      }
    }
    setSelectedQuestionIds(new Set());
    await fetchQuestions();
    return res.data;
  };

  const handleBulkDeleteQuestions = async () => {
    const ids = Array.from(selectedQuestionIds);
    if (ids.length === 0) return;
    if (!manageUserId) {
      alert("Missing user ID. Please refresh and try again.");
      return;
    }

    const confirmed = window.confirm(`Delete ${ids.length} selected question${ids.length === 1 ? "" : "s"}?`);
    if (!confirmed) return;

    setDeleting("__bulk__");
    try {
      await runBatchQuestionMutation("/api/questions/batch/delete", ids, "Delete");
    } catch (error) {
      console.error("Error deleting selected questions:", error);
      alert(error instanceof Error ? error.message : "Failed to delete selected questions.");
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkAttachFeedbackAgent = () => {
    const ids = Array.from(selectedQuestionIds);
    if (ids.length === 0) return;
    setAttachAgentsError(null);
    setSelectedAttachAgentId("");
    setIsAttachAgentModalOpen(true);
  };

  const parsedBatchDrafts = useMemo(
    () => parseBatchMarkdownToDrafts(batchMarkdownContent, batchUploadMapping),
    [batchMarkdownContent, batchUploadMapping]
  );
  const parsedBatchTableKeys = useMemo(() => {
    const tables = parseKeyValueTablesFromMarkdown(batchMarkdownContent);
    const keys = new Set<string>();
    tables.forEach((table) => Object.keys(table).forEach((key) => keys.add(key)));
    return Array.from(keys).sort();
  }, [batchMarkdownContent]);
  const parsedBatchValueSamplesForKind = useMemo(() => {
    const tables = parseKeyValueTablesFromMarkdown(batchMarkdownContent);
    const values = new Set<string>();
    const kindKey = batchUploadMapping.kindKey.trim().toLowerCase();
    if (!kindKey) return [];
    tables.forEach((table) => {
      const value = String(table[kindKey] ?? "").trim();
      if (value) values.add(value.toLowerCase());
    });
    return Array.from(values).sort();
  }, [batchMarkdownContent, batchUploadMapping.kindKey]);
  const parsedBatchPrefixCandidates = useMemo(() => {
    const prefixes = new Set<string>();
    parsedBatchTableKeys.forEach((key) => {
      const match = key.match(/^([a-z_]+)\d+$/i);
      if (match?.[1]) prefixes.add(match[1].toLowerCase());
    });
    return Array.from(prefixes).sort();
  }, [parsedBatchTableKeys]);
  const isBatchFeedbackAttachEnabled = batchAttachedAgents.length > 0;
  const mappedHumanAgentConfigs = useMemo(
    () =>
      batchAttachedAgents.filter(
        (agent) => (agent.role ?? "").toLowerCase() === "human" && agent.mapFeedback
      ),
    [batchAttachedAgents]
  );
  const isBatchQuestionLevelFeedbackEnabled = mappedHumanAgentConfigs.some((agent) =>
    Boolean(agent.questionFeedbackKey.trim())
  );
  const isBatchOptionLevelFeedbackEnabled = mappedHumanAgentConfigs.some((agent) =>
    Boolean(agent.optionFeedbackPrefix.trim())
  );
  const hasBatchDraftIssues = useMemo(
    () =>
      parsedBatchDrafts.some(
        (draft) =>
          getBatchDraftIssues(draft, {
            requireQuestionLevelFeedback: isBatchQuestionLevelFeedbackEnabled,
            requireOptionLevelFeedback: isBatchOptionLevelFeedbackEnabled,
          }).length > 0
      ),
    [isBatchOptionLevelFeedbackEnabled, isBatchQuestionLevelFeedbackEnabled, parsedBatchDrafts]
  );
  const availableBatchAttachAgents = useMemo(
    () => attachAgents.filter((agent) => !batchAttachedAgents.some((item) => item.agent_id === agent.agent_id)),
    [attachAgents, batchAttachedAgents]
  );

  useEffect(() => {
    if (availableBatchAttachAgents.length === 0) {
      if (batchAttachAgentCandidateId) setBatchAttachAgentCandidateId("");
      return;
    }
    if (!batchAttachAgentCandidateId) return;
    const stillExists = availableBatchAttachAgents.some(
      (agent) => agent.agent_id === batchAttachAgentCandidateId
    );
    if (!stillExists) setBatchAttachAgentCandidateId("");
  }, [availableBatchAttachAgents, batchAttachAgentCandidateId]);

  const handleCloseBatchUploadModal = () => {
    if (batchUploadRunning) return;
    setIsBatchUploadModalOpen(false);
    setBatchUploadError(null);
    setBatchUploadProgressText(null);
    setBatchUploadResultLines([]);
    setBatchMarkdownContent("");
    setBatchAttachedAgents([]);
    setBatchAttachAgentCandidateId("");
    setShowBatchMarkdownContent(false);
    setBatchUploadStep(1);
    setBatchUploadMaxStep(1);
    setBatchUploadMapping(DEFAULT_BATCH_UPLOAD_FIELD_MAPPING);
  };

  const handleBatchMarkdownFile = async (file: File) => {
    const text = await file.text();
    setBatchMarkdownContent(text);
    setBatchUploadError(null);
    setBatchUploadResultLines([]);
  };
  const updateBatchUploadMapping = (key: keyof BatchUploadFieldMapping, value: string) => {
    setBatchUploadMapping((prev) => ({ ...prev, [key]: value }));
  };
  const getBatchDraftQuestionFeedbackByKey = (draft: BatchUploadParsedDraft, key: string) => {
    const normalized = key.trim().toLowerCase();
    if (!normalized) return "";
    return String(draft.sourceTable?.[normalized] ?? "").trim();
  };
  const getBatchDraftOptionFeedbacksByPrefix = (
    draft: BatchUploadParsedDraft,
    prefix: string,
    optionCount: number
  ) => {
    const normalized = prefix.trim().toLowerCase();
    if (!normalized || optionCount <= 0) return [];
    return Array.from({ length: optionCount }, (_, idx) =>
      String(draft.sourceTable?.[`${normalized}${idx + 1}`] ?? "").trim()
    );
  };
  const goToBatchUploadStep = (step: BatchUploadWizardStep) => {
    if (step > batchUploadMaxStep) return;
    setBatchUploadStep(step);
  };
  const unlockAndGoToBatchUploadStep = (step: BatchUploadWizardStep) => {
    setBatchUploadMaxStep((prev) => (prev > step ? prev : step));
    setBatchUploadStep(step);
  };

  const executeBatchUpload = async () => {
    if (!manageUserId) {
      setBatchUploadError("Missing user ID. Please refresh and try again.");
      return;
    }
    if (parsedBatchDrafts.length === 0) {
      setBatchUploadError("No valid Notebook/MCQ rows found in markdown.");
      return;
    }

    setBatchUploadRunning(true);
    setBatchUploadError(null);
    const resultLines: string[] = [];
    let successCount = 0;
    let shouldCloseModalAfterSuccess = false;

    try {
      for (let i = 0; i < parsedBatchDrafts.length; i += 1) {
        const draft = parsedBatchDrafts[i];
        setBatchUploadProgressText(`Importing ${i + 1}/${parsedBatchDrafts.length}...`);
        try {
          const questionType: CreateQuestionType = draft.kind === "mcq" ? "single_choice" : "free_text";
          const loSuffix = draft.lo ? ` (${draft.lo})` : "";
          const promptText = `${DEFAULT_PROMPT_TEXT[questionType]}${loSuffix}`;
          const optionsPayload =
            questionType === "single_choice"
              ? buildSingleChoiceOptionsForBatch(draft.choices ?? [], draft.correctChoiceIndex ?? null)
              : [];
          if (questionType === "single_choice") {
            if (optionsPayload.length < 2 || optionsPayload.filter((item) => item.is_correct).length !== 1) {
              throw new Error(`MCQ row ${i + 1} has invalid choices/correct mapping.`);
            }
          }
          const normalizedSlideIds = Array.from(
            new Set((draft.slideIds ?? []).map((value) => String(value).trim()).filter(Boolean))
          );
          const nonUuidSlideIds = normalizedSlideIds.filter((id) => !UUID_REGEX.test(id));
          if (nonUuidSlideIds.length > 0) {
            throw new Error(
              `Row ${i + 1} contains non-UUID slide_id(s): ${nonUuidSlideIds.slice(0, 5).join(", ")}`
            );
          }

          const createPayload = {
            question_type: questionType,
            title: null,
            access_scope: "private" as const,
            created_by: manageUserId,
            content_blocks: draft.contentBlocks.map((block, idx) => ({
              block_type: block.block_type,
              text_content: block.text_content?.trim() || null,
              media_url: block.media_url?.trim() || null,
              alt_text: block.alt_text?.trim() || null,
              block_order: idx + 1,
            })),
            interactions: [
              {
                interaction_type: questionType,
                interaction_order: 1,
                prompt_text: promptText,
                is_required: true,
                max_score: 1,
                ...(questionType === "single_choice" ? { options: optionsPayload } : {}),
              },
            ],
            slide_ids: normalizedSlideIds,
            slide_scope: normalizedSlideIds.map((slideId) => ({
              slide_id: slideId,
              page_start: null,
              page_end: null,
            })),
            scoring_policy: {
              score_maximum: 1,
              score_input_format: "fraction",
              score_normalize_to_maximum: true,
              score_rounding_mode: "none",
              score_rounding_step: 1,
            },
          };

          const createRes = await axios.post("/api/questions", createPayload);
          let created = parseSemanticQuestion(createRes.data);
          let createdQuestionId = created.question_id || String(createRes.data?.question_id ?? "");
          if (!createdQuestionId) throw new Error(`Row ${i + 1} create succeeded but missing question_id.`);

          if (isBatchFeedbackAttachEnabled) {
            for (const agentConfig of batchAttachedAgents) {
              const agentId = agentConfig.agent_id;
              await axios.post(`/api/questions/${createdQuestionId}/attached-agents`, {
                agent_id: agentId,
                updated_by: manageUserId,
              });

              const isHumanAgent = (agentConfig.role ?? "").toLowerCase() === "human";
              const shouldMapFeedback = isHumanAgent && agentConfig.mapFeedback;
              if (!shouldMapFeedback) continue;

              if (draft.kind === "notebook") {
                if (agentConfig.questionFeedbackKey.trim()) {
                  const questionFeedbackText = getBatchDraftQuestionFeedbackByKey(
                    draft,
                    agentConfig.questionFeedbackKey
                  );
                  if (!questionFeedbackText) {
                    throw new Error(`Row ${i + 1} question-level feedback is empty (agent ${agentId}).`);
                  }
                  await axios.patch(
                    `/api/questions/${createdQuestionId}/attached-agents/${agentId}/static-feedback`,
                    {
                      updated_by: manageUserId,
                      question_feedback_text: questionFeedbackText,
                    }
                  );
                }
              } else {
                if (agentConfig.optionFeedbackPrefix.trim()) {
                  if (!created.options?.length || created.options.some((opt) => !opt.interaction_option_id)) {
                    const detailRes = await axios.get(`/api/questions/${createdQuestionId}`, {
                      params: {
                        include: "current_version,content_blocks,interactions,options,interaction_options,slide_scope,feedback_links",
                      },
                    });
                    created = parseSemanticQuestion(detailRes.data);
                  }
                  const optionRows = created.options ?? [];
                  const optionFeedbacks = getBatchDraftOptionFeedbacksByPrefix(
                    draft,
                    agentConfig.optionFeedbackPrefix,
                    optionRows.length
                  );
                  if (!optionRows.length || optionRows.some((row) => !row.interaction_option_id)) {
                    throw new Error(`Row ${i + 1} could not resolve interaction_option_id.`);
                  }
                  if (optionRows.length !== optionFeedbacks.length) {
                    throw new Error(`Row ${i + 1} option count mismatch after create.`);
                  }
                  const option_feedback = optionRows.map((option, idx) => ({
                    interaction_option_id: String(option.interaction_option_id),
                    feedback_text: String(optionFeedbacks[idx] ?? "").trim(),
                  }));
                  if (option_feedback.some((row) => !row.feedback_text)) {
                    throw new Error(`Row ${i + 1} contains empty option feedback (agent ${agentId}).`);
                  }
                  await axios.patch(
                    `/api/questions/${createdQuestionId}/attached-agents/${agentId}/static-feedback`,
                    {
                      updated_by: manageUserId,
                      expected_option_count: option_feedback.length,
                      option_feedback,
                    }
                  );
                }
              }
            }
          }

          successCount += 1;
          resultLines.push(`✅ Row ${i + 1}: imported as ${createdQuestionId}`);
        } catch (err) {
          const text = (() => {
            if (axios.isAxiosError(err)) {
              const data = err.response?.data as any;
              const detail = data?.detail;
              if (typeof detail === "string" && detail.trim()) return detail;
              if (detail !== undefined) {
                try {
                  return JSON.stringify(detail, null, 2);
                } catch {
                  return String(detail);
                }
              }
              if (typeof data?.message === "string" && data.message.trim()) return data.message;
              return err.message;
            }
            if (err instanceof Error) return err.message;
            return "Unknown error";
          })();
          resultLines.push(`❌ Row ${i + 1}: ${text}`);
        }
      }

      setBatchUploadResultLines(resultLines);
      if (successCount > 0) {
        showTopToast(`Batch upload completed: ${successCount}/${parsedBatchDrafts.length} imported.`);
      }
      if (successCount === parsedBatchDrafts.length && parsedBatchDrafts.length > 0) {
        shouldCloseModalAfterSuccess = true;
      }
      await fetchQuestions();
    } finally {
      setBatchUploadProgressText(null);
      setBatchUploadRunning(false);
      if (shouldCloseModalAfterSuccess) {
        handleCloseBatchUploadModal();
      }
    }
  };

  const handleCloseAttachAgentModal = () => {
    if (isAttachingAgent) return;
    setIsAttachAgentModalOpen(false);
    setAttachAgentsError(null);
    setSelectedAttachAgentId("");
  };

  const selectedAttachAgent = useMemo(
    () => attachAgents.find((agent) => agent.agent_id === selectedAttachAgentId) ?? null,
    [attachAgents, selectedAttachAgentId]
  );
  const selectedQuestionsExistingLinksForSelectedAgent = useMemo(() => {
    if (!selectedAttachAgentId) return [];
    return selectedQuestions
      .map((question) => ({
        question,
        links: (question.feedback_links ?? []).filter((link) => link.agent_id === selectedAttachAgentId),
      }))
      .filter((row) => row.links.length > 0);
  }, [selectedAttachAgentId, selectedQuestions]);
  const selectedQuestionsWithExistingStaticForSelectedAgent = useMemo(
    () =>
      selectedQuestionsExistingLinksForSelectedAgent.filter((row) =>
        row.links.some((link) => Boolean(link.static_feedback_text?.trim()))
      ),
    [selectedQuestionsExistingLinksForSelectedAgent]
  );
  const selectedQuestionsExistingAttachmentsForSelectedAgent = useMemo(() => {
    if (!selectedAttachAgentId) return [];
    return selectedQuestions
      .map((question) => {
        const attachments = attachedAgentsByQuestionId[question.question_id] ?? [];
        const matches = attachments.filter((item) => item.agent_id === selectedAttachAgentId);
        return { question, matches };
      })
      .filter((row) => row.matches.length > 0);
  }, [attachedAgentsByQuestionId, selectedAttachAgentId, selectedQuestions]);

  const handleConfirmAttachFeedbackAgent = async () => {
    const ids = Array.from(selectedQuestionIds);
    if (ids.length === 0) {
      setAttachAgentsError("No questions selected.");
      return;
    }
    if (!selectedAttachAgentId) {
      setAttachAgentsError("Please choose a feedback agent.");
      return;
    }
    if (!manageUserId) {
      setAttachAgentsError("Missing user ID. Please refresh and try again.");
      return;
    }
    setIsAttachingAgent(true);
    try {
      const payload: Record<string, unknown> = {
        question_ids: ids,
        agent_id: selectedAttachAgentId,
        updated_by: manageUserId,
      };

      const res = await axios.post<BatchQuestionMutationResponse>("/api/questions/batch/attach-feedback-agent", payload);
      const queuedJobs = Array.isArray(res.data?.queued_feedback_generation)
        ? res.data.queued_feedback_generation.filter((item) => item?.job_id)
        : [];
      const enqueueFailedCount = Array.isArray(res.data?.enqueue_failed) ? res.data.enqueue_failed.length : 0;
      const base = summarizeBatchQuestionMutation("Attach feedback agent", res.data, ids.length);
      const queueSuffix =
        queuedJobs.length > 0 || enqueueFailedCount > 0
          ? ` Queued generation: ${queuedJobs.length}${enqueueFailedCount ? `, enqueue failed: ${enqueueFailedCount}` : ""}.`
          : "";
      showTopToast(base + queueSuffix);
      setSelectedQuestionIds(new Set());
      setIsAttachAgentModalOpen(false);
      setSelectedAttachAgentId("");
      await fetchQuestions();
    } catch (error) {
      console.error("Error attaching feedback agent:", error);
      if (axios.isAxiosError(error)) {
        const responseData = error.response?.data as any;
        const detail = responseData?.detail;
        if (error.response?.status === 422 && detail !== undefined) {
          if (typeof detail === "object" && detail !== null) {
            setAttachAgentsError(`422 Validation Error\n${JSON.stringify(detail, null, 2)}`);
            return;
          }
          setAttachAgentsError(`422 Validation Error\n${String(detail)}`);
          return;
        }
        if (typeof detail === "string") {
          setAttachAgentsError(detail);
          return;
        }
        if (typeof responseData?.message === "string") {
          setAttachAgentsError(responseData.message);
          return;
        }
      }
      setAttachAgentsError(error instanceof Error ? error.message : "Failed to attach feedback agent.");
    } finally {
      setIsAttachingAgent(false);
    }
  };

  const handleBulkPublishQuestions = async () => {
    const ids = Array.from(selectedQuestionIds);
    if (ids.length === 0) return;
    const confirmed = window.confirm(`Publish ${ids.length} selected question${ids.length === 1 ? "" : "s"}?`);
    if (!confirmed) return;
    try {
      await runBatchQuestionMutation("/api/questions/batch/publish", ids, "Publish");
    } catch (error) {
      console.error("Error publishing selected questions:", error);
      alert(error instanceof Error ? error.message : "Failed to publish selected questions.");
    }
  };

  const handleBulkUnpublishQuestions = async () => {
    const ids = Array.from(selectedQuestionIds);
    if (ids.length === 0) return;
    const confirmed = window.confirm(`Unpublish ${ids.length} selected question${ids.length === 1 ? "" : "s"}?`);
    if (!confirmed) return;
    try {
      await runBatchQuestionMutation("/api/questions/batch/unpublish", ids, "Unpublish");
    } catch (error) {
      console.error("Error unpublishing selected questions:", error);
      alert(error instanceof Error ? error.message : "Failed to unpublish selected questions.");
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "created_at" ? "desc" : "asc");
  };

  const getPlayerHref = (question: Question) => {
    if (question.type === "multiple choice") return `/mcq/${question.question_id}${ltiQuery}`;
    return `/oeq/${question.question_id}${ltiQuery}`;
  };

  const questionColumns: ManageTableColumn<Question>[] = [
    {
      id: "select",
      headerClassName: "w-[1%] whitespace-nowrap px-3 py-3 text-left font-semibold text-slate-700",
      header: (
        <label className="inline-flex items-center text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={allPageSelected}
            onChange={(e) => handleToggleSelectAllPage(e.target.checked)}
            aria-label="Select all questions on current page"
            className="h-4 w-4 rounded border-slate-300"
          />
        </label>
      ),
      cellClassName: "w-[1%] whitespace-nowrap px-3 py-3 align-top",
      renderCell: (question) => (
        <input
          type="checkbox"
          checked={selectedQuestionIds.has(question.question_id)}
          onChange={(e) => toggleQuestionSelection(question.question_id, e.target.checked)}
          aria-label={`Select question ${question.question_id}`}
          className="mt-1 h-4 w-4 rounded border-slate-300"
        />
      ),
    },
    {
      id: "preview",
      headerClassName: "w-[45%] px-4 py-3 text-left font-semibold text-slate-700",
      header: (
        <button
          type="button"
          onClick={() => handleSort("preview")}
          className="inline-flex items-center gap-1 hover:text-slate-900"
        >
          Question
          <span className="text-slate-400">{sortIndicator("preview")}</span>
        </button>
      ),
      cellClassName: "px-4 py-3 align-top",
      renderCell: (question) => {
        const imagePreview = getQuestionImagePreview(question);
        const feedbackLinks = question.feedback_links ?? [];
        const attachedAgents = attachedAgentsByQuestionId[question.question_id] ?? [];
        const optionCount = question.options?.length ?? 0;
        const feedbackByAgentMap = new Map<
          string,
          {
            attachmentId?: string;
            agentId: string;
            agentTitle: string;
            role: string;
            hasContent: boolean;
            passedTest: boolean;
            optionFeedbackCount: number;
          }
        >();

        attachedAgents.forEach((item) => {
          const agentId = String(item.agent_id ?? "").trim();
          if (!agentId) return;
          const attachmentId = String(item.attachment_id ?? "").trim() || undefined;
          const attachKey = attachmentId || agentId;
          const hasAttachedContent =
            Boolean(String(item.question_feedback_text ?? "").trim()) ||
            Number(item.option_feedback_count ?? 0) > 0;
          const attachedStatus = String(item.generation_status ?? "").trim().toLowerCase();
          feedbackByAgentMap.set(attachKey, {
            attachmentId,
            agentId,
            agentTitle: String(item.title ?? "").trim(),
            role: String(item.role ?? "").trim().toLowerCase(),
            hasContent: hasAttachedContent,
            passedTest: PASSED_GENERATION_STATUSES.has(attachedStatus),
            optionFeedbackCount: Number(item.option_feedback_count ?? 0),
          });
        });

        feedbackLinks.forEach((link) => {
          const agentId = String(link.agent_id ?? "").trim();
          if (!agentId) return;
          const status = String(link.generation_status ?? "").trim().toLowerCase();
          const attachKey = `${agentId}::unknown`;
          const existing = feedbackByAgentMap.get(attachKey) ?? {
            attachmentId: undefined,
            agentId,
            agentTitle: "",
            role: "",
            hasContent: false,
            passedTest: false,
            optionFeedbackCount: 0,
          };
          if (!existing.agentTitle && link.agent_title) existing.agentTitle = String(link.agent_title).trim();
          if (Boolean(link.static_feedback_text?.trim())) existing.hasContent = true;
          if (PASSED_GENERATION_STATUSES.has(status)) existing.passedTest = true;
          feedbackByAgentMap.set(attachKey, existing);
        });

        const feedbackByAgent = Array.from(feedbackByAgentMap.values());
        return (
          <div className="flex min-w-0 items-start gap-3">
            {imagePreview ? (
              <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <DynamicImage
                  src={imagePreview}
                  alt="Question preview"
                  maxWidth={180}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : null}
            <div className="min-w-0">
              <Link
                href={`/manage/question/${question.question_id}${ltiQuery}`}
                className="block underline-offset-4 hover:text-blue-700 hover:underline"
              >
                <p className="line-clamp-2 break-words text-sm font-medium text-slate-900">
                  {getQuestionTextPreview(question)}
                </p>
              </Link>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">{question.question_id}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {feedbackByAgent.length > 0 ? (
                  feedbackByAgent.map((agent) => (
                    (() => {
                      const isHuman = agent.role === "human";
                      const humanFeedbackComplete =
                        optionCount > 0
                          ? agent.optionFeedbackCount >= optionCount
                          : agent.hasContent;
                      const isGreen = isHuman
                        ? humanFeedbackComplete
                        : agent.passedTest || agent.hasContent;
                      return (
                        <div
                          key={`${question.question_id}-feedback-agent-${agent.attachmentId || agent.agentId}`}
                          className={`flex items-center rounded-full border px-2 py-0.5 text-xs ${
                            isGreen
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-rose-200 bg-rose-50 text-rose-800"
                          }`}
                        >
                          <span className="max-w-[180px] truncate font-medium">
                            {agent.agentTitle || agent.agentId}
                          </span>
                        </div>
                      );
                    })()
                  ))
                ) : (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
                    No feedback agent
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: "type",
      headerClassName: "w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700",
      header: (
        <button
          type="button"
          onClick={() => handleSort("type")}
          className="inline-flex items-center gap-1 hover:text-slate-900"
        >
          Type
          <span className="text-slate-400">{sortIndicator("type")}</span>
        </button>
      ),
      cellClassName: "w-[1%] whitespace-nowrap px-4 py-3 align-top",
      renderCell: (question) => (
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
            {question.question_type_raw || question.type || "Unknown"}
          </span>
        </div>
      ),
    },
    {
      id: "scope",
      headerClassName: "w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700",
      header: "Scope",
      cellClassName: "w-[1%] whitespace-nowrap px-4 py-3 align-top",
      renderCell: (question) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
            question.access_scope === "public"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {question.access_scope || "-"}
        </span>
      ),
    },
    {
      id: "created_at",
      headerClassName: "w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700",
      header: (
        <button
          type="button"
          onClick={() => handleSort("created_at")}
          className="inline-flex items-center gap-1 hover:text-slate-900"
        >
          Created
          <span className="text-slate-400">{sortIndicator("created_at")}</span>
        </button>
      ),
      cellClassName: "w-[1%] whitespace-nowrap px-4 py-3 align-top text-slate-600",
      renderCell: (question) => formatCreatedAt(question.created_at),
    },
    {
      id: "actions",
      headerClassName: "w-[1%] whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700",
      header: "Actions",
      cellClassName: "w-[1%] whitespace-nowrap px-4 py-3 align-top",
      renderCell: (question) => (
        <div className="flex justify-end gap-2">
          <Link href={getPlayerHref(question)}>
            <ActionButton variant="success" size="sm" className="rounded-lg">
              View
            </ActionButton>
          </Link>
          <Link href={`/manage/question/${question.question_id}`}>
            <ActionButton variant="secondary" size="sm" className="rounded-lg">
              Update Feedback
            </ActionButton>
          </Link>
        </div>
      ),
    },
  ];

  if (isPermissionChecking || !hasManagePermission) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      {topToastMessage ? (
        <div className="fixed left-1/2 top-16 z-[70] -translate-x-1/2">
          <div className="max-w-[min(90vw,760px)] whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-2 text-sm text-white shadow-xl backdrop-blur-sm">
            {topToastMessage}
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Question Management
              </p>
              <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
                Your Questions
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                Browse, search, and manage questions used in your content workflows.
              </p>
              {message ? (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {message}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <ManageListPanel
          toolbarLeft={(
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                onClick={() => setIsModalOpen(true)}
                variant="primary"
                className="rounded-lg px-3.5 py-2"
              >
                Create Question
              </ActionButton>
              <ActionButton
                onClick={() => setIsBatchUploadModalOpen(true)}
                variant="secondary"
                className="rounded-lg px-3.5 py-2"
              >
                Batch Upload (.md)
              </ActionButton>
            </div>
          )}
          toolbarRight={(
            <>
              <div className="relative w-full md:w-96">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search ID, type, or question text..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-300"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  ⌕
                </span>
              </div>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
              >
                {typeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === "all" ? "All types" : option}
                  </option>
                ))}
              </select>
              <ActionButton
                onClick={() => fetchQuestions()}
                variant="neutral"
                size="sm"
                className="rounded-xl"
              >
                {isFetchingQuestions ? "Refreshing..." : "Refresh"}
              </ActionButton>
            </>
          )}
          table={(
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Batch Actions
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                      {selectedCount} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap items-stretch gap-3">
                    <div className="rounded-lg border border-slate-200 bg-white p-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Selection
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          type="button"
                          variant={allFilteredSelected ? "neutral" : "ghost"}
                          size="sm"
                          className="rounded-lg"
                          onClick={handleSelectAllFiltered}
                          disabled={filteredQuestionIds.length === 0}
                        >
                          Select All
                        </ActionButton>
                        <ActionButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-lg"
                          onClick={handleSelectAllPublished}
                          disabled={!filteredQuestions.some((question) => question.access_scope === "public")}
                        >
                          Select All Published
                        </ActionButton>
                        <ActionButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-lg"
                          onClick={handleClearSelection}
                          disabled={selectedCount === 0}
                        >
                          Clear Selection
                        </ActionButton>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Question
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          type="button"
                          variant="success"
                          size="sm"
                          className="rounded-lg"
                          onClick={handleBulkPublishQuestions}
                          disabled={selectedCount === 0}
                        >
                          Publish
                        </ActionButton>
                        <ActionButton
                          type="button"
                          variant="warning"
                          size="sm"
                          className="rounded-lg"
                          onClick={handleBulkUnpublishQuestions}
                          disabled={selectedCount === 0}
                        >
                          Unpublish
                        </ActionButton>
                        <ActionButton
                          type="button"
                          variant="danger"
                          size="sm"
                          className="rounded-lg"
                          onClick={handleBulkDeleteQuestions}
                          disabled={selectedCount === 0 || Boolean(deleting)}
                        >
                          {deleting === "__bulk__" ? "Deleting..." : "Delete"}
                        </ActionButton>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Feedback
                      </div>
                      <input
                        ref={feedbackSheetInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={handleFeedbackSheetInputChange}
                      />
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-lg"
                          onClick={handleDownloadFeedbackSheet}
                          disabled={selectedCount === 0}
                        >
                          Download Feedback Sheet
                        </ActionButton>
                        <ActionButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-lg"
                          onClick={() => feedbackSheetInputRef.current?.click()}
                          disabled={isUploadingFeedbackSheet}
                        >
                          {isUploadingFeedbackSheet ? "Uploading..." : "Upload Feedback Sheet"}
                        </ActionButton>
                        <ActionButton
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="rounded-lg"
                          onClick={handleBulkAttachFeedbackAgent}
                          disabled={selectedCount === 0}
                        >
                          Attach Feedback Agent
                        </ActionButton>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <ManageDataTable
                rows={pagedQuestions}
                rowKey={(question, index) => question.question_id || `question-${index}`}
                columns={questionColumns}
                rowClassName="transition-colors hover:bg-slate-50/70"
                emptyContent={normalizedSearch ? "No matching questions found." : "No questions available."}
                expandableRows={{
                  getRowId: (question) => question.question_id,
                  isRowExpandable: (question) =>
                    Boolean(
                      question.question_id ||
                      question.objective?.length ||
                      question.slide_ids?.length ||
                      question.slide_scope?.length ||
                      question.content?.length ||
                      question.options?.length
                    ),
                  toggleAriaLabel: (question, _rowIndex, isExpanded) =>
                    `${isExpanded ? "Collapse" : "Expand"} details for question ${question.question_id}`,
                  renderExpandedContent: (question) => <QuestionExpandedContent question={question} />,
                }}
              />
            </div>
          )}
          pagination={{
            currentPage,
            totalPages,
            tokens: paginationTokens,
            isLoading: isFetchingQuestions,
            onPrev: () => setCurrentPage((prev) => Math.max(1, prev - 1)),
            onNext: () => setCurrentPage((prev) => Math.min(totalPages, prev + 1)),
            onPageSelect: (page) => setCurrentPage(page),
          }}
          summary={(
            <p className="text-center text-sm text-slate-500">
              Showing {displayedCount} question{displayedCount === 1 ? "" : "s"} of {sortedQuestions.length}
              {normalizedSearch || typeFilter !== "all" ? " filtered" : ""} (page {currentPage} of {totalPages})
            </p>
          )}
        />

        <ManageModal
          open={isAttachAgentModalOpen}
          onClose={handleCloseAttachAgentModal}
          title="Attach Feedback Agent"
          description={`Attach one feedback agent to ${selectedCount} selected question${selectedCount === 1 ? "" : "s"}.`}
          maxWidthClassName="max-w-3xl"
          disableClose={isAttachingAgent}
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="attachFeedbackAgentId" className="mb-1 block text-sm font-medium text-slate-700">
                Feedback Agent
              </label>
              <select
                id="attachFeedbackAgentId"
                value={selectedAttachAgentId}
                onChange={(e) => {
                  setSelectedAttachAgentId(e.target.value);
                  setAttachAgentsError(null);
                }}
                disabled={isFetchingAttachAgents || isAttachingAgent}
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300 disabled:bg-slate-50"
              >
                <option value="">
                  {isFetchingAttachAgents ? "Loading feedback agents..." : "Select a feedback agent"}
                </option>
                {attachAgents.map((agent) => (
                  <option key={agent.agent_id} value={agent.agent_id}>
                    {(agent.title || "(Untitled agent)") +
                      ` · ${agent.role || "-"} · ${agent.access_scope || "-"} · ${agent.agent_id}`}
                  </option>
                ))}
              </select>
            </div>
            {attachAgentsError ? (
              <p className="whitespace-pre-wrap text-xs text-rose-700">{attachAgentsError}</p>
            ) : null}

            <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900">Agent Details</div>
              {selectedAttachAgent ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Title</div>
                      <div className="mt-1 text-sm text-slate-800">{selectedAttachAgent.title || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Role</div>
                      <div className="mt-1 text-sm text-slate-800">
                        {selectedAttachAgent.role || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Provider / Model</div>
                      <div className="mt-1 text-sm text-slate-800">
                        {[selectedAttachAgent.provider, selectedAttachAgent.model].filter(Boolean).join(" / ") || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Scope</div>
                      <div className="mt-1 text-sm text-slate-800">{selectedAttachAgent.access_scope || "-"}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-slate-500">Inputs</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {getFeedbackAgentInputKeys(selectedAttachAgent).length > 0 ? (
                        getFeedbackAgentInputKeys(selectedAttachAgent).map((key) => (
                          <span
                            key={`${selectedAttachAgent.agent_id}-input-${key}`}
                            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
                          >
                            {key}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-500">(none)</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-slate-500">Prompt Template</div>
                    <div className="mt-1 rounded-xl border border-slate-200 bg-white p-3">
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                        {selectedAttachAgent.prompt_text?.trim() || "(empty)"}
                      </pre>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Created</div>
                      <div className="mt-1 text-sm text-slate-700">{formatDateTime(selectedAttachAgent.created_at)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Updated</div>
                      <div className="mt-1 text-sm text-slate-700">{formatDateTime(selectedAttachAgent.updated_at)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  {isFetchingAttachAgents ? "Loading agent details..." : "Select an agent to preview details."}
                </div>
              )}
            </div>

            {selectedAttachAgent ? (
              <div
                className={`rounded-2xl border p-4 ${
                  selectedQuestionsExistingAttachmentsForSelectedAgent.length > 0
                    ? "border-amber-200 bg-amber-50/50"
                    : "border-slate-200 bg-slate-50/40"
                }`}
              >
                <div className="text-sm font-semibold text-slate-900">Overwrite Risk Check</div>
                {selectedQuestionsExistingAttachmentsForSelectedAgent.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-amber-800">
                      {selectedQuestionsExistingAttachmentsForSelectedAgent.length} selected question
                      {selectedQuestionsExistingAttachmentsForSelectedAgent.length === 1 ? "" : "s"} already have this attachment.
                    </p>
                    {selectedQuestionsWithExistingStaticForSelectedAgent.length > 0 ? (
                      <p className="text-xs text-amber-800">
                        {selectedQuestionsWithExistingStaticForSelectedAgent.length} question
                        {selectedQuestionsWithExistingStaticForSelectedAgent.length === 1 ? "" : "s"} already contain static feedback text for this agent.
                      </p>
                    ) : null}
                    <div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-amber-200 bg-white p-2">
                      {selectedQuestionsExistingAttachmentsForSelectedAgent.slice(0, 8).map(({ question, matches }) => (
                        <div key={`attach-risk-${question.question_id}`} className="text-xs text-slate-700">
                          <span className="font-mono">{question.question_id}</span>
                          <span className="ml-2 text-slate-500">
                            {matches.length} attachment{matches.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      ))}
                      {selectedQuestionsExistingAttachmentsForSelectedAgent.length > 8 ? (
                        <div className="text-xs text-slate-500">
                          +{selectedQuestionsExistingAttachmentsForSelectedAgent.length - 8} more
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-600">No existing links found for the selected agent on current selection.</p>
                )}
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  Selected Questions ({selectedQuestions.length})
                </div>
                <div className="text-xs text-slate-500">Preview before attach</div>
              </div>
              {selectedQuestions.length > 0 ? (
                <div className="max-h-56 space-y-2 overflow-auto">
                  {selectedQuestions.map((question) => (
                    <div
                      key={`attach-preview-${question.question_id}`}
                      className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">{question.question_id}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            question.access_scope === "public"
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          {question.access_scope || "-"}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-800">
                        {getQuestionTextPreview(question)}
                      </div>
                      {selectedAttachAgent ? (
                        <div className="mt-1 text-xs text-slate-500">
                          Attach target: {selectedAttachAgent.title || selectedAttachAgent.agent_id}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No selected questions.</div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <ActionButton
                type="button"
                variant="ghost"
                className="rounded-lg"
                onClick={handleCloseAttachAgentModal}
                disabled={isAttachingAgent}
              >
                Cancel
              </ActionButton>
              <ActionButton
                type="button"
                variant="secondary"
                className="rounded-lg"
                onClick={() => {
                  void handleConfirmAttachFeedbackAgent();
                }}
                disabled={
                  isAttachingAgent ||
                  isFetchingAttachAgents ||
                  !selectedAttachAgentId
                }
              >
                {isAttachingAgent ? "Attaching..." : "Attach Feedback Agent"}
              </ActionButton>
            </div>
          </div>
        </ManageModal>

        <ManageModal
          open={isBatchUploadModalOpen}
          onClose={handleCloseBatchUploadModal}
          title="Batch Upload Questions"
          description="Upload markdown containing Question tables, then import all rows."
          maxWidthClassName="max-w-4xl"
          disableClose={batchUploadRunning}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="grid grid-cols-4 gap-2">
                {([
                  { id: 1, label: "1. Upload" },
                  { id: 2, label: "2. Question Mapping" },
                  { id: 3, label: "3. Agents" },
                  { id: 4, label: "4. Final Preview" },
                ] as Array<{ id: BatchUploadWizardStep; label: string }>).map((step) => {
                  const isActive = batchUploadStep === step.id;
                  const isUnlocked = step.id <= batchUploadMaxStep;
                  return (
                    <button
                      key={`batch-step-${step.id}`}
                      type="button"
                      disabled={!isUnlocked || batchUploadRunning}
                      onClick={() => goToBatchUploadStep(step.id)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                        isActive
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : isUnlocked
                            ? "border-slate-200 bg-white text-slate-700"
                            : "border-slate-100 bg-slate-100 text-slate-400"
                      }`}
                    >
                      {step.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {batchUploadStep === 1 ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="batchMarkdownFile" className="mb-1 block text-sm font-medium text-slate-700">
                    Markdown File (.md)
                  </label>
                  <input
                    id="batchMarkdownFile"
                    type="file"
                    accept=".md,text/markdown"
                    disabled={batchUploadRunning}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await handleBatchMarkdownFile(file);
                    }}
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-sm font-medium text-slate-700">Markdown Content (read-only)</label>
                    <ActionButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-lg"
                      disabled={batchUploadRunning}
                      onClick={() => setShowBatchMarkdownContent((prev) => !prev)}
                    >
                      {showBatchMarkdownContent ? "Hide" : "Show"}
                    </ActionButton>
                  </div>
                  {showBatchMarkdownContent ? (
                    <textarea
                      id="batchMarkdownContent"
                      value={batchMarkdownContent}
                      readOnly
                      rows={14}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 shadow-sm outline-none"
                    />
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Hidden. Upload another `.md` file above to replace current content.
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Current parse with default mapping: {parsedBatchDrafts.length} importable row
                  {parsedBatchDrafts.length === 1 ? "" : "s"}.
                </div>
              </div>
            ) : null}

            {batchUploadStep === 2 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">Question Creation Mapping</div>
                  <ActionButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-lg"
                    disabled={batchUploadRunning}
                    onClick={() => setBatchUploadMapping(DEFAULT_BATCH_UPLOAD_FIELD_MAPPING)}
                  >
                    Reset Default
                  </ActionButton>
                </div>
                <div className="overflow-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Pick Markdown Marker</th>
                        <th className="px-3 py-2 font-semibold">Import Target</th>
                        <th className="px-3 py-2 font-semibold">What This Controls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      <tr>
                        <td className="px-3 py-2">
                          <select
                            value={batchUploadMapping.kindKey}
                            onChange={(e) => updateBatchUploadMapping("kindKey", e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value={batchUploadMapping.kindKey}>{batchUploadMapping.kindKey || "(custom)"}</option>
                            {parsedBatchTableKeys
                              .filter((key) => key !== batchUploadMapping.kindKey)
                              .map((key) => (
                                <option key={`map-kind-${key}`} value={key}>
                                  {key}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">Question Type</div>
                          <div className="mt-0.5 text-[11px] text-rose-700">Required</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">Source column used to identify row type.</td>
                      </tr>
                      <tr className="bg-slate-50/40">
                        <td className="px-3 py-2">
                          <div className="pl-4">
                            <select
                              value={batchUploadMapping.kindNotebookValue}
                              onChange={(e) => updateBatchUploadMapping("kindNotebookValue", e.target.value)}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="">none</option>
                              <option value={batchUploadMapping.kindNotebookValue}>
                                {batchUploadMapping.kindNotebookValue || "(custom)"}
                              </option>
                              {parsedBatchValueSamplesForKind
                                .filter((value) => value !== batchUploadMapping.kindNotebookValue)
                                .map((value) => (
                                  <option key={`kind-notebook-${value}`} value={value}>
                                    {value}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="pl-4 font-medium text-slate-700">↳ Question Type Value (free_text)</div>
                        </td>
                        <td className="px-3 py-2 pl-7 text-slate-600">Maps marker value to system type `free_text`.</td>
                      </tr>
                      <tr className="bg-slate-50/40">
                        <td className="px-3 py-2">
                          <div className="pl-4">
                            <select
                              value={batchUploadMapping.kindMcqValue}
                              onChange={(e) => updateBatchUploadMapping("kindMcqValue", e.target.value)}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="">none</option>
                              <option value={batchUploadMapping.kindMcqValue}>
                                {batchUploadMapping.kindMcqValue || "(custom)"}
                              </option>
                              {parsedBatchValueSamplesForKind
                                .filter((value) => value !== batchUploadMapping.kindMcqValue)
                                .map((value) => (
                                  <option key={`kind-mcq-${value}`} value={value}>
                                    {value}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="pl-4 font-medium text-slate-700">↳ Question Type Value (single_choice)</div>
                        </td>
                        <td className="px-3 py-2 pl-7 text-slate-600">Maps marker value to system type `single_choice`.</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2">
                          <select
                            value={batchUploadMapping.stemKey}
                            onChange={(e) => updateBatchUploadMapping("stemKey", e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value={batchUploadMapping.stemKey}>{batchUploadMapping.stemKey || "(custom)"}</option>
                            {parsedBatchTableKeys
                              .filter((key) => key !== batchUploadMapping.stemKey)
                              .map((key) => (
                                <option key={`map-stem-${key}`} value={key}>
                                  {key}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">Content Blocks</div>
                          <div className="mt-0.5 text-[11px] text-rose-700">Required</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">Main question text imported into content blocks.</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2">
                          <select
                            value={batchUploadMapping.loKey}
                            onChange={(e) => updateBatchUploadMapping("loKey", e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value="">none</option>
                            <option value={batchUploadMapping.loKey}>{batchUploadMapping.loKey || "(custom)"}</option>
                            {parsedBatchTableKeys
                              .filter((key) => key !== batchUploadMapping.loKey)
                              .map((key) => (
                                <option key={`map-lo-${key}`} value={key}>
                                  {key}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">Interaction Prompt</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">Optional</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">Optional LO suffix appended to prompt template.</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2">
                          <select
                            value={batchUploadMapping.slideIdsKey}
                            onChange={(e) => updateBatchUploadMapping("slideIdsKey", e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value="">none</option>
                            <option value={batchUploadMapping.slideIdsKey}>
                              {batchUploadMapping.slideIdsKey || "(custom)"}
                            </option>
                            {parsedBatchTableKeys
                              .filter((key) => key !== batchUploadMapping.slideIdsKey)
                              .map((key) => (
                                <option key={`map-slide-ids-${key}`} value={key}>
                                  {key}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">Slide Binding</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">Optional</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          Column for `slide_id` / `slide_ids`; supports comma/newline separated UUIDs.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2">
                          <select
                            value={batchUploadMapping.correctKey}
                            onChange={(e) => updateBatchUploadMapping("correctKey", e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value={batchUploadMapping.correctKey}>{batchUploadMapping.correctKey || "(custom)"}</option>
                            {parsedBatchTableKeys
                              .filter((key) => key !== batchUploadMapping.correctKey)
                              .map((key) => (
                                <option key={`map-correct-${key}`} value={key}>
                                  {key}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">Correct Option</div>
                          <div className="mt-0.5 text-[11px] text-rose-700">Required for MCQ</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">Marks the correct option for `single_choice`.</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2">
                          <select
                            value={batchUploadMapping.choicePrefix}
                            onChange={(e) => updateBatchUploadMapping("choicePrefix", e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value={batchUploadMapping.choicePrefix}>{batchUploadMapping.choicePrefix || "(custom)"}</option>
                            {parsedBatchPrefixCandidates
                              .filter((prefix) => prefix !== batchUploadMapping.choicePrefix)
                              .map((prefix) => (
                                <option key={`map-choice-prefix-${prefix}`} value={prefix}>
                                  {prefix}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">Multiple Choice Options</div>
                          <div className="mt-0.5 text-[11px] text-rose-700">Required for MCQ</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">Prefix for option text columns (`choice1`, `choice2`, ...).</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <div className="mb-1 text-xs font-medium text-slate-600">Detected keys in markdown</div>
                  <div className="flex flex-wrap gap-1">
                    {parsedBatchTableKeys.length > 0 ? (
                      parsedBatchTableKeys.map((key) => (
                        <span key={`detected-key-${key}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                          {key}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">(none)</span>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {batchUploadStep === 3 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Attach Agents + Feedback Mapping</div>
                <p className="mt-1 text-xs text-slate-600">
                  Attach agents first. For human agents, you can optionally map question-level / option-level feedback.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <div className="text-sm font-medium text-slate-700">Attach Agent</div>
                  <select
                    value={batchAttachAgentCandidateId}
                    onChange={(e) => setBatchAttachAgentCandidateId(e.target.value)}
                    disabled={batchUploadRunning || isFetchingAttachAgents || availableBatchAttachAgents.length === 0}
                    className="min-w-[260px] rounded-md border border-slate-200 px-2 py-1 text-xs"
                  >
                    {availableBatchAttachAgents.length === 0 ? (
                      <option value="">No available agent</option>
                    ) : (
                      <>
                        <option value="">Select agent...</option>
                        {availableBatchAttachAgents.map((agent) => (
                          <option key={`batch-attach-candidate-${agent.agent_id}`} value={agent.agent_id}>
                            {(agent.title || "(Untitled agent)") +
                              ` · ${agent.role || "-"} · ${agent.agent_id}`}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  <ActionButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-lg"
                    disabled={
                      batchUploadRunning ||
                      isFetchingAttachAgents ||
                      !batchAttachAgentCandidateId ||
                      !availableBatchAttachAgents.some((agent) => agent.agent_id === batchAttachAgentCandidateId)
                    }
                    onClick={() => {
                      const target = attachAgents.find((agent) => agent.agent_id === batchAttachAgentCandidateId);
                      if (!target) return;
                      setBatchAttachedAgents((prev) => [
                        ...prev,
                        {
                          agent_id: target.agent_id,
                          title: target.title,
                          role: target.role,
                          mapFeedback: false,
                          questionFeedbackKey: batchUploadMapping.questionFeedbackKey,
                          optionFeedbackPrefix: batchUploadMapping.optionFeedbackPrefix,
                        },
                      ]);
                    }}
                  >
                    Attach Agent
                  </ActionButton>
                </div>
                {batchAttachedAgents.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {batchAttachedAgents.map((agent) => {
                      const isHuman = (agent.role ?? "").toLowerCase() === "human";
                      return (
                        <div
                          key={`batch-attached-agent-${agent.agent_id}`}
                          className="rounded-xl border border-slate-200 bg-slate-50/50 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium text-slate-800">
                              {(agent.title || "(Untitled agent)") +
                                ` · ${agent.role || "-"} · ${agent.agent_id}`}
                            </div>
                            <ActionButton
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="rounded-lg"
                              disabled={batchUploadRunning}
                              onClick={() =>
                                setBatchAttachedAgents((prev) =>
                                  prev.filter((item) => item.agent_id !== agent.agent_id)
                                )
                              }
                            >
                              Remove
                            </ActionButton>
                          </div>
                          {isHuman ? (
                            <div className="mt-3">
                              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={agent.mapFeedback}
                                  onChange={(e) =>
                                    setBatchAttachedAgents((prev) =>
                                      prev.map((item) =>
                                        item.agent_id === agent.agent_id
                                          ? { ...item, mapFeedback: e.target.checked }
                                          : item
                                      )
                                    )
                                  }
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Map feedback for this human agent
                              </label>
                              {agent.mapFeedback ? (
                                <div className="mt-3 overflow-auto rounded-xl border border-slate-200 bg-white">
                                  <table className="min-w-full text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-600">
                                      <tr>
                                        <th className="px-3 py-2 font-semibold">Pick Markdown Marker</th>
                                        <th className="px-3 py-2 font-semibold">Import Target</th>
                                        <th className="px-3 py-2 font-semibold">What This Controls</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                      <tr>
                                        <td className="px-3 py-2">
                                          <select
                                            value={agent.questionFeedbackKey}
                                            onChange={(e) =>
                                              setBatchAttachedAgents((prev) =>
                                                prev.map((item) =>
                                                  item.agent_id === agent.agent_id
                                                    ? { ...item, questionFeedbackKey: e.target.value }
                                                    : item
                                                )
                                              )
                                            }
                                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                                          >
                                            <option value="">none</option>
                                            <option value={agent.questionFeedbackKey}>
                                              {agent.questionFeedbackKey || "(custom)"}
                                            </option>
                                            {parsedBatchTableKeys
                                              .filter((key) => key !== agent.questionFeedbackKey)
                                              .map((key) => (
                                                <option key={`map-qfb-${agent.agent_id}-${key}`} value={key}>
                                                  {key}
                                                </option>
                                              ))}
                                          </select>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="font-medium text-slate-700">Default Human Feedback (Question-level)</div>
                                          <div className="mt-0.5 text-[11px] text-slate-500">Optional</div>
                                        </td>
                                        <td className="px-3 py-2 text-slate-600">
                                          Question-level static feedback for `free_text`. `none` means skip.
                                        </td>
                                      </tr>
                                      <tr>
                                        <td className="px-3 py-2">
                                          <select
                                            value={agent.optionFeedbackPrefix}
                                            onChange={(e) =>
                                              setBatchAttachedAgents((prev) =>
                                                prev.map((item) =>
                                                  item.agent_id === agent.agent_id
                                                    ? { ...item, optionFeedbackPrefix: e.target.value }
                                                    : item
                                                )
                                              )
                                            }
                                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                                          >
                                            <option value="">none</option>
                                            <option value={agent.optionFeedbackPrefix}>
                                              {agent.optionFeedbackPrefix || "(custom)"}
                                            </option>
                                            {parsedBatchPrefixCandidates
                                              .filter((prefix) => prefix !== agent.optionFeedbackPrefix)
                                              .map((prefix) => (
                                                <option
                                                  key={`map-ofb-${agent.agent_id}-${prefix}`}
                                                  value={prefix}
                                                >
                                                  {prefix}
                                                </option>
                                              ))}
                                          </select>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="font-medium text-slate-700">Default Human Feedback (Option-level)</div>
                                          <div className="mt-0.5 text-[11px] text-slate-500">Optional</div>
                                        </td>
                                        <td className="px-3 py-2 text-slate-600">
                                          Per-option static feedback for `single_choice`. `none` means skip.
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-slate-500">
                              This non-human agent will be attached only (no feedback mapping).
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {isBatchFeedbackAttachEnabled ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {`Part 2 enabled for ${batchAttachedAgents.length} agent(s). Question-level mapping: ${
                      isBatchQuestionLevelFeedbackEnabled ? "on" : "none"
                    }, option-level mapping: ${isBatchOptionLevelFeedbackEnabled ? "on" : "none"}.`}
                  </div>
                ) : null}
              </div>
            ) : null}

            {batchUploadStep === 4 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                <div className="text-sm font-semibold text-slate-900">Final Preview</div>
                <div className="mt-1 text-xs text-slate-600">
                  Found {parsedBatchDrafts.length} importable row{parsedBatchDrafts.length === 1 ? "" : "s"}.
                </div>
                <div className="mt-3 max-h-56 space-y-2 overflow-auto">
                  {parsedBatchDrafts.length > 0 ? (
                    parsedBatchDrafts.map((draft, idx) => {
                      const issues = getBatchDraftIssues(draft, {
                        requireQuestionLevelFeedback: isBatchQuestionLevelFeedbackEnabled,
                        requireOptionLevelFeedback: isBatchOptionLevelFeedbackEnabled,
                      });
                      const choices = draft.choices ?? [];
                      const optionFeedbacks = draft.optionFeedbacks ?? [];
                      const questionType: CreateQuestionType = draft.kind === "mcq" ? "single_choice" : "free_text";
                      const interactionPromptPreview = `${DEFAULT_PROMPT_TEXT[questionType]}${draft.lo ? ` (${draft.lo})` : ""}`;
                      return (
                        <div key={`batch-preview-${idx}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-700">
                              Row {idx + 1} · {draft.kind === "mcq" ? "MCQ" : "Notebook"}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 ${
                                issues.length === 0
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {issues.length === 0 ? "Ready" : `${issues.length} issue(s)`}
                            </span>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{draft.stem}</div>
                          <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700">
                            <span className="font-medium text-slate-600">Interaction Prompt:</span> {interactionPromptPreview}
                          </div>
                          <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700">
                            <span className="font-medium text-slate-600">Slide Binding:</span>{" "}
                            {draft.slideIds.length > 0 ? draft.slideIds.join(", ") : "(none)"}
                          </div>
                          <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700">
                            <span className="font-medium text-slate-600">Execution:</span>{" "}
                            {isBatchFeedbackAttachEnabled
                              ? `create question + attach ${batchAttachedAgents.length} agent(s) [question-level: ${
                                  isBatchQuestionLevelFeedbackEnabled ? "on" : "none"
                                }, option-level: ${isBatchOptionLevelFeedbackEnabled ? "on" : "none"}]`
                              : "create question only (feedback ignored)"}
                          </div>
                          {draft.kind === "mcq" ? (
                            <div className="mt-2 space-y-1 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs">
                              <div className="text-slate-600">
                                choices: {choices.length} · correct:{" "}
                                {typeof draft.correctChoiceIndex === "number" ? draft.correctChoiceIndex + 1 : "-"}
                              </div>
                              {choices.map((choice, choiceIdx) => (
                                <div key={`batch-preview-choice-${idx}-${choiceIdx}`} className="text-slate-700">
                                  <span className="mr-1 font-medium">{choiceIdx + 1}.</span>
                                  {choice}
                                  {choiceIdx === draft.correctChoiceIndex ? " ✓" : ""}
                                  {isBatchOptionLevelFeedbackEnabled ? (
                                    <div className="ml-5 mt-0.5 whitespace-pre-wrap text-slate-500">
                                      feedback: {optionFeedbacks[choiceIdx]?.trim() || "(missing)"}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            isBatchQuestionLevelFeedbackEnabled ? (
                              <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700">
                                <span className="font-medium text-slate-600">Question Feedback:</span>
                                <div className="mt-1 whitespace-pre-wrap">
                                  {draft.questionFeedbackText?.trim() || "(missing)"}
                                </div>
                              </div>
                            ) : null
                          )}
                          {issues.length > 0 ? (
                            <ul className="mt-2 list-disc pl-4 text-xs text-amber-800">
                              {issues.map((issue, issueIdx) => (
                                <li key={`batch-preview-issue-${idx}-${issueIdx}`}>{issue}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-slate-500">No Notebook/MCQ table rows parsed yet.</div>
                  )}
                </div>
              </div>
            ) : null}

            {batchUploadError ? (
              <p className="whitespace-pre-wrap text-xs text-rose-700">{batchUploadError}</p>
            ) : null}
            {batchUploadProgressText ? (
              <p className="text-xs text-blue-700">{batchUploadProgressText}</p>
            ) : null}
            {batchUploadResultLines.length > 0 ? (
              <div className="max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white p-3">
                <pre className="whitespace-pre-wrap text-xs text-slate-700">{batchUploadResultLines.join("\n")}</pre>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <ActionButton
                type="button"
                variant="ghost"
                className="rounded-lg"
                onClick={handleCloseBatchUploadModal}
                disabled={batchUploadRunning}
              >
                Close
              </ActionButton>
              {batchUploadStep === 1 ? (
                <>
                  <ActionButton
                    type="button"
                    variant="secondary"
                    className="rounded-lg"
                    disabled={batchUploadRunning || !batchMarkdownContent.trim()}
                    onClick={() => unlockAndGoToBatchUploadStep(4)}
                  >
                    Confirm to Preview (Default)
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="primary"
                    className="rounded-lg"
                    disabled={batchUploadRunning || !batchMarkdownContent.trim()}
                    onClick={() => unlockAndGoToBatchUploadStep(2)}
                  >
                    Customize
                  </ActionButton>
                </>
              ) : null}
              {batchUploadStep === 2 ? (
                <>
                  <ActionButton
                    type="button"
                    variant="ghost"
                    className="rounded-lg"
                    disabled={batchUploadRunning}
                    onClick={() => goToBatchUploadStep(1)}
                  >
                    Back
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="secondary"
                    className="rounded-lg"
                    disabled={batchUploadRunning}
                    onClick={() => unlockAndGoToBatchUploadStep(3)}
                  >
                    Confirm Question Mapping
                  </ActionButton>
                </>
              ) : null}
              {batchUploadStep === 3 ? (
                <>
                  <ActionButton
                    type="button"
                    variant="ghost"
                    className="rounded-lg"
                    disabled={batchUploadRunning}
                    onClick={() => goToBatchUploadStep(2)}
                  >
                    Back
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="secondary"
                    className="rounded-lg"
                    disabled={batchUploadRunning}
                    onClick={() => unlockAndGoToBatchUploadStep(4)}
                  >
                    Confirm Agents to Final Preview
                  </ActionButton>
                </>
              ) : null}
              {batchUploadStep === 4 ? (
                <>
                  <ActionButton
                    type="button"
                    variant="ghost"
                    className="rounded-lg"
                    disabled={batchUploadRunning}
                    onClick={() => goToBatchUploadStep(batchUploadMaxStep >= 3 ? 3 : 1)}
                  >
                    Back
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="secondary"
                    className="rounded-lg"
                    onClick={executeBatchUpload}
                    disabled={batchUploadRunning || parsedBatchDrafts.length === 0 || hasBatchDraftIssues}
                  >
                    {batchUploadRunning
                      ? "Importing..."
                      : isBatchFeedbackAttachEnabled
                        ? `Import + Attach Feedback (${batchAttachedAgents.length} agent${batchAttachedAgents.length === 1 ? "" : "s"})`
                        : "Import Questions"}
                  </ActionButton>
                </>
              ) : null}
            </div>
          </div>
        </ManageModal>

        <ManageModal
          open={isFeedbackUploadResultModalOpen}
          onClose={() => setIsFeedbackUploadResultModalOpen(false)}
          title="Feedback Sheet Upload Result"
          description={feedbackUploadSummary || "Upload finished."}
          maxWidthClassName="max-w-3xl"
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">
                {feedbackUploadSummary || "No summary available."}
              </p>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200 bg-white p-3">
              {feedbackUploadResultLines.length > 0 ? (
                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                  {feedbackUploadResultLines.join("\n")}
                </pre>
              ) : (
                <p className="text-xs text-slate-500">No row-level messages.</p>
              )}
            </div>
          </div>
        </ManageModal>

        <ManageModal
          open={isModalOpen}
          onClose={handleCloseCreateModal}
          title="Create New Question"
          description="Configure the question content, answer settings, and related course context."
          maxWidthClassName="max-w-4xl"
          bodyClassName="pt-5"
          disableClose={loading}
        >
          <form onSubmit={(e) => {
            e.preventDefault();
            handleCreateQuestion();
          }} className="space-y-5">
            {manageUserId && !USER_ID_REGEX.test(manageUserId) ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                Invalid database user_id (`created_by`). Expected `us_...` (length 16).
              </p>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
                <label htmlFor="questionType" className="mb-1 block text-sm font-medium text-slate-700">
                  Question Type
                </label>
                <select
                  id="questionType"
                  value={newQuestionType}
                  onChange={(e) => {
                    const next = (e.target.value as CreateQuestionType) || "single_choice";
                    setNewQuestionType(next);
                    setInteractionPromptText(DEFAULT_PROMPT_TEXT[next]);
                    if (next === "free_text") {
                      setNewMcqOptions([]);
                      setCorrectAnswerIndex(null);
                    }
                  }}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                >
                  <option value="single_choice">single_choice</option>
                  <option value="free_text">free_text</option>
                </select>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
                <label htmlFor="interactionMaxScore" className="mb-1 block text-sm font-medium text-slate-700">
                  Max Score
                </label>
                <input
                  id="interactionMaxScore"
                  type="number"
                  min={0}
                  step={1}
                  value={interactionMaxScore}
                  onChange={(e) => setInteractionMaxScore(Number(e.target.value || 1))}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <label htmlFor="interactionPromptText" className="mb-1 block text-sm font-medium text-slate-700">
                Interaction Prompt (optional)
              </label>
              <textarea
                id="interactionPromptText"
                value={interactionPromptText}
                onChange={(e) => setInteractionPromptText(e.target.value)}
                rows={2}
                placeholder="e.g., Multiple Choice Question - select the best option"
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
              />
              <p className="mt-1 text-xs text-slate-500">
                Auto-filled by question type (for example, "Select one answer" / "Enter your response"), and you can edit it.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-800">Content Blocks</h3>
                <p className="text-xs text-slate-500">
                  Add the question content in order using text and image blocks.
                </p>
              </div>
              <ContentEditor
                contents={toLegacyContentsFromBlocks(contentBlocks)}
                setContents={() => {}}
                mode="semantic"
                semanticBlocks={contentBlocks}
                setSemanticBlocks={setContentBlocks}
              />
            </div>

            {newQuestionType === "single_choice" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Options</h3>
                    <p className="text-xs text-slate-500">
                      `single_choice` requires at least 2 options and exactly 1 correct option.
                    </p>
                  </div>
                  <ActionButton
                    type="button"
                    onClick={addOption}
                    variant="secondary"
                    size="sm"
                    className="rounded-lg"
                  >
                    Add option
                  </ActionButton>
                </div>

                {newMcqOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">Add at least two options.</p>
                ) : null}

                <div className="space-y-3">
                  {newMcqOptions.map((opt, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          id={`correct-${idx}`}
                          name="correctAnswer"
                          checked={correctAnswerIndex === idx}
                          onChange={() => setCorrectAnswerIndex(idx)}
                          className="mt-2 h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <input
                            type="text"
                            value={opt.text}
                            onChange={(e) => updateOption(idx, e.target.value)}
                            placeholder={`Option ${idx + 1} text`}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeOption(idx)}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-sm text-rose-700 hover:bg-rose-100"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-800">Knowledge Context</h3>
                <p className="text-xs text-slate-500">
                  Choose the course, then select modules and slides to link this question.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch">
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label htmlFor="courseId" className="block text-sm font-medium text-slate-700">
                        Course
                      </label>
                      <span className="text-xs text-slate-500">
                        {coursesLoading ? "Loading..." : `${courses.length} available`}
                      </span>
                    </div>
                    <select
                      id="courseId"
                      value={course ?? ""}
                      onChange={(e) => setCourse(e.target.value || null)}
                      className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                      disabled={coursesLoading}
                    >
                      {coursesLoading && <option>Loading courses…</option>}
                      {!coursesLoading && courses.length === 0 && <option>No courses found</option>}
                      {!coursesLoading &&
                        courses.map((c: any) => {
                          const id = c.course_id;
                          const label = c.course_title ?? `Course ${id}`;
                          return (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          );
                        })}
                    </select>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label htmlFor="moduleIds" className="block text-sm font-medium text-slate-700">
                        Modules
                      </label>
                      <span className="text-xs text-slate-500">
                        {modulesLoading ? "Loading..." : `${module.length} selected`}
                      </span>
                    </div>
                    <select
                      id="moduleIds"
                      multiple
                      value={module}
                      onChange={(e) =>
                        setModule(Array.from(e.target.selectedOptions).map((o) => o.value))
                      }
                      className="block min-h-32 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                      disabled={modulesLoading || !course}
                    >
                      {modulesLoading && <option>Loading modules…</option>}
                      {!modulesLoading && availableModules.length === 0 && <option>No modules found</option>}
                      {!modulesLoading &&
                        availableModules.map((m: any) => {
                          const id = m.module_id;
                          const label = m.module_title ?? `Module ${id}`;
                          return (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          );
                        })}
                    </select>
                    <p className="mt-2 text-xs text-slate-500">
                      Multi-select: hold Ctrl (Windows) or Cmd (Mac).
                    </p>
                  </div>
                </div>

                <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label htmlFor="slideIds" className="block text-sm font-medium text-slate-700">
                      Slides
                    </label>
                    <span className="text-xs text-slate-500">
                      {slidesLoading ? "Loading..." : `${newSlideIds.length} selected`}
                    </span>
                  </div>
                  <select
                    id="slideIds"
                    multiple
                    value={newSlideIds}
                    onChange={(e) =>
                      setNewSlideIds(Array.from(e.target.selectedOptions).map((o) => o.value))
                    }
                    className="block min-h-32 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    disabled={slidesLoading}
                  >
                    {slidesLoading && <option>Loading slides…</option>}
                    {!slidesLoading && availableSlides.length === 0 && <option>No slides found</option>}
                    {!slidesLoading &&
                      availableSlides.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.slide_title}
                        </option>
                      ))}
                  </select>
                  <p className="mt-2 text-xs text-slate-500">
                    Multi-select: hold Ctrl (Windows) or Cmd (Mac). We will attach all selected slides.
                  </p>
                </div>
              </div>
            </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <ActionButton
                  type="button"
                  onClick={handleCloseCreateModal}
                  variant="ghost"
                  className="rounded-lg"
                  disabled={loading}
                >
                  Cancel
                </ActionButton>
                <ActionButton
                  type="button"
                  onClick={() => handleCreateQuestion()}
                  disabled={loading}
                  variant="primary"
                  className="rounded-lg"
                >
                  {loading ? "Creating…" : "Create Question"}
                </ActionButton>
              </div>
            </form>
        </ManageModal>
      </div>
    </main>
  );
};

export default QuestionOverview;
