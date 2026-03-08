'use client';

import axios from 'axios';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import ActionButton from '@/app/components/ActionButton';
import DynamicImage from '@/app/components/DynamicImage';
import ManageBreadcrumb from '@/app/components/manage/ManageBreadcrumb';
import { useManagePermissionGuard } from '@/app/manage/hooks/useManagePermissionGuard';
import { formatDateTimeForUser, getUserTimeZone } from '@/app/utils/datetime';
import { Question } from '../page';

type FeedbackAgentLite = {
  agent_id: string;
  title?: string;
  role?: string;
  provider?: string;
  model?: string;
  prompt_text?: string;
  inputs?: Array<string | { input_key?: string }>;
};

type AttachedAgentLite = {
  agent_id: string;
  title?: string;
  role?: string;
  question_feedback_text?: string;
  option_feedback_count?: number;
  link_count?: number;
  generation_status?: string;
};

type FeedbackLinkLite = {
  agent_id?: string;
  agent_title?: string;
  target_type?: string;
  target_id?: string;
  static_feedback_text?: string;
  generation_status?: string;
};

type QuestionWithFeedback = Question & {
  question_version_id?: string;
  interaction_prompt_text?: string;
  feedback_links?: FeedbackLinkLite[];
  options?: Array<{ interaction_option_id?: string; text: string; isCorrect: boolean }>;
};

type HumanStaticDraft = {
  question_feedback_text: string;
  option_feedback_text_by_option_id: Record<string, string>;
};

type HumanStaticVersion = {
  version_id?: string;
  revision_no?: number;
  saved_at: string;
  draft: HumanStaticDraft;
};

type BatchAttachFeedbackAgentResponse = {
  queued_feedback_generation?: Array<{ question_id?: string; feedback_link_id?: string; job_id?: string }>;
  enqueue_failed?: Array<{ question_id?: string; message?: string; code?: string }>;
};

const readFirstString = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
};

const getNested = (obj: unknown, path: string): unknown => {
  if (!obj || typeof obj !== 'object') return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
};

const normalizeQuestionType = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ');
  if (['mcq', 'multiple choice', 'single choice', 'single select'].includes(normalized)) return 'multiple choice';
  if (['oeq', 'open ended', 'free text', 'text'].includes(normalized)) return 'open ended';
  return raw;
};

const firstNonEmptyStringArray = (...candidates: unknown[]): string[] => {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const values = candidate.map((item) => String(item ?? '').trim()).filter(Boolean);
    if (values.length > 0) return values;
  }
  return [];
};

const extractBlockImageUrl = (block: unknown): string =>
  readFirstString(
    getNested(block, 'url'),
    getNested(block, 'src'),
    getNested(block, 'image_url'),
    getNested(block, 'media_url'),
    getNested(block, 'content.url'),
    getNested(block, 'content.src'),
    getNested(block, 'payload.url'),
    getNested(block, 'payload.src'),
    getNested(block, 'data.url'),
    getNested(block, 'data.src')
  );

const extractBlockText = (block: unknown): string =>
  readFirstString(
    getNested(block, 'content'),
    getNested(block, 'text'),
    getNested(block, 'text_content'),
    getNested(block, 'value'),
    getNested(block, 'body'),
    getNested(block, 'payload.text'),
    getNested(block, 'payload.content'),
    getNested(block, 'data.text'),
    getNested(block, 'data.content')
  );

const extractFeedbackLinks = (value: unknown): FeedbackLinkLite[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const agent_id = readFirstString(
        record.agent_id,
        record.feedback_agent_id,
        getNested(record, 'feedback_agent.agent_id'),
        getNested(record, 'agent.agent_id'),
        getNested(record, 'feedback_agent.id'),
        getNested(record, 'agent.id')
      );
      const target_id = readFirstString(
        record.target_id,
        record.target_entity_id,
        record.resource_id,
        record.entity_id,
        record.object_id,
        record.question_version_id,
        record.interaction_option_id
      );
      if (!agent_id || !target_id) return null;
      return {
        agent_id,
        agent_title: readFirstString(
          getNested(record, 'feedback_agent.title'),
          getNested(record, 'feedback_agent.name'),
          getNested(record, 'agent.title'),
          getNested(record, 'agent.name')
        ) || undefined,
        target_type: String(
          record.target_type ??
            record.target_entity_type ??
            record.link_type ??
            record.resource_type ??
            record.entity_type ??
            record.object_type ??
            ''
        )
          .trim()
          .toLowerCase() || undefined,
        target_id,
        static_feedback_text: readFirstString(record.static_feedback_text, record.feedback_text, record.text) || undefined,
        generation_status: readFirstString(record.generation_status, getNested(record, 'generation.status')) || undefined,
      } satisfies FeedbackLinkLite;
    })
    .filter(Boolean) as FeedbackLinkLite[];
};

const extractOptions = (raw: any): Array<{ interaction_option_id?: string; text: string; isCorrect: boolean }> => {
  const interactions = Array.isArray(raw?.interactions)
    ? raw.interactions
    : Array.isArray(raw?.current_version?.interactions)
      ? raw.current_version.interactions
      : [];
  const firstInteraction = interactions[0] ?? {};
  const direct = Array.isArray(raw?.options) ? raw.options : [];
  const topInteraction = Array.isArray(raw?.interaction_options) ? raw.interaction_options : [];
  const nested =
    Array.isArray(firstInteraction?.options)
      ? firstInteraction.options
      : Array.isArray(firstInteraction?.interaction_options)
        ? firstInteraction.interaction_options
        : [];
  const source = direct.length ? direct : topInteraction.length ? topInteraction : nested;
  return source
    .map((option: any) => ({
      interaction_option_id: readFirstString(option?.interaction_option_id, option?.interactionOptionId, option?.option_id, option?.id) || undefined,
      text: String(option?.text ?? option?.option_text ?? option?.label ?? option?.option_label ?? option?.option_value ?? option?.content ?? '').trim(),
      isCorrect: Boolean(option?.is_correct ?? option?.isCorrect ?? option?.correct),
    }))
    .filter((option: { interaction_option_id?: string; text: string; isCorrect: boolean }) => option.text || option.isCorrect);
};

const extractQuestionSlideScope = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: Array<{
    slide_scope_id?: string;
    slide_id: string;
    page_start?: number | null;
    page_end?: number | null;
    course_id?: string;
    course_title?: string;
    module_id?: string;
    module_title?: string;
    slide_title?: string;
  }> = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const slideRecord =
      record.slide && typeof record.slide === 'object' ? (record.slide as Record<string, unknown>) : undefined;

    const slide_id = readFirstString(
      record.slide_id,
      record.slideId,
      slideRecord?.slide_id,
      slideRecord?.slideId,
      slideRecord?.id,
      record.id
    );
    if (!slide_id || seen.has(slide_id)) continue;
    seen.add(slide_id);

    const pageStartRaw = record.page_start ?? record.pageStart;
    const pageEndRaw = record.page_end ?? record.pageEnd;

    entries.push({
      slide_scope_id: readFirstString(record.slide_scope_id, record.slideScopeId) || undefined,
      slide_id,
      page_start: typeof pageStartRaw === 'number' ? pageStartRaw : pageStartRaw == null ? null : null,
      page_end: typeof pageEndRaw === 'number' ? pageEndRaw : pageEndRaw == null ? null : null,
      course_id: readFirstString(record.course_id, slideRecord?.course_id) || undefined,
      course_title: readFirstString(record.course_title, slideRecord?.course_title) || undefined,
      module_id: readFirstString(record.module_id, slideRecord?.module_id) || undefined,
      module_title: readFirstString(record.module_title, slideRecord?.module_title) || undefined,
      slide_title: readFirstString(record.slide_title, slideRecord?.slide_title) || undefined,
    });
  }

  return entries;
};

const parseSemanticQuestionDetail = (raw: any): QuestionWithFeedback => {
  const blocks = Array.isArray(raw?.content_blocks)
    ? raw.content_blocks
    : Array.isArray(raw?.current_version?.content_blocks)
      ? raw.current_version.content_blocks
      : [];
  const interactions = Array.isArray(raw?.interactions)
    ? raw.interactions
    : Array.isArray(raw?.current_version?.interactions)
      ? raw.current_version.interactions
      : [];
  const firstInteraction = interactions[0] ?? {};
  const slideScope = raw?.slide_scope ?? raw?.current_version?.slide_scope;
  const normalizedSlideScope = extractQuestionSlideScope(slideScope);

  const content = [...blocks]
    .sort((a: any, b: any) => Number(a?.block_order ?? 0) - Number(b?.block_order ?? 0))
    .map((block: any) => {
      const typeRaw = String(block?.block_type ?? block?.type ?? '').toLowerCase();
      const image = readFirstString(block?.media_url, block?.image_url, block?.src) || extractBlockImageUrl(block);
      const text = readFirstString(block?.text_content) || extractBlockText(block);
      if (typeRaw.includes('image') && image) return { type: 'image', content: image };
      if (text) return { type: 'text', content: text };
      if (image) return { type: 'image', content: image };
      return null;
    })
    .filter(Boolean) as Array<{ type: string; content: string }>;

  const feedback_links = extractFeedbackLinks(
    Array.isArray(raw?.feedback_links)
      ? raw.feedback_links
      : Array.isArray(raw?.current_version?.feedback_links)
        ? raw.current_version.feedback_links
        : []
  );

  return {
    question_id: String(raw?.question_id ?? raw?.id ?? ''),
    question_version_id:
      readFirstString(raw?.question_version_id, raw?.current_question_version_id, raw?.current_version?.question_version_id, raw?.current_version?.id) ||
      undefined,
    type: normalizeQuestionType(
      raw?.current_version?.question_type ??
        raw?.question_version?.question_type ??
        firstInteraction?.interaction_type ??
        raw?.question_type ??
        raw?.type
    ),
    question_type_raw:
      (typeof raw?.current_version?.question_type === 'string' ? raw.current_version.question_type : '') ||
      (typeof raw?.question_version?.question_type === 'string' ? raw.question_version.question_type : '') ||
      (typeof firstInteraction?.interaction_type === 'string' ? firstInteraction.interaction_type : '') ||
      (typeof raw?.question_type === 'string' ? raw.question_type : '') ||
      (typeof raw?.type === 'string' ? raw.type : '') ||
      (typeof raw?.current_version?.question_type === 'string' ? raw.current_version.question_type : '') ||
      (typeof raw?.current_version?.type === 'string' ? raw.current_version.type : '') ||
      undefined,
    access_scope:
      typeof raw?.access_scope === 'string'
        ? raw.access_scope
        : typeof raw?.current_version?.access_scope === 'string'
          ? raw.current_version.access_scope
          : undefined,
    objective: firstNonEmptyStringArray(raw?.objective, raw?.objectives, firstInteraction?.objective, firstInteraction?.learning_objectives),
    slide_ids: firstNonEmptyStringArray(raw?.slide_ids, slideScope?.slide_ids, Array.isArray(slideScope) ? slideScope : []),
    slide_scope: normalizedSlideScope,
    interaction_prompt_text: readFirstString(
      firstInteraction?.prompt_text,
      raw?.prompt_text,
      raw?.current_version?.prompt_text,
      raw?.question_version?.prompt_text
    ) || undefined,
    created_at: raw?.created_at ?? raw?.current_version?.created_at,
    content,
    options: extractOptions(raw),
    mcq_human_feedback: Array.isArray(raw?.mcq_human_feedback) ? raw.mcq_human_feedback.map((x: any) => String(x ?? '')) : [],
    feedback_links,
  };
};

const parseFeedbackAgents = (data: unknown): FeedbackAgentLite[] => {
  const normalize = (raw: any): FeedbackAgentLite => ({
    agent_id: String(raw?.agent_id ?? raw?.id ?? ''),
    title: raw?.title ?? raw?.name ?? '',
    role: raw?.role,
    provider: raw?.provider,
    model: raw?.model,
    prompt_text: typeof raw?.prompt_text === 'string' ? raw.prompt_text : undefined,
    inputs: Array.isArray(raw?.inputs) ? raw.inputs : [],
  });
  if (Array.isArray(data)) return data.map(normalize).filter((a) => a.agent_id);
  if (!data || typeof data !== 'object') return [];
  const payload = data as Record<string, unknown>;
  const items = payload.items ?? payload.agents ?? payload.feedback_agents ?? payload.results ?? payload.data;
  if (!Array.isArray(items)) return [];
  return items.map(normalize).filter((a) => a.agent_id);
};

const parseAttachedAgents = (data: unknown): AttachedAgentLite[] => {
  const normalize = (raw: any): AttachedAgentLite => {
    const option_feedback_count = Number(raw?.option_feedback_count);
    const link_count = Number(raw?.link_count);
    return {
      agent_id: String(raw?.agent_id ?? raw?.id ?? '').trim(),
      title: readFirstString(raw?.title, raw?.agent_title, raw?.name) || undefined,
      role: readFirstString(raw?.role) || undefined,
      question_feedback_text: readFirstString(raw?.question_feedback_text, raw?.static_feedback_text) || undefined,
      option_feedback_count: Number.isFinite(option_feedback_count) ? option_feedback_count : undefined,
      link_count: Number.isFinite(link_count) ? link_count : undefined,
      generation_status: readFirstString(raw?.generation_status, getNested(raw, 'generation.status')) || undefined,
    };
  };
  if (Array.isArray(data)) return data.map(normalize).filter((a) => a.agent_id);
  if (!data || typeof data !== 'object') return [];
  const payload = data as Record<string, unknown>;
  const items = payload.items ?? payload.agents ?? payload.attached_agents ?? payload.results ?? payload.data;
  if (!Array.isArray(items)) return [];
  return items.map(normalize).filter((a) => a.agent_id);
};

const parseHumanStaticVersions = (data: unknown): HumanStaticVersion[] => {
  const normalizeOptionFeedback = (raw: unknown): Record<string, string> => {
    if (!Array.isArray(raw)) return {};
    const map: Record<string, string> = {};
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const optionId = readFirstString(row.interaction_option_id, row.option_id, row.target_entity_id, row.target_id);
      const feedbackText = readFirstString(row.feedback_text, row.static_feedback_text, row.text);
      if (!optionId) continue;
      map[optionId] = feedbackText;
    }
    return map;
  };
  const normalize = (raw: unknown): HumanStaticVersion | null => {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const revisionCandidate = Number(row.revision_no ?? row.revision ?? row.version_no);
    return {
      version_id: readFirstString(row.version_id, row.feedback_version_id) || undefined,
      revision_no: Number.isFinite(revisionCandidate) ? revisionCandidate : undefined,
      saved_at: readFirstString(row.created_at, row.updated_at, row.saved_at, row.timestamp) || new Date().toISOString(),
      draft: {
        question_feedback_text: readFirstString(row.question_feedback_text, row.static_feedback_text),
        option_feedback_text_by_option_id: normalizeOptionFeedback(
          row.option_feedback ?? row.option_feedbacks ?? row.interaction_option_feedback
        ),
      },
    };
  };

  const getItems = (payload: unknown): unknown[] => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const obj = payload as Record<string, unknown>;
    const items = obj.items ?? obj.versions ?? obj.results ?? obj.data;
    return Array.isArray(items) ? items : [];
  };

  const parsed = getItems(data)
    .map(normalize)
    .filter((item): item is HumanStaticVersion => Boolean(item));

  parsed.sort((a, b) => {
    if (typeof a.revision_no === 'number' && typeof b.revision_no === 'number') return a.revision_no - b.revision_no;
    const ta = new Date(a.saved_at).getTime();
    const tb = new Date(b.saved_at).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return 0;
  });
  return parsed;
};

const normalizeTargetType = (value?: string) => (value ?? '').trim().toLowerCase().replace(/-/g, '_');
const isQuestionVersionTarget = (value?: string) => normalizeTargetType(value) === 'question_version';
const isInteractionOptionTarget = (value?: string) => normalizeTargetType(value) === 'interaction_option';
const cloneHumanStaticDraft = (draft: HumanStaticDraft): HumanStaticDraft => ({
  question_feedback_text: draft.question_feedback_text,
  option_feedback_text_by_option_id: { ...draft.option_feedback_text_by_option_id },
});
const normalizeText = (value?: string) => (value ?? '').trim();
const formatVersionTimestamp = (value?: string) => formatDateTimeForUser(value, '-', true);

const isHumanAgent = (agent?: FeedbackAgentLite | null) => agent?.role === 'human';
const PROMPT_VAR_REGEX = /\{\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\}/g;
const TERMINAL_GENERATION_STATUSES = new Set(['finished', 'failed', 'passed', 'success', 'succeeded']);
const stringifyDryRunValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildFormattedQuestionText = (question: QuestionWithFeedback | null): string => {
  if (!question) return '';
  const questionText = (question.content ?? [])
    .map((item) => {
      const value = String(item?.content ?? '').trim();
      if (!value) return '';
      if (item.type === 'image') return `[Image] ${value}`;
      return value;
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const typeText = String(question.question_type_raw ?? question.type ?? '').toLowerCase();
  const isSingleChoice =
    typeText.includes('single_choice') ||
    typeText.includes('single choice') ||
    typeText.includes('multiple choice') ||
    typeText.includes('mcq');
  if (!isSingleChoice) return questionText;

  const options = (question.options ?? [])
    .map((option, idx) => `${idx + 1}. ${String(option.text ?? '').trim() || '(Empty option)'}`)
    .join('\n');
  const correct = (question.options ?? []).find((option) => option.isCorrect)?.text?.trim() || '(not set)';

  const sections = ['Question:', questionText || '(empty)', '', 'Options:', options || '(no options)', '', `Correct Answer: ${correct}`];
  return sections.join('\n').trim();
};

export default function ManageQuestion() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasManagePermission, isPermissionChecking, manageUserId } = useManagePermissionGuard();
  const questionId = pathname.split('/').filter(Boolean).pop() || '';

  const [question, setQuestion] = useState<QuestionWithFeedback | null>(null);
  const [attachedAgents, setAttachedAgents] = useState<AttachedAgentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [agentActionLoading, setAgentActionLoading] = useState(false);
  const [regenerateLoadingAgentId, setRegenerateLoadingAgentId] = useState<string | null>(null);
  const [feedbackAgents, setFeedbackAgents] = useState<FeedbackAgentLite[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get('agent_id') || '');
  const [activeFeedbackTab, setActiveFeedbackTab] = useState<'human' | 'ai'>('human');
  const [showAddAgentPicker, setShowAddAgentPicker] = useState(false);
  const [pendingHumanAgentId, setPendingHumanAgentId] = useState('');
  const [selectedAiAgentId, setSelectedAiAgentId] = useState('');
  const [showAddAiPicker, setShowAddAiPicker] = useState(false);
  const [pendingAiAgentId, setPendingAiAgentId] = useState('');
  const [isAiDryRunRunning, setIsAiDryRunRunning] = useState(false);
  const [aiDryRunInputValues, setAiDryRunInputValues] = useState<Record<string, unknown> | null>(null);
  const [aiDryRunResolvedSystemPrompt, setAiDryRunResolvedSystemPrompt] = useState('');
  const [aiDryRunResolvedUserText, setAiDryRunResolvedUserText] = useState('');
  const [aiDryRunOutput, setAiDryRunOutput] = useState('');
  const [aiDryRunError, setAiDryRunError] = useState<string | null>(null);
  const [aiDryRunLearnerAnswer, setAiDryRunLearnerAnswer] = useState('');
  const [draft, setDraft] = useState<HumanStaticDraft>({ question_feedback_text: '', option_feedback_text_by_option_id: {} });
  const [serverDraftByAgentId, setServerDraftByAgentId] = useState<Record<string, HumanStaticDraft>>({});
  const [isEditingHumanStatic, setIsEditingHumanStatic] = useState(false);
  const [savedVersionsByAgentId, setSavedVersionsByAgentId] = useState<Record<string, HumanStaticVersion[]>>({});
  const [versionCursorByAgentId, setVersionCursorByAgentId] = useState<Record<string, number>>({});
  const [versionsLoadingByAgentId, setVersionsLoadingByAgentId] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topNotice, setTopNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const topNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!questionId) return;
    setLoading(true);
    axios
      .get(`/api/questions/${questionId}`, {
        params: { include: 'current_version,content_blocks,interactions,options,interaction_options,slide_scope,feedback_links' },
      })
      .then((res) => setQuestion(parseSemanticQuestionDetail(res.data)))
      .catch((err) => {
        console.error('Error fetching question:', err);
        setQuestion(null);
        setError('Failed to load question.');
      })
      .finally(() => setLoading(false));
  }, [questionId]);

  const showTopNotice = (text: string, tone: 'success' | 'error') => {
    if (topNoticeTimerRef.current) {
      window.clearTimeout(topNoticeTimerRef.current);
      topNoticeTimerRef.current = null;
    }
    setTopNotice({ tone, text });
    topNoticeTimerRef.current = window.setTimeout(() => {
      setTopNotice(null);
      topNoticeTimerRef.current = null;
    }, tone === 'error' ? 5000 : 3000);
  };

  useEffect(() => {
    if (!error) return;
    showTopNotice(error, 'error');
    setError(null);
  }, [error]);

  useEffect(() => {
    if (!message) return;
    showTopNotice(message, 'success');
    setMessage(null);
  }, [message]);

  useEffect(() => {
    return () => {
      if (topNoticeTimerRef.current) {
        window.clearTimeout(topNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!questionId || isPermissionChecking || !hasManagePermission) return;
    axios
      .get(`/api/questions/${questionId}/attached-agents`)
      .then((res) => setAttachedAgents(parseAttachedAgents(res.data)))
      .catch((err) => {
        console.error('Error fetching attached agents:', err);
        setAttachedAgents([]);
      });
  }, [hasManagePermission, isPermissionChecking, questionId]);

  useEffect(() => {
    if (isPermissionChecking || !hasManagePermission) return;
    setAgentsLoading(true);
    axios
      .get('/api/feedback-agents', { params: { include_inputs: true, user_id: manageUserId || undefined } })
      .then((res) => setFeedbackAgents(parseFeedbackAgents(res.data)))
      .catch((err) => {
        console.error('Error fetching feedback agents:', err);
      })
      .finally(() => setAgentsLoading(false));
  }, [hasManagePermission, isPermissionChecking, manageUserId]);

  const humanStaticAgents = useMemo(
    () => feedbackAgents.filter((agent) => agent.role === 'human'),
    [feedbackAgents]
  );
  const aiAgents = useMemo(() => feedbackAgents.filter((agent) => agent.role === 'ai'), [feedbackAgents]);

  const agentById = useMemo(() => {
    const map = new Map<string, FeedbackAgentLite>();
    feedbackAgents.forEach((agent) => map.set(agent.agent_id, agent));
    return map;
  }, [feedbackAgents]);

  const attachedHumanStaticAgentCapsules = useMemo(
    () =>
      attachedAgents
        .filter((agent) => agent.role === 'human')
        .map((agent) => ({
          agent_id: agent.agent_id,
          title: agent.title || agentById.get(agent.agent_id)?.title || agent.agent_id,
        })),
    [agentById, attachedAgents]
  );
  const humanStaticCapsules = useMemo(() => {
    const map = new Map<string, { agent_id: string; title: string }>();
    attachedHumanStaticAgentCapsules.forEach((row) => map.set(row.agent_id, row));
    if (selectedAgentId) {
      const agent = agentById.get(selectedAgentId);
      if (agent && isHumanAgent(agent) && !map.has(agent.agent_id)) {
        map.set(agent.agent_id, { agent_id: agent.agent_id, title: agent.title || agent.agent_id });
      }
    }
    return Array.from(map.values());
  }, [agentById, attachedHumanStaticAgentCapsules, selectedAgentId]);
  const humanStaticCapsuleIdSet = useMemo(
    () => new Set(humanStaticCapsules.map((row) => row.agent_id)),
    [humanStaticCapsules]
  );

  const selectedAgent = useMemo(() => agentById.get(selectedAgentId) ?? null, [agentById, selectedAgentId]);
  const selectedAttachedAgent = useMemo(
    () => attachedAgents.find((agent) => agent.agent_id === selectedAgentId) ?? null,
    [attachedAgents, selectedAgentId]
  );

  useEffect(() => {
    if (selectedAgentId && attachedHumanStaticAgentCapsules.some((item) => item.agent_id === selectedAgentId)) return;
    if (attachedHumanStaticAgentCapsules.length > 0) {
      setSelectedAgentId(attachedHumanStaticAgentCapsules[0].agent_id);
    } else if (selectedAgentId) {
      setSelectedAgentId('');
    }
  }, [attachedHumanStaticAgentCapsules, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setDraft({ question_feedback_text: '', option_feedback_text_by_option_id: {} });
      setIsEditingHumanStatic(false);
      return;
    }
    const links = (question?.feedback_links ?? []).filter((link) => link.agent_id === selectedAgentId);
    const questionLink = links.find((link) => isQuestionVersionTarget(link.target_type));
    const attached = attachedAgents.find((agent) => agent.agent_id === selectedAgentId);
    const option_feedback_text_by_option_id: Record<string, string> = {};
    (question?.options ?? []).forEach((option) => {
      if (!option.interaction_option_id) return;
      const optionLink = links.find(
        (link) => isInteractionOptionTarget(link.target_type) && link.target_id === option.interaction_option_id
      );
      if (optionLink?.static_feedback_text) {
        option_feedback_text_by_option_id[option.interaction_option_id] = optionLink.static_feedback_text;
      }
    });
    const nextDraft = {
      question_feedback_text: questionLink?.static_feedback_text ?? attached?.question_feedback_text ?? '',
      option_feedback_text_by_option_id,
    };
    setDraft(nextDraft);
    setServerDraftByAgentId((prev) => ({ ...prev, [selectedAgentId]: cloneHumanStaticDraft(nextDraft) }));
    setIsEditingHumanStatic(false);
  }, [attachedAgents, question, selectedAgentId]);

  const humanStaticVersions = useMemo(
    () => (selectedAgentId ? savedVersionsByAgentId[selectedAgentId] ?? [] : []),
    [savedVersionsByAgentId, selectedAgentId]
  );
  const currentVersionCursor = useMemo(() => {
    if (!selectedAgentId) return 0;
    const fallback = Math.max(0, humanStaticVersions.length - 1);
    const value = versionCursorByAgentId[selectedAgentId];
    if (typeof value !== 'number') return fallback;
    return Math.min(Math.max(0, value), fallback);
  }, [humanStaticVersions.length, selectedAgentId, versionCursorByAgentId]);
  const viewedVersionDraft = useMemo(() => {
    if (!humanStaticVersions.length) return null;
    return humanStaticVersions[currentVersionCursor]?.draft ?? humanStaticVersions[humanStaticVersions.length - 1].draft;
  }, [currentVersionCursor, humanStaticVersions]);
  const viewedVersionMeta = useMemo(() => {
    if (!humanStaticVersions.length) return null;
    return humanStaticVersions[currentVersionCursor] ?? humanStaticVersions[humanStaticVersions.length - 1];
  }, [currentVersionCursor, humanStaticVersions]);
  const displayedHumanStaticDraft = isEditingHumanStatic ? draft : viewedVersionDraft ?? draft;
  const humanStaticVersionsLoading = selectedAgentId ? Boolean(versionsLoadingByAgentId[selectedAgentId]) : false;
  const userTimeZone = getUserTimeZone() ?? 'unknown';
  const hasHumanStaticDraftChanges = useMemo(() => {
    if (!selectedAgentId) return false;
    const baseline = serverDraftByAgentId[selectedAgentId];
    if (!baseline) return false;
    const hasOptions = Boolean(question?.options?.length);
    if (!hasOptions) {
      return normalizeText(draft.question_feedback_text) !== normalizeText(baseline.question_feedback_text);
    }
    const options = question?.options ?? [];
    for (const option of options) {
      const optionId = option.interaction_option_id;
      if (!optionId) continue;
      if (
        normalizeText(draft.option_feedback_text_by_option_id[optionId]) !==
        normalizeText(baseline.option_feedback_text_by_option_id[optionId])
      ) {
        return true;
      }
    }
    return false;
  }, [draft, question?.options, selectedAgentId, serverDraftByAgentId]);

  const attachedAgentSummary = useMemo(() => {
    return attachedAgents.map((agent) => ({
      agentId: agent.agent_id,
      title: agent.title || agentById.get(agent.agent_id)?.title || '',
      linkCount: agent.link_count ?? 0,
      staticCount: agent.question_feedback_text?.trim() ? 1 : 0,
      statuses: new Set(agent.generation_status ? [agent.generation_status] : []),
      role: agent.role || agentById.get(agent.agent_id)?.role,
      question_feedback_text: agent.question_feedback_text,
      option_feedback_count: agent.option_feedback_count ?? 0,
      generation_status: agent.generation_status,
    }));
  }, [agentById, attachedAgents]);

  const attachedAiSummary = useMemo(
    () =>
      attachedAgentSummary.filter((row) => {
        return row.role === 'ai';
      }),
    [attachedAgentSummary]
  );
  const aiCapsules = useMemo(() => {
    const map = new Map<string, { agent_id: string; title: string }>();
    attachedAiSummary.forEach((row) => map.set(row.agentId, { agent_id: row.agentId, title: row.title || row.agentId }));
    if (selectedAiAgentId) {
      const agent = agentById.get(selectedAiAgentId);
      if (agent?.role === 'ai' && !map.has(agent.agent_id)) {
        map.set(agent.agent_id, { agent_id: agent.agent_id, title: agent.title || agent.agent_id });
      }
    }
    return Array.from(map.values());
  }, [agentById, attachedAiSummary, selectedAiAgentId]);
  const aiCapsuleIdSet = useMemo(
    () => new Set(aiCapsules.map((row) => row.agent_id)),
    [aiCapsules]
  );
  const unattachedAiAgents = useMemo(
    () => aiAgents.filter((agent) => !aiCapsuleIdSet.has(agent.agent_id)),
    [aiAgents, aiCapsuleIdSet]
  );
  const aiStaticVersions = useMemo(
    () => (selectedAiAgentId ? savedVersionsByAgentId[selectedAiAgentId] ?? [] : []),
    [savedVersionsByAgentId, selectedAiAgentId]
  );
  const currentAiVersionCursor = useMemo(() => {
    if (!selectedAiAgentId) return 0;
    const fallback = Math.max(0, aiStaticVersions.length - 1);
    const value = versionCursorByAgentId[selectedAiAgentId];
    if (typeof value !== 'number') return fallback;
    return Math.min(Math.max(0, value), fallback);
  }, [aiStaticVersions.length, selectedAiAgentId, versionCursorByAgentId]);
  const viewedAiVersionMeta = useMemo(() => {
    if (!aiStaticVersions.length) return null;
    return aiStaticVersions[currentAiVersionCursor] ?? aiStaticVersions[aiStaticVersions.length - 1];
  }, [aiStaticVersions, currentAiVersionCursor]);
  const viewedAiVersionDraft = useMemo(() => {
    if (!aiStaticVersions.length) return null;
    return aiStaticVersions[currentAiVersionCursor]?.draft ?? aiStaticVersions[aiStaticVersions.length - 1].draft;
  }, [aiStaticVersions, currentAiVersionCursor]);
  const viewedAiOptionFeedbackRows = useMemo(() => {
    const map = viewedAiVersionDraft?.option_feedback_text_by_option_id ?? {};
    const entries = Object.entries(map).filter(([, text]) => normalizeText(text).length > 0);
    if (!entries.length) return [] as Array<{ label: string; text: string }>;
    const optionTextById = new Map<string, string>();
    (question?.options ?? []).forEach((option, idx) => {
      if (!option.interaction_option_id) return;
      optionTextById.set(option.interaction_option_id, `${idx + 1}. ${option.text || '(Empty option)'}`);
    });
    return entries.map(([optionId, text]) => ({
      label: optionTextById.get(optionId) ?? optionId,
      text,
    }));
  }, [question?.options, viewedAiVersionDraft]);
  const aiStaticVersionsLoading = selectedAiAgentId ? Boolean(versionsLoadingByAgentId[selectedAiAgentId]) : false;

  useEffect(() => {
    if (selectedAiAgentId && aiCapsules.some((item) => item.agent_id === selectedAiAgentId)) return;
    if (aiCapsules.length > 0) setSelectedAiAgentId(aiCapsules[0].agent_id);
    else if (selectedAiAgentId) setSelectedAiAgentId('');
  }, [aiCapsules, selectedAiAgentId]);

  useEffect(() => {
    setAiDryRunInputValues(null);
    setAiDryRunResolvedSystemPrompt('');
    setAiDryRunResolvedUserText('');
    setAiDryRunOutput('');
    setAiDryRunError(null);
  }, [selectedAiAgentId]);

  useEffect(() => {
    setAiDryRunLearnerAnswer('');
  }, [questionId]);

  const refreshQuestion = async () => {
    if (!questionId) return;
    const refreshed = await axios.get(`/api/questions/${questionId}`, {
      params: { include: 'current_version,content_blocks,interactions,options,interaction_options,slide_scope,feedback_links' },
    });
    setQuestion(parseSemanticQuestionDetail(refreshed.data));
  };

  const refreshAttachedAgents = async () => {
    if (!questionId) return;
    const refreshed = await axios.get(`/api/questions/${questionId}/attached-agents`);
    setAttachedAgents(parseAttachedAgents(refreshed.data));
  };

  const refreshStaticFeedbackVersions = async (agentId: string) => {
    if (!questionId || !agentId) return;
    setVersionsLoadingByAgentId((prev) => ({ ...prev, [agentId]: true }));
    try {
      const res = await axios.get(`/api/questions/${questionId}/attached-agents/${agentId}/static-feedback/versions`);
      const versions = parseHumanStaticVersions(res.data);
      setSavedVersionsByAgentId((prev) => ({ ...prev, [agentId]: versions }));
      setVersionCursorByAgentId((prev) => ({ ...prev, [agentId]: Math.max(0, versions.length - 1) }));
    } catch (err) {
      console.error('Error fetching static feedback versions:', err);
      setSavedVersionsByAgentId((prev) => ({ ...prev, [agentId]: [] }));
      setVersionCursorByAgentId((prev) => ({ ...prev, [agentId]: 0 }));
    } finally {
      setVersionsLoadingByAgentId((prev) => ({ ...prev, [agentId]: false }));
    }
  };

  useEffect(() => {
    if (!selectedAgentId || !questionId) return;
    const selected = attachedAgents.find((agent) => agent.agent_id === selectedAgentId);
    if (!selected || selected.role !== 'human') return;
    void refreshStaticFeedbackVersions(selectedAgentId);
  }, [attachedAgents, questionId, selectedAgentId]);

  useEffect(() => {
    if (!selectedAiAgentId || !questionId) return;
    const selected = attachedAgents.find((agent) => agent.agent_id === selectedAiAgentId);
    if (!selected || selected.role !== 'ai') return;
    void refreshStaticFeedbackVersions(selectedAiAgentId);
  }, [attachedAgents, questionId, selectedAiAgentId]);

  const attachAgentToQuestion = async (
    agentId: string,
    successMessage = 'Agent attached.'
  ) => {
    if (!questionId || !manageUserId) {
      setError('Missing user ID. Please refresh and try again.');
      return false;
    }
    setAgentActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      await axios.post(`/api/questions/${questionId}/attached-agents`, {
        agent_id: agentId,
        updated_by: manageUserId,
      });
      await refreshAttachedAgents();
      setMessage(successMessage);
      return true;
    } catch (err) {
      console.error('Error attaching agent:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setError(typeof detail === 'object' && detail !== null ? JSON.stringify(detail, null, 2) : String(detail));
          return false;
        }
      }
      setError('Failed to attach agent.');
      return false;
    } finally {
      setAgentActionLoading(false);
    }
  };

  const saveHumanStaticFeedback = async () => {
    if (!question || !selectedAgentId || !manageUserId) return;
    const resolvedQuestionId = questionId || question.question_id;
    if (!resolvedQuestionId) {
      setError('Missing question_id. Please refresh and try again.');
      return;
    }
    const selected = attachedAgents.find((agent) => agent.agent_id === selectedAgentId);
    if (!selected || selected.role !== 'human') {
      setError('Please select an attached human agent.');
      return;
    }
    setError(null);
    setMessage(null);

    const hasOptions = Boolean(question.options?.length);
    const questionFeedbackText = (draft.question_feedback_text ?? '').trim();
    const option_feedback: Array<{ interaction_option_id: string; feedback_text: string }> = [];
    if (hasOptions) {
      for (let idx = 0; idx < (question.options ?? []).length; idx += 1) {
        const option = question.options![idx];
        if (!option.interaction_option_id) {
          setError(`Missing interaction_option_id for option ${idx + 1}.`);
          return;
        }
        const feedbackText = (draft.option_feedback_text_by_option_id[option.interaction_option_id] ?? '').trim();
        if (!feedbackText) {
          setError(`Option ${idx + 1} feedback is required.`);
          return;
        }
        option_feedback.push({ interaction_option_id: option.interaction_option_id, feedback_text: feedbackText });
      }
    } else if (!questionFeedbackText) {
      setError('Question feedback is required.');
      return;
    }

    setSaveLoading(true);
    try {
      const versions = savedVersionsByAgentId[selectedAgentId] ?? [];
      const latestVersionId = versions.length ? versions[versions.length - 1].version_id : undefined;
      await axios.patch(`/api/questions/${resolvedQuestionId}/attached-agents/${selectedAgentId}/static-feedback`, {
        updated_by: manageUserId,
        ifMatchVersionId: latestVersionId,
        question_feedback_text: hasOptions ? undefined : questionFeedbackText,
        expected_option_count: hasOptions ? question.options?.length ?? 0 : 0,
        option_feedback,
      });
      setMessage(hasOptions ? 'Option feedback saved.' : 'Static feedback saved.');
      setServerDraftByAgentId((prev) => ({ ...prev, [selectedAgentId]: cloneHumanStaticDraft(draft) }));
      await refreshStaticFeedbackVersions(selectedAgentId);
      setIsEditingHumanStatic(false);
      await refreshAttachedAgents();
      await refreshQuestion();
    } catch (err) {
      console.error('Error saving static feedback:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setError(
            typeof detail === 'object' && detail !== null
              ? `422 Validation Error\n${JSON.stringify(detail, null, 2)}`
              : String(detail)
          );
          return;
        }
      }
      setError('Failed to save static feedback.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRemoveAgentFromQuestion = async (agentId: string) => {
    if (!questionId || !manageUserId) {
      setError('Missing user ID. Please refresh and try again.');
      return;
    }
    const confirmed = window.confirm(`Detach agent ${agentId} from this question?`);
    if (!confirmed) return;
    setAgentActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      await axios.delete(`/api/questions/${questionId}/attached-agents/${agentId}`, {
        params: { updated_by: manageUserId },
      });
      await refreshAttachedAgents();
      await refreshQuestion();
      if (selectedAgentId === agentId) setSelectedAgentId('');
      if (selectedAiAgentId === agentId) setSelectedAiAgentId('');
      setMessage('Agent detached.');
    } catch (err) {
      console.error('Error detaching agent:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setError(typeof detail === 'object' && detail !== null ? JSON.stringify(detail, null, 2) : String(detail));
          return;
        }
      }
      setError('Failed to detach agent.');
    } finally {
      setAgentActionLoading(false);
    }
  };

  const executeAiGeneration = async (agent: FeedbackAgentLite, dryRun: boolean, answerTextOverride?: string) => {
    const inputValues = buildAiDryRunInputValues(agent, answerTextOverride);
    const renderedPrompt = renderAiDryRunPrompt(agent.prompt_text ?? '', inputValues);
    const payload: Record<string, unknown> = { dryRun, inputValues };
    if (!dryRun) payload.updatedBy = manageUserId;
    const res = await axios.post(`/api/questions/${questionId}/attached-agents/${agent.agent_id}/dry-run`, payload);
    return { response: res.data, inputValues, renderedPrompt };
  };

  const enqueueAiGenerationJob = async (agentId: string) => {
    if (!questionId || !manageUserId) {
      throw new Error('Missing question_id or user_id.');
    }
    const payload = {
      question_ids: [questionId],
      agent_id: agentId,
      updated_by: manageUserId,
    };
    const res = await axios.post<BatchAttachFeedbackAgentResponse>('/api/questions/batch/attach-feedback-agent', payload);
    return res.data;
  };

  const waitForAiGenerationTerminalStatus = async (agentId: string): Promise<string> => {
    if (!questionId) return 'timeout';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const res = await axios.get(`/api/questions/${questionId}/attached-agents`);
      const parsed = parseAttachedAgents(res.data);
      setAttachedAgents(parsed);
      const attached = parsed.find((item) => item.agent_id === agentId);
      const status = String(attached?.generation_status ?? '').trim().toLowerCase();
      if (status && TERMINAL_GENERATION_STATUSES.has(status)) return status;
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    return 'timeout';
  };

  const handleRegenerateAiStatic = async (agentId: string) => {
    if (!questionId || !manageUserId) {
      setError('Missing user ID. Please refresh and try again.');
      return;
    }
    const agent = agentById.get(agentId) ?? null;
    if (!agent) {
      setError('AI agent not found.');
      return;
    }
    setRegenerateLoadingAgentId(agentId);
    setError(null);
    setMessage(null);
    try {
      const enqueueResult = await enqueueAiGenerationJob(agentId);
      const queuedJobs = Array.isArray(enqueueResult?.queued_feedback_generation)
        ? enqueueResult.queued_feedback_generation.filter((item) => item?.job_id)
        : [];
      const enqueueFailed = Array.isArray(enqueueResult?.enqueue_failed) ? enqueueResult.enqueue_failed : [];
      if (enqueueFailed.length > 0) {
        const firstError = enqueueFailed[0];
        throw new Error(firstError?.message || firstError?.code || 'Failed to enqueue feedback generation job.');
      }

      setMessage(
        queuedJobs.length > 0
          ? `Generation job queued (${queuedJobs.length}). Waiting for completion...`
          : 'Generation refresh requested. Waiting for completion...'
      );
      const terminalStatus = await waitForAiGenerationTerminalStatus(agentId);
      if (terminalStatus === 'failed') {
        throw new Error('Feedback generation job failed.');
      }
      if (terminalStatus === 'timeout') {
        setMessage('Generation job queued. It is still processing in background.');
      } else {
        setMessage('Static feedback regenerated via job.');
      }
      await refreshStaticFeedbackVersions(agentId);
      await refreshAttachedAgents();
      await refreshQuestion();
    } catch (err) {
      console.error('Error regenerating AI static feedback:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setError(typeof detail === 'object' && detail !== null ? JSON.stringify(detail, null, 2) : String(detail));
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to regenerate AI static feedback.');
    } finally {
      setRegenerateLoadingAgentId(null);
    }
  };

  const pendingHumanAgent = pendingHumanAgentId ? agentById.get(pendingHumanAgentId) ?? null : null;
  const pendingAiAgent = pendingAiAgentId ? agentById.get(pendingAiAgentId) ?? null : null;
  const selectedAiAgentIdForDryRun = selectedAiAgentId;
  const selectedAiAgentForDryRun = selectedAiAgentIdForDryRun ? agentById.get(selectedAiAgentIdForDryRun) ?? null : null;
  const isSingleChoiceQuestion = useMemo(() => {
    const typeText = String(question?.question_type_raw ?? question?.type ?? '').toLowerCase();
    return (
      typeText.includes('single_choice') ||
      typeText.includes('single choice') ||
      typeText.includes('multiple choice') ||
      typeText.includes('mcq')
    );
  }, [question?.question_type_raw, question?.type]);
  const autoSampleAnswer = useMemo(() => {
    const correctOption = (question?.options ?? []).find((option) => option.isCorrect);
    return correctOption?.text?.trim() ?? '';
  }, [question?.options]);
  const formattedQuestionText = useMemo(() => buildFormattedQuestionText(question), [question]);

  const buildAiDryRunInputValues = (agent: FeedbackAgentLite, answerTextOverride?: string): Record<string, unknown> => {
    const keys = Array.isArray(agent.inputs)
      ? agent.inputs
          .map((input) => (typeof input === 'string' ? input : String(input?.input_key ?? '')))
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === 'question_content_blocks') {
        values[key] = formattedQuestionText;
        continue;
      }
      if (key === 'all_options') {
        values[key] = formattedQuestionText;
        continue;
      }
      if (key === 'selected_option_index') {
        values[key] = null;
        continue;
      }
      if (key === 'answer_text') {
        values[key] = answerTextOverride ?? aiDryRunLearnerAnswer;
        continue;
      }
      if (key === 'retrieved_slide_pages') {
        // Let backend resolve retrieved_slide_pages from retrieval rules when omitted.
        continue;
      }
      values[key] = null;
    }
    return values;
  };

  const renderAiDryRunPrompt = (template: string, inputValues: Record<string, unknown>) => {
    if (!template.trim()) return '';
    return template.replace(PROMPT_VAR_REGEX, (_raw, key: string) => stringifyDryRunValue(inputValues[key]));
  };

  const runAiDryRun = async () => {
    if (!selectedAiAgentForDryRun || !questionId) {
      setAiDryRunError('Please select an attached AI agent first.');
      return;
    }
    const inputValues = buildAiDryRunInputValues(selectedAiAgentForDryRun);
    setAiDryRunInputValues(inputValues);
    setAiDryRunResolvedSystemPrompt('');
    setAiDryRunResolvedUserText('');
    setAiDryRunOutput('');
    setAiDryRunError(null);
    setIsAiDryRunRunning(true);
    try {
      const { response, inputValues: resolvedInputs } = await executeAiGeneration(
        selectedAiAgentForDryRun,
        true
      );
      const resolvedFromBackend =
        (response as any)?.resolved_input_values ??
        (response as any)?.resolvedInputValues ??
        (response as any)?.resolved_inputs ??
        null;
      const effectiveResolvedInputs =
        resolvedFromBackend && typeof resolvedFromBackend === 'object' && !Array.isArray(resolvedFromBackend)
          ? (resolvedFromBackend as Record<string, unknown>)
          : resolvedInputs;
      setAiDryRunInputValues(effectiveResolvedInputs);
      const resolvedSystemPrompt = readFirstString(
        (response as any)?.resolved_system_prompt,
        (response as any)?.resolvedSystemPrompt
      );
      const resolvedUserText = readFirstString(
        (response as any)?.resolved_user_text,
        (response as any)?.resolvedUserText
      );
      setAiDryRunResolvedSystemPrompt(resolvedSystemPrompt);
      setAiDryRunResolvedUserText(resolvedUserText);
      const output = readFirstString(
        (response as any)?.output,
        (response as any)?.result,
        (response as any)?.feedback,
        (response as any)?.text,
        (response as any)?.static_feedback_text
      );
      if (output) {
        setAiDryRunOutput(output);
      } else {
        setAiDryRunOutput(JSON.stringify(response ?? {}, null, 2));
      }
    } catch (err) {
      console.error('Error running AI dry run:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setAiDryRunError(typeof detail === 'object' && detail !== null ? JSON.stringify(detail, null, 2) : String(detail));
        } else {
          setAiDryRunError('Dry run endpoint unavailable. Showing resolved input values and rendered prompt only.');
        }
      } else {
        setAiDryRunError('Dry run failed.');
      }
    } finally {
      setIsAiDryRunRunning(false);
    }
  };

  if (isPermissionChecking || !hasManagePermission) return null;
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="h-7 w-56 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 space-y-3">
              <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
              <div className="h-10 w-44 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
              <div className="h-20 w-full animate-pulse rounded bg-slate-200" />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-48 w-full animate-pulse rounded bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }
  if (!question) return <p className="p-6">Question not found</p>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      {topNotice ? (
        <div className="fixed left-1/2 top-16 z-[60] -translate-x-1/2">
          <div
            className={`max-w-[min(90vw,760px)] whitespace-pre-wrap rounded-xl border px-4 py-2 text-sm shadow-xl backdrop-blur-sm motion-safe:animate-[toast-slide-in_180ms_ease-out] ${
              topNotice.tone === 'error'
                ? 'border-rose-700 bg-rose-900/95 text-white'
                : 'border-slate-700 bg-slate-900/95 text-white'
            }`}
          >
            {topNotice.text}
          </div>
        </div>
      ) : null}
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="">
          <ManageBreadcrumb />
        </section>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Question {question.question_id}</h1>
          <div className="mt-4 space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</div>
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {question.question_type_raw || question.type || 'Unknown'}
                </span>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question</div>
              <div className="mt-2 space-y-2">
                {question.content.map((item, index) => (
                  <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    {item.type === 'text' ? (
                      <p className="whitespace-pre-wrap text-sm text-slate-800">{item.content}</p>
                    ) : (
                      <DynamicImage src={item.content} alt={`Question content ${index + 1}`} className="max-w-xs" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Interaction Prompt</div>
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="whitespace-pre-wrap text-sm text-slate-800">
                  {question.interaction_prompt_text || 'No interaction prompt'}
                </p>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked Slides</div>
              <div className="mt-2 space-y-2">
                {(question.slide_scope?.length ?? 0) > 0 ? (
                  question.slide_scope!.map((entry, idx) => {
                    const path = [entry.course_title, entry.module_title, entry.slide_title].filter(Boolean).join(' / ');
                    const pageRange =
                      typeof entry.page_start === 'number' && typeof entry.page_end === 'number'
                        ? `pages ${entry.page_start}-${entry.page_end}`
                        : 'all pages';
                    return (
                      <div key={`slide-scope-${entry.slide_scope_id || entry.slide_id || idx}`} className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800">
                        <div className="font-medium">{path || entry.slide_id}</div>
                        <div className="mt-1 break-all font-mono text-xs text-slate-500">
                          slide_id: {entry.slide_id}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{pageRange}</div>
                      </div>
                    );
                  })
                ) : question.slide_ids?.length ? (
                  question.slide_ids.map((slideId, idx) => (
                    <div key={`slide-id-${slideId}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800">
                      <div className="break-all font-mono text-xs text-slate-500">{slideId}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">No linked slides</div>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Options</div>
              <div className="mt-2 space-y-2">
                {question.options?.length ? (
                  question.options.map((option, idx) => (
                    <div key={`${question.question_id}-option-${idx}`} className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800">
                      <span className="mr-2 text-xs text-slate-500">{idx + 1}.</span>
                      {option.text || '(Empty option)'}
                      {option.isCorrect ? <span className="ml-2 text-xs text-emerald-700">Correct</span> : null}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">No options</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Feedback</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveFeedbackTab('human')}
              className={`rounded-full border px-3 py-1 text-xs ${
                activeFeedbackTab === 'human'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              Human
            </button>
            <button
              type="button"
              onClick={() => setActiveFeedbackTab('ai')}
              className={`rounded-full border px-3 py-1 text-xs ${
                activeFeedbackTab === 'ai'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              AI
            </button>
          </div>

          {activeFeedbackTab === 'human' ? (
            <>
              <p className="mt-3 text-xs text-slate-500">
                Choose an attached human agent. If the question has options, save all option feedback at once.
              </p>

              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {humanStaticCapsules.map((agent) => (
                    <div
                      key={`agent-capsule-${agent.agent_id}`}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
                        selectedAgentId === agent.agent_id
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAgentId(agent.agent_id);
                          setShowAddAgentPicker(false);
                          setError(null);
                          setMessage(null);
                        }}
                        className="max-w-[220px] truncate"
                        title={agent.title}
                      >
                        {agent.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveAgentFromQuestion(agent.agent_id)}
                        disabled={agentActionLoading}
                        className="rounded px-1 text-slate-500 hover:bg-white hover:text-rose-700"
                        aria-label={`Remove ${agent.title}`}
                        title="Remove agent from this question"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddAgentPicker((prev) => !prev);
                      setPendingHumanAgentId('');
                    }}
                    className="inline-flex items-center rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    + Add
                  </button>
                </div>

                {showAddAgentPicker ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <label htmlFor="human-agent" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Add Human Agent
                    </label>
                    <select
                      id="human-agent"
                      value={pendingHumanAgentId}
                      onChange={(e) => {
                        setPendingHumanAgentId(e.target.value);
                        setError(null);
                        setMessage(null);
                      }}
                      disabled={agentsLoading}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    >
                      <option value="">{agentsLoading ? 'Loading agents...' : 'Select human agent'}</option>
                      {humanStaticAgents.map((agent) => {
                        const disabled = humanStaticCapsuleIdSet.has(agent.agent_id);
                        return (
                          <option key={agent.agent_id} value={agent.agent_id} disabled={disabled}>
                            {(agent.title || '(Untitled agent)') + ` · ${agent.agent_id}${disabled ? ' · Already added' : ''}`}
                          </option>
                        );
                      })}
                    </select>
                    {pendingHumanAgent ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</div>
                        <div className="mt-1 text-sm text-slate-800">{pendingHumanAgent.title || pendingHumanAgent.agent_id}</div>
                        <div className="mt-1 text-xs text-slate-600">{pendingHumanAgent.agent_id}</div>
                        <div className="mt-2 flex justify-end">
                          <ActionButton
                            type="button"
                            variant="primary"
                            size="sm"
                            className="rounded-lg"
                            disabled={humanStaticCapsuleIdSet.has(pendingHumanAgent.agent_id) || agentActionLoading}
                            onClick={async () => {
                              const ok = await attachAgentToQuestion(pendingHumanAgent.agent_id);
                              if (!ok) return;
                              setSelectedAgentId(pendingHumanAgent.agent_id);
                              setShowAddAgentPicker(false);
                              setPendingHumanAgentId('');
                            }}
                          >
                            {agentActionLoading ? 'Adding...' : 'Confirm Add'}
                          </ActionButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {selectedAgentId && selectedAttachedAgent && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agent</div>
                  <div className="mt-1 text-sm text-slate-800">
                    {[selectedAgent?.title || selectedAttachedAgent.title || selectedAttachedAgent.agent_id, selectedAgent?.provider, selectedAgent?.model]
                      .filter(Boolean)
                      .join(' / ')}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ActionButton
                      type="button"
                      variant={isEditingHumanStatic ? 'neutral' : 'primary'}
                      size="sm"
                      className="rounded-lg"
                      disabled={saveLoading}
                      onClick={() => {
                        if (isEditingHumanStatic) {
                          const baseline = selectedAgentId ? serverDraftByAgentId[selectedAgentId] : null;
                          if (baseline) setDraft(cloneHumanStaticDraft(baseline));
                          setIsEditingHumanStatic(false);
                          return;
                        }
                        setIsEditingHumanStatic(true);
                      }}
                    >
                      {isEditingHumanStatic ? 'Cancel Edit' : 'Edit'}
                    </ActionButton>
                    <ActionButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="rounded-lg"
                      onClick={saveHumanStaticFeedback}
                      disabled={
                        saveLoading ||
                        !isEditingHumanStatic ||
                        !hasHumanStaticDraftChanges ||
                        selectedAttachedAgent.role !== 'human'
                      }
                    >
                      {saveLoading ? 'Saving...' : 'Save Feedback'}
                    </ActionButton>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                        disabled={humanStaticVersionsLoading || !humanStaticVersions.length || currentVersionCursor <= 0 || isEditingHumanStatic}
                        onClick={() =>
                          setVersionCursorByAgentId((prev) => ({
                            ...prev,
                            [selectedAgentId]: Math.max(0, currentVersionCursor - 1),
                          }))
                        }
                      >
                        {'<'}
                      </button>
                      <span className="min-w-14 text-center text-xs text-slate-600">
                        {humanStaticVersionsLoading
                          ? '...'
                          : humanStaticVersions.length
                            ? `${currentVersionCursor + 1}/${humanStaticVersions.length}`
                            : '0/0'}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                        disabled={
                          humanStaticVersionsLoading ||
                          !humanStaticVersions.length ||
                          currentVersionCursor >= humanStaticVersions.length - 1 ||
                          isEditingHumanStatic
                        }
                        onClick={() =>
                          setVersionCursorByAgentId((prev) => ({
                            ...prev,
                            [selectedAgentId]: Math.min(humanStaticVersions.length - 1, currentVersionCursor + 1),
                          }))
                        }
                      >
                        {'>'}
                      </button>
                      <ActionButton
                        type="button"
                        variant="neutral"
                        size="sm"
                        className="rounded-lg"
                        disabled={
                          humanStaticVersionsLoading ||
                          !humanStaticVersions.length ||
                          isEditingHumanStatic ||
                          currentVersionCursor === humanStaticVersions.length - 1
                        }
                        onClick={() => {
                          if (!viewedVersionDraft) return;
                          setDraft(cloneHumanStaticDraft(viewedVersionDraft));
                          setIsEditingHumanStatic(true);
                          setMessage('Version restored to editor. Click Save Feedback to persist.');
                          setError(null);
                        }}
                      >
                        Restore
                      </ActionButton>
                    </div>
                    <div className="w-full text-right text-xs text-slate-500">
                      {humanStaticVersionsLoading
                        ? 'Loading versions...'
                        : viewedVersionMeta
                          ? `Version ${viewedVersionMeta.revision_no ?? currentVersionCursor + 1} · ${formatVersionTimestamp(viewedVersionMeta.saved_at)} (${userTimeZone})`
                          : 'No version timestamp'}
                    </div>
                  </div>

                  {question.options?.length ? (
                    <div className="mt-4 space-y-3">
                      <div className="text-sm font-semibold text-slate-900">Option Feedback</div>
                      {question.options.map((option, idx) => (
                        <div key={`${question.question_id}-edit-opt-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">{idx + 1}</span>
                            <span className="text-sm text-slate-800">{option.text || '(Empty option)'}</span>
                            {option.isCorrect ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Correct</span>
                            ) : null}
                          </div>
                          <textarea
                            rows={3}
                            value={
                              option.interaction_option_id
                                ? (displayedHumanStaticDraft.option_feedback_text_by_option_id[option.interaction_option_id] ?? '')
                                : ''
                            }
                            onChange={(e) => {
                              if (!isEditingHumanStatic) return;
                              const optionId = option.interaction_option_id;
                              if (!optionId) return;
                              setDraft((prev) => ({
                                ...prev,
                                option_feedback_text_by_option_id: {
                                  ...prev.option_feedback_text_by_option_id,
                                  [optionId]: e.target.value,
                                },
                              }));
                              setError(null);
                              setMessage(null);
                            }}
                            placeholder={`Feedback for option ${idx + 1}`}
                            readOnly={!isEditingHumanStatic}
                            className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none ${
                              isEditingHumanStatic ? 'bg-white focus:border-slate-300' : 'bg-slate-50'
                            }`}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <label htmlFor="question-feedback-text" className="mb-1 block text-sm font-medium text-slate-700">
                        Question Feedback
                      </label>
                      <textarea
                        id="question-feedback-text"
                        rows={5}
                        value={displayedHumanStaticDraft.question_feedback_text}
                        onChange={(e) => {
                          if (!isEditingHumanStatic) return;
                          setDraft((prev) => ({ ...prev, question_feedback_text: e.target.value }));
                          setError(null);
                          setMessage(null);
                        }}
                        placeholder="Static feedback for this question"
                        readOnly={!isEditingHumanStatic}
                        className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none ${
                          isEditingHumanStatic ? 'bg-white focus:border-slate-300' : 'bg-slate-50'
                        }`}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}

          {activeFeedbackTab === 'ai' ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-500">Attach AI agents and run dry-run or regenerate static feedback version.</p>
              <div className="flex flex-wrap items-center gap-2">
                {aiCapsules.map((agent) => (
                  <div
                    key={`ai-capsule-${agent.agent_id}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
                      selectedAiAgentId === agent.agent_id
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAiAgentId(agent.agent_id);
                        setError(null);
                        setMessage(null);
                      }}
                      className="max-w-[220px] truncate"
                      title={agent.title}
                    >
                      <span className="truncate">{agent.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveAgentFromQuestion(agent.agent_id)}
                      disabled={agentActionLoading}
                      className="rounded px-1 text-slate-500 hover:bg-white hover:text-rose-700"
                      aria-label={`Remove ${agent.title}`}
                      title="Remove agent from this question"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setShowAddAiPicker((prev) => !prev);
                    setPendingAiAgentId('');
                  }}
                  className="inline-flex items-center rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {showAddAiPicker ? 'Close' : '+ Attach'}
                </button>
              </div>
              {showAddAiPicker ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="space-y-2">
                    <select
                      value={pendingAiAgentId}
                      onChange={(e) => {
                        setPendingAiAgentId(e.target.value);
                        setError(null);
                        setMessage(null);
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    >
                      <option value="">
                        {agentsLoading
                          ? 'Loading agents...'
                          : unattachedAiAgents.length > 0
                            ? 'Select AI agent'
                            : 'All AI agents are attached'}
                      </option>
                      {unattachedAiAgents.map((agent) => (
                        <option key={agent.agent_id} value={agent.agent_id}>
                          {(agent.title || '(Untitled agent)') + ` · ${agent.agent_id}`}
                        </option>
                      ))}
                    </select>
                    {pendingAiAgent ? (
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm text-slate-800">{pendingAiAgent.title || pendingAiAgent.agent_id}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          {[pendingAiAgent.agent_id, pendingAiAgent.provider, pendingAiAgent.model].filter(Boolean).join(' / ')}
                        </div>
                        <div className="mt-2 flex justify-end">
                          <ActionButton
                            type="button"
                            variant="primary"
                            size="sm"
                            className="rounded-lg"
                            disabled={
                              agentActionLoading ||
                              aiCapsuleIdSet.has(pendingAiAgent.agent_id)
                            }
                            onClick={async () => {
                              const ok = await attachAgentToQuestion(pendingAiAgent.agent_id);
                              if (!ok) return;
                              setSelectedAiAgentId(pendingAiAgent.agent_id);
                              setShowAddAiPicker(false);
                              setPendingAiAgentId('');
                            }}
                          >
                            {agentActionLoading ? 'Attaching...' : 'Attach'}
                          </ActionButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {selectedAiAgentId ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {(() => {
                    const selectedSummary = attachedAiSummary.find((row) => row.agentId === selectedAiAgentId);
                    const status = (selectedSummary?.generation_status || '-').toLowerCase();
                    return (
                      <>
                        <div className="text-sm text-slate-800">
                          {selectedSummary?.title || selectedAiAgentId}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Generation status: {selectedSummary?.generation_status || '-'}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Feedback version:{' '}
                          {aiStaticVersionsLoading
                            ? 'Loading...'
                            : aiStaticVersions.length
                              ? `${currentAiVersionCursor + 1}/${aiStaticVersions.length}`
                              : '0/0'}
                        </div>
                        <div className="mt-3">
                          <ActionButton
                            type="button"
                            variant={status === 'failed' ? 'secondary' : 'neutral'}
                            size="sm"
                            className="rounded-lg"
                            disabled={Boolean(regenerateLoadingAgentId)}
                            onClick={() => handleRegenerateAiStatic(selectedAiAgentId)}
                          >
                            {regenerateLoadingAgentId === selectedAiAgentId ? 'Regenerating...' : 'Regenerate & Save Version'}
                          </ActionButton>
                        </div>
                        <div className="mt-3 flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                            disabled={aiStaticVersionsLoading || !aiStaticVersions.length || currentAiVersionCursor <= 0}
                            onClick={() =>
                              setVersionCursorByAgentId((prev) => ({
                                ...prev,
                                [selectedAiAgentId]: Math.max(0, currentAiVersionCursor - 1),
                              }))
                            }
                          >
                            {'<'}
                          </button>
                          <span className="min-w-14 text-center text-xs text-slate-600">
                            {aiStaticVersionsLoading
                              ? '...'
                              : aiStaticVersions.length
                                ? `${currentAiVersionCursor + 1}/${aiStaticVersions.length}`
                                : '0/0'}
                          </span>
                          <button
                            type="button"
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                            disabled={
                              aiStaticVersionsLoading ||
                              !aiStaticVersions.length ||
                              currentAiVersionCursor >= aiStaticVersions.length - 1
                            }
                            onClick={() =>
                              setVersionCursorByAgentId((prev) => ({
                                ...prev,
                                [selectedAiAgentId]: Math.min(aiStaticVersions.length - 1, currentAiVersionCursor + 1),
                              }))
                            }
                          >
                            {'>'}
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {aiStaticVersionsLoading
                            ? 'Loading versions...'
                            : viewedAiVersionMeta
                              ? `Version ${viewedAiVersionMeta.revision_no ?? currentAiVersionCursor + 1} · ${formatVersionTimestamp(viewedAiVersionMeta.saved_at)} (${userTimeZone})`
                              : 'No saved version yet'}
                        </div>
                        <div className="mt-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback Content</div>
                          {!isSingleChoiceQuestion && viewedAiVersionDraft?.question_feedback_text?.trim() ? (
                            <div className="mt-1">
                              <div className="text-xs font-semibold text-slate-600">Question feedback</div>
                              <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800">
                                {viewedAiVersionDraft.question_feedback_text.trim()}
                              </div>
                            </div>
                          ) : null}
                          {viewedAiOptionFeedbackRows.length ? (
                            <div className="mt-2 space-y-2">
                              <div className="text-xs font-semibold text-slate-600">Option feedback</div>
                              {viewedAiOptionFeedbackRows.map((row) => (
                                <div key={`ai-option-feedback-${row.label}`} className="rounded border border-slate-200 bg-white px-2 py-2">
                                  <div className="text-xs font-semibold text-slate-600">{row.label}</div>
                                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{row.text}</div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {(!isSingleChoiceQuestion ? !viewedAiVersionDraft?.question_feedback_text?.trim() : true) &&
                          !viewedAiOptionFeedbackRows.length ? (
                            <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800">
                              (empty)
                            </div>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeFeedbackTab === 'ai' ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">AI Dry Run</div>
                  <p className="text-xs text-slate-500">Run once and inspect resolved inputs, rendered prompt, and output.</p>
                </div>
                <ActionButton
                  type="button"
                  size="sm"
                  variant="primary"
                  className="rounded-lg"
                  onClick={runAiDryRun}
                  disabled={isAiDryRunRunning || !selectedAiAgentIdForDryRun}
                >
                  {isAiDryRunRunning ? 'Running...' : 'Dry Run'}
                </ActionButton>
              </div>
              <div className="mt-2 text-xs text-slate-600">
                Selected agent: {selectedAiAgentForDryRun?.title || selectedAiAgentIdForDryRun || '-'}
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dry Run Inputs</div>
                <div className="mt-1 text-xs text-slate-500">
                  retrieved_slide_pages is backend-resolved from agent retrieval rules.
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-1">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Learner Answer (answer_text)
                    </label>
                    <textarea
                      rows={4}
                      value={aiDryRunLearnerAnswer}
                      onChange={(e) => setAiDryRunLearnerAnswer(e.target.value)}
                      placeholder="Type a sample learner answer for dry run"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300"
                    />
                    {autoSampleAnswer ? (
                      <button
                        type="button"
                        className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        onClick={() => setAiDryRunLearnerAnswer(autoSampleAnswer)}
                      >
                        Fill sample answer from correct option
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {aiDryRunError ? (
                <div className="mt-3 whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  {aiDryRunError}
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolved Input Values</div>
                  <div className="mt-2 space-y-2 text-xs text-slate-700">
                    <div>
                      <div className="font-semibold text-slate-600">Question</div>
                      {String(aiDryRunInputValues?.question_content_blocks ?? '').trim() ? (
                        <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          {String(aiDryRunInputValues?.question_content_blocks ?? '')}
                        </div>
                      ) : (
                        <div className="mt-1 text-slate-500">(empty)</div>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-600">Answer</div>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-2 py-1">
                        {String(aiDryRunInputValues?.answer_text ?? '') || '(empty)'}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-600">Slide Content</div>
                      {Array.isArray(aiDryRunInputValues?.retrieved_slide_pages) &&
                      (aiDryRunInputValues?.retrieved_slide_pages as any[]).length ? (
                        <div className="mt-1 space-y-1">
                          {(aiDryRunInputValues?.retrieved_slide_pages as any[]).map((page, idx) => (
                            <div key={`dry-run-slide-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                              <span className="text-slate-500">
                                {`#${idx + 1} ${String(page?.slide_id ?? page?.slideId ?? '-')}:${String(page?.page ?? page?.page_no ?? '-')}`}
                              </span>
                              <div className="whitespace-pre-wrap">{String(page?.text ?? page?.content ?? page?.summary ?? '') || '(no text)'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1 text-slate-500">[]</div>
                      )}
                    </div>
                  </div>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                    {JSON.stringify(aiDryRunInputValues ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rendered Prompt (Backend)</div>
                  <div className="mt-2 text-xs font-semibold text-slate-600">resolved_system_prompt</div>
                  <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                    {aiDryRunResolvedSystemPrompt || '(not returned by backend)'}
                  </pre>
                  <div className="mt-3 text-xs font-semibold text-slate-600">resolved_user_text</div>
                  <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                    {aiDryRunResolvedUserText || '(not returned by backend)'}
                  </pre>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dry Run Output</div>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                  {aiDryRunOutput || '(no output yet)'}
                </pre>
              </div>
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );
}
