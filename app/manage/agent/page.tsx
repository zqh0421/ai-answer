'use client';

import axios from 'axios';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import ActionButton from '@/app/components/ActionButton';
import ManageDataTable, { ManageTableColumn } from '@/app/components/manage/ManageDataTable';
import ManageListPanel from '@/app/components/manage/ManageListPanel';
import { useManagePermissionGuard } from '@/app/manage/hooks/useManagePermissionGuard';
import {
  COMPOSITION_LITERAL_TOKENS,
  COMPOSITION_VARIABLE_TOKENS,
  FEEDBACK_COMPOSITION_STORAGE_KEY,
  createDefaultCompositionRule,
  createRuleId,
  FeedbackComposition,
  FeedbackCompositionRule,
  parseFeedbackCompositionsResponse,
} from '@/app/lib/feedbackCompositions';
import { formatDateTimeForUser } from '@/app/utils/datetime';
import { buildStaticPageTitle } from '@/app/utils/title';

type AgentRole = 'human' | 'ai';
type AgentScope = 'private' | 'public';
type ApplyQuestionType =
  | 'single_choice'
  | 'multi_choice'
  | 'dropdown'
  | 'true_false'
  | 'free_text'
  | 'essay'
  | 'all';
type RetrievalPreferredInfoType = 'text' | 'vision' | 'mixed';
type RetrievalSelectionMode = 'top_k' | 'all' | 'threshold' | 'threshold_then_top_k';

interface RetrievalRule {
  preferred_info_type?: RetrievalPreferredInfoType;
  selection_mode?: RetrievalSelectionMode;
  max_pages?: number | null;
  similarity_threshold?: number | null;
  include_similarity?: boolean;
}

interface FeedbackAgentInput {
  input_key: string;
  is_required?: boolean;
  sort_order?: number;
  retrieval_rule?: RetrievalRule | null;
}

interface DryRunQuestionLite {
  question_id: string;
  title: string;
  question_type: string;
  access_scope: string;
  content: Array<{ type: 'text' | 'image'; content: string }>;
  options: Array<{ text: string; isCorrect: boolean }>;
}

interface FeedbackAgent {
  agent_id: string;
  title?: string;
  role?: string;
  apply_question_type?: ApplyQuestionType;
  if_score?: boolean;
  score_ai_agent_id?: string | null;
  is_structured?: boolean;
  provider?: string;
  model?: string;
  access_scope?: string;
  is_visible?: boolean;
  created_by?: string;
  created_by_name?: string;
  created_by_email?: string;
  created_by_display?: string;
  created_at?: string;
  updated_at?: string;
  prompt_text?: string;
  inputs?: Array<string | FeedbackAgentInput>;
  llm_params?: Record<string, unknown> | null;
}

interface AgentFormState {
  title: string;
  role: AgentRole;
  apply_question_type: ApplyQuestionType;
  if_score: boolean;
  score_ai_agent_id: string;
  is_structured: boolean;
  provider: string;
  model: string;
  prompt_text: string;
  feedback_generation_block: string;
  additional_formatting_instructions_block: string;
  retrieved_slide_pages_rule?: RetrievalRule;
  llm_params_json: string;
}

interface PromptBlockMeta {
  label?: string;
  description?: string;
  placeholder?: string;
}

interface PromptBlocksMeta {
  feedback_generation_block?: PromptBlockMeta;
  additional_formatting_instructions_block?: PromptBlockMeta;
}

interface CompositionFormState {
  composition_id: string;
  title: string;
  description: string;
  rules: FeedbackCompositionRule[];
}

const DEFAULT_INPUT_KEYS = [
  'question_content_blocks',
  'answer_text',
  'retrieved_slide_pages',
] as const;
let cachedInputOptionKeys: string[] | null = null;
let cachedPromptBlocksMeta: PromptBlocksMeta | null = null;
const DEFAULT_RETRIEVED_SLIDE_PAGES_RULE: RetrievalRule = {
  preferred_info_type: 'vision',
  selection_mode: 'top_k',
  max_pages: 3,
  similarity_threshold: 0,
  include_similarity: true,
};

const defaultFormState = (): AgentFormState => ({
  title: '',
  role: 'human',
  apply_question_type: 'all',
  if_score: false,
  score_ai_agent_id: '',
  is_structured: false,
  provider: '',
  model: '',
  prompt_text: '',
  feedback_generation_block: '',
  additional_formatting_instructions_block: '',
  retrieved_slide_pages_rule: undefined,
  llm_params_json: '',
});

const defaultCompositionFormState = (): CompositionFormState => ({
  composition_id: '',
  title: '',
  description: '',
  rules: [createDefaultCompositionRule()],
});

const formatDateTime = (value?: string) => formatDateTimeForUser(value);
const COMPOSITION_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const compositionFeedbackModeLabel = (mode: FeedbackCompositionRule['feedback_mode']) =>
  mode === 'runtime_generate' ? 'Runtime Generate' : 'Use Latest Version';
const compositionSlideModeLabel = (mode: FeedbackCompositionRule['slide_mode']) => {
  if (mode === 'slide_file') return 'Slide File';
  if (mode === 'no_slide') return 'No Slide';
  return 'Most Relevant Slide Page';
};

const looksLikeEmail = (value?: string | null) => Boolean(value && value.includes('@'));

const resolveActorUserId = (sessionUser: any): string => {
  const candidates = [
    sessionUser?.user_id,
    sessionUser?.id,
    sessionUser?.sub,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  const nonEmailCandidate = candidates.find((value) => !looksLikeEmail(value));
  return nonEmailCandidate ?? '';
};

const hasMeaningfulRetrievalRuleConfig = (rule?: RetrievalRule) =>
  Boolean(rule && Object.values(rule).some((value) => value !== undefined && value !== null && value !== ''));

const getEffectiveRetrievedSlidePagesRule = (rule?: RetrievalRule): RetrievalRule => ({
  ...DEFAULT_RETRIEVED_SLIDE_PAGES_RULE,
  ...(rule ?? {}),
});

const normalizeAgentInput = (input: string | FeedbackAgentInput): AgentFormInputRow | null => {
  if (typeof input === 'string') {
    return { input_key: input };
  }
  if (!input || typeof input !== 'object') return null;
  if (!input.input_key) return null;
  return {
    input_key: String(input.input_key),
    retrieval_rule:
      input.retrieval_rule && typeof input.retrieval_rule === 'object'
        ? { ...input.retrieval_rule }
        : undefined,
  };
};
type AgentFormInputRow = {
  input_key: string;
  retrieval_rule?: RetrievalRule;
};

const readFirstString = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
};

const extractQuestionTypeText = (raw: any): string => {
  const rawType = readFirstString(
    raw?.question_type,
    raw?.type,
    raw?.current_version?.question_type,
    raw?.current_version?.type
  );
  if (!rawType) return '';
  return rawType.toLowerCase().replace(/[_-]+/g, ' ');
};

const normalizeQuestionTypeForApply = (raw: any): ApplyQuestionType | 'unknown' => {
  const typeText = extractQuestionTypeText(raw);
  if (!typeText) return 'unknown';
  if (typeText.includes('single choice') || typeText.includes('single_choice')) return 'single_choice';
  if (typeText.includes('multi choice') || typeText.includes('multiple choice') || typeText.includes('multi_choice') || typeText.includes('mcq')) {
    return 'multi_choice';
  }
  if (typeText.includes('dropdown')) return 'dropdown';
  if (typeText.includes('true false') || typeText.includes('true/false') || typeText.includes('true_false')) {
    return 'true_false';
  }
  if (typeText.includes('free text') || typeText.includes('short answer') || typeText.includes('open ended') || typeText.includes('open-ended')) {
    return 'free_text';
  }
  if (typeText.includes('essay')) return 'essay';
  return 'unknown';
};

const extractQuestionContentBlocks = (raw: any): Array<{ type: 'text' | 'image'; content: string }> => {
  const blocks = Array.isArray(raw?.content_blocks)
    ? raw.content_blocks
    : Array.isArray(raw?.current_version?.content_blocks)
      ? raw.current_version.content_blocks
      : [];

  return blocks
    .map((block: any) => {
      const typeRaw = String(block?.block_type ?? block?.type ?? '').toLowerCase();
      const text = readFirstString(block?.text_content, block?.content, block?.text);
      const media = readFirstString(block?.media_url, block?.image_url, block?.src, block?.url);
      if (typeRaw.includes('image') && media) return { type: 'image' as const, content: media };
      if (text) return { type: 'text' as const, content: text };
      if (media) return { type: 'image' as const, content: media };
      return null;
    })
    .filter(Boolean) as Array<{ type: 'text' | 'image'; content: string }>;
};

const extractInteractionPromptText = (raw: any): string => {
  const interactions = Array.isArray(raw?.interactions)
    ? raw.interactions
    : Array.isArray(raw?.current_version?.interactions)
      ? raw.current_version.interactions
      : [];
  const firstInteraction = interactions[0] ?? {};
  return readFirstString(
    firstInteraction?.prompt,
    firstInteraction?.prompt_text,
    firstInteraction?.question_text,
    firstInteraction?.text,
    firstInteraction?.label,
    firstInteraction?.stem
  );
};

const extractQuestionOptions = (raw: any): Array<{ text: string; isCorrect: boolean }> => {
  const interactions = Array.isArray(raw?.interactions)
    ? raw.interactions
    : Array.isArray(raw?.current_version?.interactions)
      ? raw.current_version.interactions
      : [];
  const firstInteraction = interactions[0] ?? {};
  const direct = Array.isArray(raw?.options) ? raw.options : [];
  const interactionOptions = Array.isArray(raw?.interaction_options) ? raw.interaction_options : [];
  const nested =
    Array.isArray(firstInteraction?.options)
      ? firstInteraction.options
      : Array.isArray(firstInteraction?.interaction_options)
        ? firstInteraction.interaction_options
        : [];
  const source = direct.length > 0 ? direct : interactionOptions.length > 0 ? interactionOptions : nested;
  return source
    .map((option: any) => ({
      text: String(
        option?.text ??
          option?.option_text ??
          option?.label ??
          option?.option_label ??
          option?.option_value ??
          option?.content ??
          ''
      ).trim(),
      isCorrect: Boolean(option?.is_correct ?? option?.isCorrect ?? option?.correct),
    }))
    .filter((row: { text: string; isCorrect: boolean }) => row.text || row.isCorrect);
};

const parseDryRunQuestion = (raw: any): DryRunQuestionLite => {
  const contentBlocks = extractQuestionContentBlocks(raw);
  const interactionPromptText = extractInteractionPromptText(raw);
  const content =
    contentBlocks.length > 0
      ? contentBlocks
      : interactionPromptText
        ? [{ type: 'text' as const, content: interactionPromptText }]
        : [];
  return {
    question_id: String(raw?.question_id ?? raw?.id ?? ''),
    title: readFirstString(raw?.title, raw?.name) || '',
    question_type: readFirstString(raw?.question_type, raw?.type, raw?.current_version?.question_type, raw?.current_version?.type),
    access_scope: readFirstString(raw?.access_scope, raw?.current_version?.access_scope) || '',
    content,
    options: extractQuestionOptions(raw),
  };
};

const getDryRunQuestionLabel = (question: DryRunQuestionLite): string => {
  const firstText = question.content.find((item) => item.type === 'text' && item.content.trim())?.content?.trim() ?? '';
  const preview = firstText || question.title || '(No question text)';
  const compactPreview = preview.length > 90 ? `${preview.slice(0, 90)}...` : preview;
  return `${compactPreview} [${question.question_type || 'unknown'}]`;
};

const getQuestionsPageItems = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.questions)) return payload.questions;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const buildFormattedQuestionTextForDryRun = (question: DryRunQuestionLite | null): string => {
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

  const normalizedType = normalizeQuestionTypeForApply(question);
  const isChoiceLike =
    normalizedType === 'single_choice' || normalizedType === 'multi_choice' || (question.options?.length ?? 0) > 0;
  if (!isChoiceLike) return questionText;

  const options = (question.options ?? [])
    .map((option, idx) => `${idx + 1}. ${String(option.text ?? '').trim() || '(Empty option)'}`)
    .join('\n');
  const correct = (question.options ?? []).find((option) => option.isCorrect)?.text?.trim() || '(not set)';
  return ['Question:', questionText || '(empty)', '', 'Options:', options || '(no options)', '', `Correct Answer: ${correct}`]
    .join('\n')
    .trim();
};

const PROMPT_VAR_REGEX = /\{\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\}/g;

const extractPromptVariables = (text: string, allowedPromptKeys: Set<string>) => {
  const matches: Array<{ raw: string; key: string; index: number }> = [];
  const validKeys: string[] = [];
  const invalidKeys: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();
  let match: RegExpExecArray | null;
  PROMPT_VAR_REGEX.lastIndex = 0;
  while ((match = PROMPT_VAR_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const key = match[1];
    matches.push({ raw, key, index: match.index });
    if (allowedPromptKeys.has(key)) {
      if (!seenValid.has(key)) {
        seenValid.add(key);
        validKeys.push(key);
      }
    } else if (!seenInvalid.has(key)) {
      seenInvalid.add(key);
      invalidKeys.push(key);
    }
  }
  return { matches, validKeys, invalidKeys };
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildPromptHighlightHtml = (text: string, allowedPromptKeys: Set<string>) => {
  if (!text) return '<span class="text-slate-400">Use {{{question_content_blocks}}}, {{{answer_text}}}, {{{retrieved_slide_pages}}}.</span>';
  let html = '';
  let lastIndex = 0;
  PROMPT_VAR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROMPT_VAR_REGEX.exec(text)) !== null) {
    const [raw, key] = match;
    html += escapeHtml(text.slice(lastIndex, match.index));
    const valid = allowedPromptKeys.has(key);
    html += `<span class="${valid ? 'rounded bg-blue-100 text-blue-800 px-0.5' : 'rounded bg-rose-100 text-rose-700 px-0.5'}">${escapeHtml(raw)}</span>`;
    lastIndex = match.index + raw.length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html.replace(/\n$/g, '\n ');
};

const buildPromptAssemblyPreview = (
  feedbackGenerationBlock: string,
  additionalFormattingInstructionsBlock: string
) => {
  const task1Block = feedbackGenerationBlock.trim() || '{{feedback_generation_block}}';
  const additionalFormattingBlock =
    additionalFormattingInstructionsBlock.trim() || '{{additional_formatting_instructions_block}}';

  return [
    "You are tasked with generating clear, effective feedback for a student's {{question_type}} answer and then formatting it into a structured JSON output. Complete both tasks in sequence.",
    '',
    '### Task 1: Generate Feedback',
    task1Block,
    '',
    '### Task 2: Format Output',
    'After generating the feedback, format your response as a JSON object with this exact structure:',
    '{{json_schema_block_by_mode}}',
    '',
    '#### Formatting Instructions:',
    '{{base_formatting_instructions}}',
    additionalFormattingBlock,
  ].join('\n');
};

const parseInputOptionKeys = (data: unknown): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  const visited = new Set<unknown>();
  const pushKey = (value: unknown) => {
    if (typeof value !== 'string') return;
    const key = value.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  const looksLikeInputKey = (value: string) => /^[a-z][a-z0-9_]*$/.test(value);

  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 6 || visited.has(node)) return;
    if (typeof node !== 'object') return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
      }
      return;
    }

    const obj = node as Record<string, unknown>;

    pushKey(obj.input_key ?? obj.key);

    for (const [field, value] of Object.entries(obj)) {
      const lowerField = field.toLowerCase();

      if (Array.isArray(value) && (lowerField.includes('key') || lowerField.includes('variable'))) {
        for (const item of value) {
          if (typeof item === 'string' && looksLikeInputKey(item)) pushKey(item);
          if (item && typeof item === 'object') {
            const row = item as Record<string, unknown>;
            pushKey(row.input_key ?? row.key ?? row.name);
          }
        }
      }

      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (lowerField === 'inputs' ||
          lowerField === 'input_options' ||
          lowerField === 'supported_inputs' ||
          lowerField === 'input_definitions')
      ) {
        for (const [candidateKey, candidateValue] of Object.entries(value as Record<string, unknown>)) {
          if (looksLikeInputKey(candidateKey)) {
            if (
              candidateValue &&
              typeof candidateValue === 'object' &&
              !Array.isArray(candidateValue)
            ) {
              const meta = candidateValue as Record<string, unknown>;
              if (
                'retrieval_rule_schema' in meta ||
                'input_key' in meta ||
                'label' in meta ||
                'description' in meta ||
                'is_required' in meta ||
                'sort_order' in meta
              ) {
                pushKey(candidateKey);
              }
            } else {
              pushKey(candidateKey);
            }
          }
          visit(candidateValue, depth + 1);
        }
        continue;
      }

      visit(value, depth + 1);
    }
  };

  visit(data, 0);
  return keys;
};

const parsePromptBlocksMeta = (data: unknown): PromptBlocksMeta => {
  const targetKeys = new Set([
    'feedback_generation_block',
    'additional_formatting_instructions_block',
  ]);
  const visited = new Set<unknown>();
  let candidate: Record<string, unknown> | null = null;

  const toMeta = (value: unknown): PromptBlockMeta => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const obj = value as Record<string, unknown>;
    const pickString = (...fields: string[]) => {
      for (const field of fields) {
        const raw = obj[field];
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
      }
      return undefined;
    };
    return {
      label: pickString('label', 'title', 'name'),
      description: pickString('description', 'help_text', 'help', 'hint'),
      placeholder: pickString('placeholder', 'default_value', 'default', 'value'),
    };
  };

  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 6 || visited.has(node)) return;
    if (typeof node !== 'object') return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    const obj = node as Record<string, unknown>;
    const promptBlocks = obj.prompt_blocks;
    if (
      promptBlocks &&
      typeof promptBlocks === 'object' &&
      !Array.isArray(promptBlocks)
    ) {
      const blockObj = promptBlocks as Record<string, unknown>;
      const hasKnownBlock = Array.from(targetKeys).some((key) => key in blockObj);
      if (hasKnownBlock) {
        candidate = blockObj;
        return;
      }
    }

    for (const value of Object.values(obj)) {
      visit(value, depth + 1);
      if (candidate) return;
    }
  };

  visit(data, 0);
  if (!candidate) return {};

  return {
    feedback_generation_block: toMeta(candidate.feedback_generation_block),
    additional_formatting_instructions_block: toMeta(candidate.additional_formatting_instructions_block),
  };
};

const normalizeAgent = (raw: any): FeedbackAgent => ({
  agent_id: String(raw?.agent_id ?? raw?.id ?? ''),
  title: raw?.title ?? raw?.name ?? '',
  role: raw?.role,
  apply_question_type: raw?.apply_question_type,
  if_score: Boolean(raw?.if_score),
  score_ai_agent_id:
    typeof raw?.score_ai_agent_id === 'string' ? raw.score_ai_agent_id : raw?.score_ai_agent_id ?? null,
  is_structured: raw?.is_structured,
  provider: raw?.provider,
  model: raw?.model,
  access_scope: raw?.access_scope,
  is_visible: raw?.is_visible,
  created_by: raw?.created_by,
  created_by_name: raw?.created_by_name ?? raw?.creator_name ?? raw?.created_by_user_name,
  created_by_email: raw?.created_by_email ?? raw?.creator_email ?? raw?.created_by_user_email,
  created_by_display: raw?.created_by_display ?? raw?.creator_display,
  created_at: raw?.created_at,
  updated_at: raw?.updated_at,
  prompt_text: raw?.prompt_text,
  inputs: Array.isArray(raw?.inputs) ? raw.inputs : [],
  llm_params: raw?.llm_params && typeof raw.llm_params === 'object' ? raw.llm_params : null,
});

const parseAgentsResponse = (data: unknown): FeedbackAgent[] => {
  if (Array.isArray(data)) return data.map(normalizeAgent).filter((a) => a.agent_id);
  if (!data || typeof data !== 'object') return [];
  const payload = data as Record<string, unknown>;
  const itemsCandidate =
    payload.items ?? payload.agents ?? payload.feedback_agents ?? payload.data ?? payload.results;
  if (!Array.isArray(itemsCandidate)) return [];
  return itemsCandidate.map(normalizeAgent).filter((a) => a.agent_id);
};

const buildFormStateFromAgent = (agent: FeedbackAgent): AgentFormState => {
  const inputs = (agent.inputs ?? []).map(normalizeAgentInput).filter(Boolean) as AgentFormInputRow[];
  const retrievedSlideInput = inputs.find((input) => input.input_key === 'retrieved_slide_pages');
  const promptTextFromInputs = inputs
    .map((input) => input.input_key)
    .filter((key): key is string => Boolean(key))
    .map((key) => `{{{${key}}}}`)
    .join('\n');
  const role = agent.role === 'ai' ? 'ai' : 'human';
  const llmParams = agent.llm_params && typeof agent.llm_params === 'object' ? { ...agent.llm_params } : null;
  const feedbackGenerationBlock =
    llmParams && typeof llmParams.feedback_generation_block === 'string'
      ? llmParams.feedback_generation_block
      : '';
  const additionalFormattingInstructionsBlock =
    llmParams && typeof llmParams.additional_formatting_instructions_block === 'string'
      ? llmParams.additional_formatting_instructions_block
      : '';
  if (llmParams) {
    delete llmParams.feedback_generation_block;
    delete llmParams.additional_formatting_instructions_block;
  }
  return {
    title: agent.title ?? '',
    role,
    apply_question_type: (agent.apply_question_type as ApplyQuestionType) || 'all',
    if_score: role === 'human' ? Boolean(agent.if_score) : false,
    score_ai_agent_id: role === 'human' ? String(agent.score_ai_agent_id ?? '') : '',
    is_structured: role === 'human' ? false : Boolean(agent.is_structured),
    provider: agent.provider ?? '',
    model: agent.model ?? '',
    prompt_text: role === 'human' ? '' : (agent.prompt_text ?? '').trim() || promptTextFromInputs,
    feedback_generation_block: role === 'human' ? '' : feedbackGenerationBlock,
    additional_formatting_instructions_block: role === 'human' ? '' : additionalFormattingInstructionsBlock,
    retrieved_slide_pages_rule: retrievedSlideInput?.retrieval_rule ? { ...retrievedSlideInput.retrieval_rule } : undefined,
    llm_params_json:
      llmParams && Object.keys(llmParams).length > 0 ? JSON.stringify(llmParams, null, 2) : '',
  };
};

export default function AgentManagementPage() {
  const [agents, setAgents] = useState<FeedbackAgent[]>([]);
  const [isFetchingAgents, setIsFetchingAgents] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<'create' | 'duplicate'>('create');
  const [form, setForm] = useState<AgentFormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);
  const [inputOptionKeys, setInputOptionKeys] = useState<string[]>(cachedInputOptionKeys ?? []);
  const [isFetchingInputOptions, setIsFetchingInputOptions] = useState(false);
  const [inputOptionsError, setInputOptionsError] = useState<string | null>(null);
  const [editingSourceAgentId, setEditingSourceAgentId] = useState<string | null>(null);
  const [actingAgentId, setActingAgentId] = useState<string | null>(null);
  const [isAdvancedLlmOpen, setIsAdvancedLlmOpen] = useState(false);
  const [promptBlocksMeta, setPromptBlocksMeta] = useState<PromptBlocksMeta>({});
  const [dryRunQuestions, setDryRunQuestions] = useState<DryRunQuestionLite[]>([]);
  const [isFetchingDryRunQuestions, setIsFetchingDryRunQuestions] = useState(false);
  const [dryRunQuestionError, setDryRunQuestionError] = useState<string | null>(null);
  const [selectedDryRunAgentId, setSelectedDryRunAgentId] = useState('');
  const [selectedDryRunQuestionId, setSelectedDryRunQuestionId] = useState('');
  const [dryRunLearnerAnswer, setDryRunLearnerAnswer] = useState('');
  const [isDryRunRunning, setIsDryRunRunning] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunResolvedInputValues, setDryRunResolvedInputValues] = useState<Record<string, unknown> | null>(null);
  const [dryRunResolvedSystemPrompt, setDryRunResolvedSystemPrompt] = useState('');
  const [dryRunResolvedUserText, setDryRunResolvedUserText] = useState('');
  const [dryRunOutput, setDryRunOutput] = useState('');
  const [dryRunAiScoreResult, setDryRunAiScoreResult] = useState<Record<string, unknown> | null>(null);
  const [dryRunStructuredFeedbackText, setDryRunStructuredFeedbackText] = useState('');
  const [compositions, setCompositions] = useState<FeedbackComposition[]>([]);
  const [isCompositionPanelOpen, setIsCompositionPanelOpen] = useState(false);
  const [compositionPanelMode, setCompositionPanelMode] = useState<'create' | 'edit'>('create');
  const [compositionForm, setCompositionForm] = useState<CompositionFormState>(defaultCompositionFormState);
  const [editingCompositionId, setEditingCompositionId] = useState<string | null>(null);
  const [compositionError, setCompositionError] = useState<string | null>(null);
  const [isFetchingCompositions, setIsFetchingCompositions] = useState(false);
  const [isSubmittingComposition, setIsSubmittingComposition] = useState(false);
  const feedbackBlockTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const feedbackBlockHighlightRef = useRef<HTMLDivElement | null>(null);

  const { data: session, status: sessionStatus } = useSession();
  const { hasManagePermission, isPermissionChecking, manageUserId } = useManagePermissionGuard();
  const sessionUser = (session?.user as any) ?? null;
  const sessionUserId = resolveActorUserId(sessionUser);
  const sessionUserEmail = (session?.user as any)?.email as string | undefined;
  const sessionUserName = (session?.user as any)?.name as string | undefined;
  const actorUserId = manageUserId || sessionUserId;

  useEffect(() => {
    document.title = buildStaticPageTitle('Agent Management');
  }, []);

  const fetchCompositions = useCallback(async () => {
    setIsFetchingCompositions(true);
    try {
      const res = await axios.get('/api/feedback-compositions', {
        params: {
          user_id: actorUserId || undefined,
          include_public: true,
        },
      });
      setCompositions(parseFeedbackCompositionsResponse(res.data));
      setCompositionError(null);
    } catch (err) {
      console.error('Error fetching feedback compositions:', err);
      setCompositions([]);
      setCompositionError('Failed to load compositions from database.');
    } finally {
      setIsFetchingCompositions(false);
    }
  }, [actorUserId]);

  const fetchInputOptions = useCallback(async () => {
    if (cachedInputOptionKeys?.length) {
      setInputOptionKeys(cachedInputOptionKeys);
      setPromptBlocksMeta(cachedPromptBlocksMeta ?? {});
      setInputOptionsError(null);
      return;
    }

    setIsFetchingInputOptions(true);
    setInputOptionsError(null);
    try {
      const res = await axios.get('/api/feedback-agents/input-options');
      const parsedPromptBlocksMeta = parsePromptBlocksMeta(res.data);
      cachedPromptBlocksMeta = parsedPromptBlocksMeta;
      setPromptBlocksMeta(parsedPromptBlocksMeta);
      const keys = parseInputOptionKeys(res.data).filter(
        (key) => key !== 'all_options' && key !== 'selected_option_index'
      );
      if (keys.length > 0) {
        cachedInputOptionKeys = keys;
        setInputOptionKeys(keys);
      } else {
        console.warn('feedback-agents/input-options returned no parseable prompt keys; using fallback defaults');
        setInputOptionKeys([...DEFAULT_INPUT_KEYS]);
        setInputOptionsError(null);
      }
    } catch (err) {
      console.error('Error fetching feedback agent input options:', err);
      setInputOptionKeys((prev) => (prev.length ? prev : [...DEFAULT_INPUT_KEYS]));
      setPromptBlocksMeta(cachedPromptBlocksMeta ?? {});
      setInputOptionsError('Failed to load input options. Using fallback defaults.');
    } finally {
      setIsFetchingInputOptions(false);
    }
  }, []);

  const searchQueryTokens = searchQuery.trim().split(/\s+/).filter(Boolean);
  const searchUserToken = searchQueryTokens.find((token) => /^user:/i.test(token));
  const searchCreatorToken = searchQueryTokens.find((token) => /^creator:/i.test(token));
  const searchUserId = searchUserToken ? searchUserToken.replace(/^user:/i, '').trim() : '';
  const searchCreator = searchCreatorToken ? searchCreatorToken.replace(/^creator:/i, '').trim().toLowerCase() : '';
  const queryUserId = searchUserId || actorUserId;

  const fetchAgents = useCallback(async () => {
    setIsFetchingAgents(true);
    setError(null);
    try {
      const res = await axios.get('/api/feedback-agents', {
        params: {
          include_inputs: true,
          user_id: queryUserId || undefined,
        },
      });
      setAgents(parseAgentsResponse(res.data));
      setMessage(null);
    } catch (err) {
      console.error('Error fetching feedback agents:', err);
      setAgents([]);
      setError('Failed to load feedback agents.');
    } finally {
      setIsFetchingAgents(false);
    }
  }, [queryUserId]);

  const fetchDryRunQuestions = useCallback(async () => {
    if (!hasManagePermission || !actorUserId) return;
    setIsFetchingDryRunQuestions(true);
    setDryRunQuestionError(null);
    try {
      const limit = 100;
      let offset = 0;
      let allRows: any[] = [];
      while (true) {
        const res = await axios.get('/api/questions', {
          params: {
            user_id: actorUserId,
            include_public: true,
            limit,
            offset,
            include: 'current_version,content_blocks,interactions,options,interaction_options',
          },
        });
        const pageItems = getQuestionsPageItems(res.data);
        allRows = allRows.concat(pageItems);
        if (pageItems.length < limit) break;
        offset += limit;
      }
      const parsed = allRows.map(parseDryRunQuestion).filter((question) => question.question_id);
      setDryRunQuestions(parsed);
      setSelectedDryRunQuestionId((prev) =>
        prev && parsed.some((question) => question.question_id === prev) ? prev : (parsed[0]?.question_id ?? '')
      );
    } catch (err) {
      console.error('Error fetching dry-run questions:', err);
      setDryRunQuestions([]);
      setDryRunQuestionError('Failed to load questions for dry run.');
    } finally {
      setIsFetchingDryRunQuestions(false);
    }
  }, [actorUserId, hasManagePermission]);

  useEffect(() => {
    if (sessionStatus === 'loading' || isPermissionChecking || !hasManagePermission) return;
    fetchAgents();
  }, [fetchAgents, hasManagePermission, isPermissionChecking, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'loading' || isPermissionChecking || !hasManagePermission || !actorUserId) return;
    void fetchDryRunQuestions();
  }, [actorUserId, fetchDryRunQuestions, hasManagePermission, isPermissionChecking, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'loading' || isPermissionChecking || !hasManagePermission) return;
    fetchInputOptions();
  }, [fetchInputOptions, hasManagePermission, isPermissionChecking, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'loading' || isPermissionChecking || !hasManagePermission) return;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(FEEDBACK_COMPOSITION_STORAGE_KEY);
    }
    void fetchCompositions();
  }, [fetchCompositions, hasManagePermission, isPermissionChecking, sessionStatus]);

  const normalizedSearch = searchQueryTokens
    .filter((token) => !/^user:/i.test(token) && !/^creator:/i.test(token))
    .join(' ')
    .toLowerCase();
  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      const creatorHaystack = [
        agent.created_by,
        agent.created_by_name,
        agent.created_by_email,
        agent.created_by_display,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (searchCreator && !creatorHaystack.includes(searchCreator)) {
        return false;
      }

      if (!normalizedSearch) return true;
      const haystack = [
        agent.title,
        agent.role,
        agent.apply_question_type,
        agent.score_ai_agent_id,
        agent.if_score ? 'if_score' : '',
        agent.provider,
        agent.model,
        creatorHaystack,
        agent.access_scope,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [agents, normalizedSearch, searchCreator]);
  const availableInputKeys = inputOptionKeys.length > 0 ? inputOptionKeys : [...DEFAULT_INPUT_KEYS];
  const allowedPromptKeySet = useMemo(() => new Set<string>(availableInputKeys), [availableInputKeys]);
  const promptVariables = useMemo(
    () => extractPromptVariables(form.feedback_generation_block, allowedPromptKeySet),
    [allowedPromptKeySet, form.feedback_generation_block]
  );
  const feedbackBlockHighlightHtml = useMemo(
    () => buildPromptHighlightHtml(form.feedback_generation_block, allowedPromptKeySet),
    [allowedPromptKeySet, form.feedback_generation_block]
  );
  const promptAssemblyPreview = useMemo(
    () =>
      buildPromptAssemblyPreview(
        form.feedback_generation_block,
        form.additional_formatting_instructions_block
      ),
    [form.additional_formatting_instructions_block, form.feedback_generation_block]
  );
  const effectiveRetrievedSlidePagesRule = useMemo(
    () => getEffectiveRetrievedSlidePagesRule(form.retrieved_slide_pages_rule),
    [form.retrieved_slide_pages_rule]
  );
  const createdByDisplay = useMemo(() => {
    if (!sessionUserEmail && !sessionUserName) return actorUserId || '-';
    if (sessionUserName && sessionUserEmail) return `${sessionUserName} (${sessionUserEmail})`;
    return sessionUserName || sessionUserEmail || actorUserId || '-';
  }, [actorUserId, sessionUserEmail, sessionUserName]);
  const aiAgents = useMemo(
    () => agents.filter((agent) => String(agent.role ?? '').toLowerCase() === 'ai'),
    [agents]
  );
  const dryRunAgents = useMemo(
    () =>
      agents.filter((agent) => {
        const role = String(agent.role ?? '').toLowerCase();
        return role === 'ai' || role === 'human';
      }),
    [agents]
  );
  const selectedDryRunAgent = useMemo(
    () => dryRunAgents.find((agent) => agent.agent_id === selectedDryRunAgentId) ?? null,
    [dryRunAgents, selectedDryRunAgentId]
  );
  const selectedDryRunQuestion = useMemo(
    () => dryRunQuestions.find((question) => question.question_id === selectedDryRunQuestionId) ?? null,
    [dryRunQuestions, selectedDryRunQuestionId]
  );
  const dryRunAutoSampleAnswer = useMemo(
    () => selectedDryRunQuestion?.options.find((option) => option.isCorrect)?.text?.trim() ?? '',
    [selectedDryRunQuestion]
  );
  const visibleDryRunQuestions = dryRunQuestions;

  useEffect(() => {
    setSelectedDryRunAgentId((prev) => {
      if (prev && dryRunAgents.some((agent) => agent.agent_id === prev)) return prev;
      return dryRunAgents[0]?.agent_id ?? '';
    });
  }, [dryRunAgents]);

  useEffect(() => {
    if (!dryRunAutoSampleAnswer) return;
    setDryRunLearnerAnswer((prev) => (prev.trim() ? prev : dryRunAutoSampleAnswer));
  }, [dryRunAutoSampleAnswer]);

  useEffect(() => {
    setSelectedDryRunQuestionId((prev) => {
      if (prev && visibleDryRunQuestions.some((question) => question.question_id === prev)) return prev;
      return visibleDryRunQuestions[0]?.question_id ?? '';
    });
  }, [visibleDryRunQuestions]);

  if (isPermissionChecking || !hasManagePermission) {
    return null;
  }

  const openCreatePanel = () => {
    setPanelMode('create');
    setEditingSourceAgentId(null);
    setForm(defaultFormState());
    setMessage(null);
    setError(null);
    setIsAdvancedLlmOpen(false);
    setIsPanelOpen(true);
  };

  const openDuplicatePanel = (agent: FeedbackAgent) => {
    const next = buildFormStateFromAgent(agent);
    next.title = next.title ? `${next.title} Copy` : 'Agent Copy';
    setPanelMode('duplicate');
    setEditingSourceAgentId(agent.agent_id);
    setForm(next);
    setMessage(null);
    setError(null);
    setIsAdvancedLlmOpen(
      Boolean(
        next.llm_params_json.trim() ||
          next.feedback_generation_block.trim() ||
          next.additional_formatting_instructions_block.trim()
      )
    );
    setIsPanelOpen(true);
  };

  const setFormField = <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setRole = (role: AgentRole) => {
    setForm((prev) => {
      if (role === 'human') {
        return {
          ...prev,
          role: 'human',
          if_score: false,
          score_ai_agent_id: '',
          is_structured: false,
          prompt_text: '',
          provider: '',
          model: '',
          retrieved_slide_pages_rule: undefined,
          feedback_generation_block: '',
          additional_formatting_instructions_block: '',
          llm_params_json: '',
        };
      }
      return {
        ...prev,
        role: 'ai',
        apply_question_type: prev.apply_question_type || 'all',
        if_score: false,
        score_ai_agent_id: '',
        provider: prev.provider || 'openai',
      };
    });
  };

  const openCreateCompositionPanel = () => {
    setCompositionPanelMode('create');
    setEditingCompositionId(null);
    setCompositionForm(defaultCompositionFormState());
    setCompositionError(null);
    setIsCompositionPanelOpen(true);
  };

  const openEditCompositionPanel = (composition: FeedbackComposition) => {
    setCompositionPanelMode('edit');
    setEditingCompositionId(composition.composition_id);
    setCompositionForm({
      composition_id: composition.composition_id,
      title: composition.title,
      description: composition.description ?? '',
      rules: composition.rules.length > 0 ? composition.rules.map((rule) => ({ ...rule })) : [createDefaultCompositionRule()],
    });
    setCompositionError(null);
    setIsCompositionPanelOpen(true);
  };

  const setCompositionField = <K extends keyof CompositionFormState>(key: K, value: CompositionFormState[K]) => {
    setCompositionForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateCompositionRule = (ruleId: string, patch: Partial<FeedbackCompositionRule>) => {
    setCompositionForm((prev) => ({
      ...prev,
      rules: prev.rules.map((rule) => (rule.rule_id === ruleId ? { ...rule, ...patch } : rule)),
    }));
  };

  const addCompositionRule = () => {
    setCompositionForm((prev) => ({
      ...prev,
      rules: [...prev.rules, { ...createDefaultCompositionRule(), rule_id: createRuleId() }],
    }));
  };

  const removeCompositionRuleById = (ruleId: string) => {
    setCompositionForm((prev) => {
      if (prev.rules.length <= 1) return prev;
      return { ...prev, rules: prev.rules.filter((rule) => rule.rule_id !== ruleId) };
    });
  };

  const appendTokenToRuleExpression = (ruleId: string, token: string) => {
    setCompositionForm((prev) => ({
      ...prev,
      rules: prev.rules.map((rule) => {
        if (rule.rule_id !== ruleId) return rule;
        const base = rule.condition_expression.trim();
        return { ...rule, condition_expression: `${base}${base ? ' ' : ''}${token}` };
      }),
    }));
  };

  const handleSubmitComposition = async () => {
    setCompositionError(null);
    setError(null);
    setMessage(null);

    const compositionId = compositionForm.composition_id.trim();
    if (!compositionId) {
      setCompositionError('Composition ID is required.');
      return;
    }
    if (!COMPOSITION_ID_REGEX.test(compositionId)) {
      setCompositionError('Composition ID must be 2-64 chars, and use only letters, numbers, "_" or "-".');
      return;
    }

    const title = compositionForm.title.trim();
    if (!title) {
      setCompositionError('Composition title is required.');
      return;
    }
    if (compositionForm.rules.length === 0) {
      setCompositionError('At least one rule is required.');
      return;
    }
    for (const rule of compositionForm.rules) {
      if (!rule.condition_expression.trim()) {
        setCompositionError('Each rule must include a condition expression.');
        return;
      }
      if (!rule.feedback_agent_id.trim()) {
        setCompositionError('Each rule must select a feedback agent.');
        return;
      }
    }

    if (
      compositionPanelMode === 'create' &&
      compositions.some((composition) => composition.composition_id.toLowerCase() === compositionId.toLowerCase())
    ) {
      setCompositionError(`Composition ID "${compositionId}" already exists.`);
      return;
    }

    if (
      compositionPanelMode === 'edit' &&
      editingCompositionId &&
      compositionId !== editingCompositionId
    ) {
      setCompositionError('Composition ID cannot be changed in edit mode. Duplicate then create a new ID instead.');
      return;
    }

    const payload = {
      composition_id: compositionId,
      title,
      description: compositionForm.description.trim(),
      access_scope: 'public',
      is_visible: true,
      rules: compositionForm.rules.map((rule, index) => ({
        rule_order: index + 1,
        ...rule,
        condition_expression: rule.condition_expression.trim(),
        feedback_agent_id: rule.feedback_agent_id.trim(),
      })),
      ...(actorUserId ? { updated_by: actorUserId } : {}),
      ...(compositionPanelMode === 'create' && actorUserId ? { created_by: actorUserId } : {}),
    };

    setIsSubmittingComposition(true);
    try {
      let response;
      if (compositionPanelMode === 'edit') {
        response = await axios.patch(`/api/feedback-compositions/${encodeURIComponent(compositionId)}`, payload);
      } else {
        response = await axios.post('/api/feedback-compositions', payload);
      }
      const okFlag = (response?.data as any)?.ok;
      if (okFlag === false) {
        const detail = (response?.data as any)?.detail ?? (response?.data as any)?.message ?? 'Composition API returned ok=false.';
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      }
      await fetchCompositions();
      setIsCompositionPanelOpen(false);
      setEditingCompositionId(null);
      setCompositionForm(defaultCompositionFormState());
      setMessage(compositionPanelMode === 'edit' ? 'Composition updated successfully.' : 'Composition created successfully.');
    } catch (err) {
      console.error('Error saving composition:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setCompositionError(typeof detail === 'object' && detail !== null ? JSON.stringify(detail, null, 2) : String(detail));
          return;
        }
      }
      setCompositionError(compositionPanelMode === 'edit' ? 'Failed to update composition.' : 'Failed to create composition.');
    } finally {
      setIsSubmittingComposition(false);
    }
  };

  const handleDeleteComposition = async (composition: FeedbackComposition) => {
    const confirmed = window.confirm(`Delete composition "${composition.composition_id}"?`);
    if (!confirmed) return;
    setCompositionError(null);
    setError(null);
    setMessage(null);
    setIsSubmittingComposition(true);
    try {
      await axios.delete(`/api/feedback-compositions/${encodeURIComponent(composition.composition_id)}`, {
        params: actorUserId ? { updated_by: actorUserId } : undefined,
      });
      await fetchCompositions();
      setMessage('Composition deleted.');
    } catch (err) {
      console.error('Error deleting composition:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setCompositionError(typeof detail === 'object' && detail !== null ? JSON.stringify(detail, null, 2) : String(detail));
          return;
        }
      }
      setCompositionError('Failed to delete composition.');
    } finally {
      setIsSubmittingComposition(false);
    }
  };

  const handlePublishComposition = async (composition: FeedbackComposition) => {
    const confirmed = window.confirm(`Set composition "${composition.composition_id}" to public and visible?`);
    if (!confirmed) return;
    setCompositionError(null);
    setError(null);
    setMessage(null);
    setIsSubmittingComposition(true);
    try {
      const publishPayload = {
        composition_id: composition.composition_id,
        title: composition.title,
        description: composition.description ?? '',
        rules: (composition.rules ?? []).map((rule, index) => ({
          rule_order: index + 1,
          rule_id: rule.rule_id,
          condition_expression: rule.condition_expression,
          feedback_mode: rule.feedback_mode,
          feedback_agent_id: rule.feedback_agent_id,
          slide_mode: rule.slide_mode,
        })),
        access_scope: 'public',
        is_visible: true,
        ...(actorUserId ? { updated_by: actorUserId } : {}),
      };
      await axios.patch(`/api/feedback-compositions/${encodeURIComponent(composition.composition_id)}`, publishPayload);
      await fetchCompositions();
      setMessage(`Composition "${composition.composition_id}" published.`);
    } catch (err) {
      console.error('Error publishing composition:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setCompositionError(
            typeof detail === 'object' && detail !== null
              ? JSON.stringify(detail, null, 2)
              : String(detail)
          );
          return;
        }
      }
      setCompositionError(`Failed to publish composition "${composition.composition_id}".`);
    } finally {
      setIsSubmittingComposition(false);
    }
  };

  const insertPromptVariable = (key: string) => {
    if (form.role === 'human') return;
    const token = `{{{${key}}}}`;
    const el = feedbackBlockTextareaRef.current;
    if (!el) {
      setForm((prev) => ({
        ...prev,
        feedback_generation_block: `${prev.feedback_generation_block}${prev.feedback_generation_block ? ' ' : ''}${token}`,
      }));
      return;
    }
    const start = el.selectionStart ?? form.feedback_generation_block.length;
    const end = el.selectionEnd ?? form.feedback_generation_block.length;
    const next = `${form.feedback_generation_block.slice(0, start)}${token}${form.feedback_generation_block.slice(end)}`;
    setForm((prev) => ({ ...prev, feedback_generation_block: next }));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const buildDryRunInputValues = (
    agent: FeedbackAgent,
    question: DryRunQuestionLite,
    answerText: string
  ): Record<string, unknown> => {
    const keys = (agent.inputs ?? [])
      .map((input) => (typeof input === 'string' ? input : String(input?.input_key ?? '')))
      .map((value) => value.trim())
      .filter(Boolean);
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === 'question_content_blocks') {
        values[key] = buildFormattedQuestionTextForDryRun(question);
        continue;
      }
      if (key === 'all_options') {
        values[key] = buildFormattedQuestionTextForDryRun(question);
        continue;
      }
      if (key === 'selected_option_index') {
        values[key] = null;
        continue;
      }
      if (key === 'answer_text') {
        values[key] = answerText;
        continue;
      }
      if (key === 'retrieved_slide_pages') {
        continue;
      }
      values[key] = null;
    }
    const isHumanAgent = String(agent.role ?? '').toLowerCase() === 'human';
    if (isHumanAgent && Boolean(agent.if_score)) {
      if (!('answer_text' in values)) {
        values.answer_text = answerText;
      }
      if (!('question_content_blocks' in values)) {
        values.question_content_blocks = buildFormattedQuestionTextForDryRun(question);
      }
    }
    return values;
  };

  const runAgentDryRun = async () => {
    if (!selectedDryRunAgent) {
      setDryRunError('Please select a feedback agent.');
      return;
    }
    if (!selectedDryRunQuestion) {
      setDryRunError('Please select a question.');
      return;
    }
    if (!actorUserId) {
      setDryRunError('Unable to identify current user from session.');
      return;
    }
    const answerText = dryRunLearnerAnswer.trim();
    const inputValues = buildDryRunInputValues(selectedDryRunAgent, selectedDryRunQuestion, answerText);
    setDryRunResolvedInputValues(inputValues);
    setDryRunResolvedSystemPrompt('');
    setDryRunResolvedUserText('');
    setDryRunOutput('');
    setDryRunAiScoreResult(null);
    setDryRunStructuredFeedbackText('');
    setDryRunError(null);
    setIsDryRunRunning(true);
    try {
      // Ensure the selected agent is attached to the selected question before dry run.
      await axios.post(`/api/questions/${selectedDryRunQuestion.question_id}/attached-agents`, {
        agent_id: selectedDryRunAgent.agent_id,
        updated_by: actorUserId,
      });
    } catch (attachErr) {
      if (axios.isAxiosError(attachErr)) {
        const status = attachErr.response?.status;
        const detail = (attachErr.response?.data as any)?.detail;
        const detailText =
          detail === undefined
            ? ''
            : typeof detail === 'object' && detail !== null
              ? JSON.stringify(detail)
              : String(detail);
        const alreadyAttached =
          status === 409 ||
          (status === 422 && /already/i.test(detailText)) ||
          /already/i.test(detailText);
        if (!alreadyAttached) {
          setDryRunError(
            detail !== undefined
              ? typeof detail === 'object' && detail !== null
                ? JSON.stringify(detail, null, 2)
                : String(detail)
              : 'Failed to attach agent to question before dry run.'
          );
          setIsDryRunRunning(false);
          return;
        }
      } else {
        setDryRunError('Failed to attach agent to question before dry run.');
        setIsDryRunRunning(false);
        return;
      }
    }

    try {
      const res = await axios.post(
        `/api/questions/${selectedDryRunQuestion.question_id}/attached-agents/${selectedDryRunAgent.agent_id}/dry-run`,
        { dryRun: true, inputValues }
      );
      const response = res.data ?? {};
      const resolvedFromBackend =
        response?.resolved_input_values ?? response?.resolvedInputValues ?? response?.resolved_inputs ?? null;
      const effectiveResolvedInputs =
        resolvedFromBackend && typeof resolvedFromBackend === 'object' && !Array.isArray(resolvedFromBackend)
          ? (resolvedFromBackend as Record<string, unknown>)
          : inputValues;
      setDryRunResolvedInputValues(effectiveResolvedInputs);
      const renderedPrompt =
        response?.rendered_prompt && typeof response.rendered_prompt === 'object'
          ? response.rendered_prompt
          : null;
      setDryRunResolvedSystemPrompt(
        readFirstString(
          renderedPrompt?.system_prompt,
          response?.resolved_system_prompt,
          response?.resolvedSystemPrompt
        )
      );
      setDryRunResolvedUserText(
        readFirstString(
          renderedPrompt?.user_text,
          response?.resolved_user_text,
          response?.resolvedUserText
        )
      );
      const aiScoreResult =
        response?.ai_score_result && typeof response.ai_score_result === 'object'
          ? (response.ai_score_result as Record<string, unknown>)
          : null;
      setDryRunAiScoreResult(aiScoreResult);
      const structuredFeedbackText = readFirstString(response?.structured_feedback_text);
      setDryRunStructuredFeedbackText(structuredFeedbackText);
      const output = readFirstString(
        response?.static_feedback_text,
        response?.structured_feedback_text,
        response?.output,
        response?.result,
        response?.feedback,
        response?.text,
        response?.static_feedback_text
      );
      setDryRunOutput(output || JSON.stringify(response, null, 2));
    } catch (err) {
      console.error('Error running agent dry run:', err);
      if (axios.isAxiosError(err)) {
        const detail = (err.response?.data as any)?.detail;
        if (detail !== undefined) {
          setDryRunError(
            typeof detail === 'object' && detail !== null ? JSON.stringify(detail, null, 2) : String(detail)
          );
        } else {
          setDryRunError('Dry run failed.');
        }
      } else {
        setDryRunError('Dry run failed.');
      }
    } finally {
      setIsDryRunRunning(false);
    }
  };

  const validateAndBuildPayload = () => {
    const title = form.title.trim();
    if (!title) return { errorMessage: 'Title is required.' };
    if (!actorUserId) return { errorMessage: 'Unable to identify current user from session.' };

    if (promptVariables.invalidKeys.length > 0) {
      return {
        errorMessage: `Invalid prompt variable(s): ${promptVariables.invalidKeys.join(', ')}. Allowed keys: ${availableInputKeys.join(', ')}`,
      };
    }

    const hasRetrievedSlidePagesVariable = promptVariables.validKeys.includes('retrieved_slide_pages');
    const hasRetrievedSlidePagesRuleConfig = hasMeaningfulRetrievalRuleConfig(form.retrieved_slide_pages_rule);
    if (hasRetrievedSlidePagesRuleConfig && !hasRetrievedSlidePagesVariable) {
      return { errorMessage: 'retrieved_slide_pages rule is configured, but {{{retrieved_slide_pages}}} is missing in feedback_generation_block.' };
    }

    const derivedInputs = promptVariables.validKeys.map((key) => ({
      input_key: key,
      retrieval_rule:
        key === 'retrieved_slide_pages'
          ? getEffectiveRetrievedSlidePagesRule(form.retrieved_slide_pages_rule)
          : undefined,
    }));

    const retrievedSlidePages = derivedInputs.find((row) => row.input_key === 'retrieved_slide_pages');
    if (
      retrievedSlidePages?.retrieval_rule?.max_pages !== undefined &&
      retrievedSlidePages.retrieval_rule.max_pages !== null &&
      retrievedSlidePages.retrieval_rule.max_pages <= 0
    ) {
      return { errorMessage: 'retrieved_slide_pages.max_pages must be > 0' };
    }
    if (
      retrievedSlidePages?.retrieval_rule?.max_pages !== undefined &&
      retrievedSlidePages.retrieval_rule.max_pages !== null &&
      !Number.isInteger(retrievedSlidePages.retrieval_rule.max_pages)
    ) {
      return { errorMessage: 'retrieved_slide_pages.max_pages must be an integer >= 1' };
    }
    if (retrievedSlidePages && !retrievedSlidePages.retrieval_rule?.selection_mode) {
      return { errorMessage: 'retrieved_slide_pages.selection_mode is required.' };
    }
    if (
      retrievedSlidePages?.retrieval_rule?.similarity_threshold !== undefined &&
      retrievedSlidePages.retrieval_rule.similarity_threshold !== null &&
      (retrievedSlidePages.retrieval_rule.similarity_threshold < 0 ||
        retrievedSlidePages.retrieval_rule.similarity_threshold > 1)
    ) {
      return { errorMessage: 'retrieved_slide_pages.similarity_threshold must be between 0 and 1.' };
    }

    const normalizedScoreAiAgentId =
      typeof form.score_ai_agent_id === 'string' ? form.score_ai_agent_id.trim() : '';

    if (form.role === 'human') {
      const humanIfScore = Boolean(form.if_score);
      const humanScoreAiAgentId = normalizedScoreAiAgentId;
      if (humanIfScore && !humanScoreAiAgentId) {
        return { errorMessage: 'score_ai_agent_id is required when if_score=true' };
      }
      if (!humanIfScore && humanScoreAiAgentId) {
        return { errorMessage: 'score_ai_agent_id must be null when if_score=false' };
      }
      if (humanIfScore) {
        const selectedScoreAgent = agents.find((agent) => agent.agent_id === humanScoreAiAgentId);
        if (!selectedScoreAgent || String(selectedScoreAgent.role ?? '').toLowerCase() !== 'ai') {
          return { errorMessage: 'score_ai_agent_id must reference an ai agent' };
        }
      }
      const payload = {
        name: title,
        title,
        role: 'human',
        apply_question_type: form.apply_question_type || 'all',
        if_score: humanIfScore,
        score_ai_agent_id: humanIfScore ? humanScoreAiAgentId : null,
        prompt_text: '',
        is_structured: false,
        provider: null,
        model: null,
        access_scope: 'private' as AgentScope,
        is_visible: true,
        created_by: actorUserId,
        updated_by: actorUserId,
        inputs: [],
      };
      return { payload };
    }

    if (!form.provider.trim()) {
      return { errorMessage: 'Provider is required for AI agent.' };
    }
    if (!form.model.trim()) {
      return { errorMessage: 'Model is required for AI agent.' };
    }
    if (form.if_score) {
      return { errorMessage: 'if_score is only supported for human agents' };
    }
    if (normalizedScoreAiAgentId) {
      return { errorMessage: 'score_ai_agent_id is only supported for human agents' };
    }

    let parsedLlmParams: Record<string, unknown> | null = null;
    if (form.llm_params_json.trim()) {
      try {
        const parsed = JSON.parse(form.llm_params_json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { errorMessage: 'Advanced LLM params must be a JSON object (JSONB-compatible, not array/string/null).' };
        }
        parsedLlmParams = parsed as Record<string, unknown>;
      } catch {
        return { errorMessage: 'Advanced LLM params must be valid JSON (JSONB-compatible object).' };
      }
    }

    const feedbackGenerationBlock = form.feedback_generation_block.trim();
    const additionalFormattingInstructionsBlock = form.is_structured
      ? form.additional_formatting_instructions_block.trim()
      : '';
    const llmParams: Record<string, unknown> = { ...(parsedLlmParams ?? {}) };
    if (feedbackGenerationBlock) {
      llmParams.feedback_generation_block = feedbackGenerationBlock;
    }
    if (additionalFormattingInstructionsBlock) {
      llmParams.additional_formatting_instructions_block = additionalFormattingInstructionsBlock;
    }
    if (!feedbackGenerationBlock) {
      delete llmParams.feedback_generation_block;
    }
    if (!additionalFormattingInstructionsBlock) {
      delete llmParams.additional_formatting_instructions_block;
    }

    const payload = {
      name: title,
      title,
      role: 'ai',
      apply_question_type: form.apply_question_type || 'all',
      prompt_text: form.feedback_generation_block.trim() || null,
      is_structured: Boolean(form.is_structured),
      provider: form.provider.trim(),
      model: form.model.trim(),
      access_scope: 'private' as AgentScope,
      is_visible: true,
      created_by: actorUserId,
      updated_by: actorUserId,
      inputs: derivedInputs,
      ...(Object.keys(llmParams).length > 0 ? { llm_params: llmParams } : {}),
    };
    return { payload };
  };

  const handleSubmitAgent = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const { payload, errorMessage } = validateAndBuildPayload();
    if (errorMessage || !payload) {
      setError(errorMessage ?? 'Invalid form.');
      return;
    }

    setSubmitting(true);
    try {
      await axios.post('/api/feedback-agents', payload);
      setMessage(panelMode === 'duplicate' ? 'Agent duplicated successfully.' : 'Agent created successfully.');
      setIsPanelOpen(false);
      setEditingSourceAgentId(null);
      setForm(defaultFormState());
      await fetchAgents();
    } catch (err) {
      console.error('Error saving feedback agent:', err);
      if (axios.isAxiosError(err)) {
        const responseData = err.response?.data as any;
        const detail = responseData?.detail;
        if (err.response?.status === 422 && detail?.code === 'INVALID_PROMPT_TEMPLATE_KEYS') {
          const invalidKeys = Array.isArray(detail?.invalid_keys) ? detail.invalid_keys.join(', ') : '';
          const allowedKeys = Array.isArray(detail?.allowed_keys) ? detail.allowed_keys.join(', ') : '';
          setError(
            ['Prompt template contains unsupported keys.', invalidKeys && `Invalid: ${invalidKeys}.`, allowedKeys && `Allowed: ${allowedKeys}.`]
              .filter(Boolean)
              .join(' ')
          );
          return;
        }
        if (err.response?.status === 422 && detail !== undefined) {
          if (typeof detail === 'object' && detail !== null) {
            setError(`422 Validation Error\n${JSON.stringify(detail, null, 2)}`);
            return;
          }
          setError(`422 Validation Error\n${String(detail)}`);
          return;
        }
        if (typeof detail === 'string') {
          setError(detail);
          return;
        }
        if (typeof responseData?.message === 'string') {
          setError(responseData.message);
          return;
        }
      }
      setError(panelMode === 'duplicate' ? 'Failed to duplicate agent.' : 'Failed to create agent.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleScope = async (agent: FeedbackAgent) => {
    if (!actorUserId) {
      setError('Unable to identify current user from session.');
      return;
    }
    const nextScope: AgentScope = agent.access_scope === 'public' ? 'private' : 'public';
    setActingAgentId(agent.agent_id);
    setError(null);
    setMessage(null);
    try {
      await axios.patch(`/api/feedback-agents/${agent.agent_id}/scope`, {
        access_scope: nextScope,
        updated_by: actorUserId,
      });
      setMessage(`Agent scope updated to ${nextScope}.`);
      await fetchAgents();
    } catch (err) {
      console.error('Error updating agent scope:', err);
      setError('Failed to update agent scope.');
    } finally {
      setActingAgentId(null);
    }
  };

  const handleDeleteAgent = async (agent: FeedbackAgent) => {
    if (!actorUserId) {
      setError('Unable to identify current user from session.');
      return;
    }
    const confirmed = window.confirm(
      `Delete agent "${agent.title || agent.agent_id}"? This is a soft delete and cannot be undone in UI.`
    );
    if (!confirmed) return;
    setActingAgentId(agent.agent_id);
    setError(null);
    setMessage(null);
    try {
      await axios.delete(`/api/feedback-agents/${agent.agent_id}`, {
        params: {
          updated_by: actorUserId,
        },
      });
      setMessage('Agent deleted.');
      await fetchAgents();
    } catch (err) {
      console.error('Error deleting agent:', err);
      if (axios.isAxiosError(err)) {
        const responseData = err.response?.data as any;
        const detail = responseData?.detail;
        if (err.response?.status === 422 && detail !== undefined) {
          if (typeof detail === 'object' && detail !== null) {
            setError(`422 Validation Error\n${JSON.stringify(detail, null, 2)}`);
            return;
          }
          setError(`422 Validation Error\n${String(detail)}`);
          return;
        }
        if (typeof detail === 'string') {
          setError(detail);
          return;
        }
      }
      setError('Failed to delete agent.');
    } finally {
      setActingAgentId(null);
    }
  };

  const columns: ManageTableColumn<FeedbackAgent>[] = [
    {
      id: 'title',
      headerClassName: 'px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Title',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (agent) => (
        <div className="min-w-[220px]">
          <div className="font-medium text-slate-900">{agent.title || '(Untitled agent)'}</div>
          <div className="mt-1 text-xs text-slate-500">
            {agent.role === 'human'
              ? 'human'
              : [agent.provider, agent.model].filter(Boolean).join(' / ') || 'ai'}
          </div>
        </div>
      ),
    },
    {
      id: 'scope',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Scope',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-600',
      renderCell: (agent) => agent.access_scope || '-',
    },
    {
      id: 'created_by',
      headerClassName: 'px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Created By',
      cellClassName: 'px-4 py-3 align-middle text-slate-600',
      renderCell: (agent) => {
        const isCurrentUser =
          Boolean(agent.created_by) &&
          (agent.created_by === sessionUserId || agent.created_by === sessionUserEmail);
        const displayName = agent.created_by_name || (isCurrentUser ? sessionUserName || '' : '');
        const displaySecondary =
          agent.created_by_email ||
          (isCurrentUser ? sessionUserEmail || '' : '') ||
          agent.created_by ||
          '';
        const fallbackDisplay =
          agent.created_by_display || (isCurrentUser ? createdByDisplay : agent.created_by || '-');

        if (!displayName) {
          return (
            <span className={fallbackDisplay !== '-' ? 'text-xs break-all text-slate-700' : 'font-mono text-xs break-all'}>
              {fallbackDisplay}
            </span>
          );
        }

        return (
          <div className="leading-tight">
            <div className="break-all text-sm font-medium text-slate-800">{displayName}</div>
            <div className="mt-1 break-all text-xs text-slate-600">{displaySecondary || '-'}</div>
          </div>
        );
      },
    },
    {
      id: 'created_at',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Created At',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-600',
      renderCell: (agent) => formatDateTime(agent.created_at),
    },
    {
      id: 'actions',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700',
      header: 'Actions',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle',
      renderCell: (agent) => {
        const isActing = actingAgentId === agent.agent_id;
        return (
          <div className="flex justify-end gap-2">
            <ActionButton
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-lg"
              onClick={() => openDuplicatePanel(agent)}
              disabled={isActing}
            >
              Duplicate
            </ActionButton>
            <ActionButton
              type="button"
              variant="neutral"
              size="sm"
              className="rounded-lg"
              onClick={() => handleToggleScope(agent)}
              disabled={isActing}
              title={`Current scope: ${agent.access_scope || 'unknown'}`}
            >
              {agent.access_scope === 'public' ? 'Set Private' : 'Set Public'}
            </ActionButton>
            <ActionButton
              type="button"
              variant="danger"
              size="sm"
              className="rounded-lg"
              onClick={() => handleDeleteAgent(agent)}
              disabled={isActing}
            >
              Delete
            </ActionButton>
          </div>
        );
      },
    },
  ];

  const sortedCompositions = [...compositions].sort((a, b) =>
    String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))
  );

  const compositionColumns: ManageTableColumn<FeedbackComposition>[] = [
    {
      id: 'composition',
      header: 'Composition',
      headerClassName: 'px-4 py-3 text-left font-semibold text-slate-700',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (composition) => (
        <div className="min-w-[220px]">
          <div className="font-medium text-slate-900">{composition.title || composition.composition_id}</div>
          <div className="mt-1 font-mono text-xs text-slate-500">{composition.composition_id}</div>
        </div>
      ),
    },
    {
      id: 'rules',
      header: 'Rules',
      headerClassName: 'px-4 py-3 text-left font-semibold text-slate-700',
      cellClassName: 'px-4 py-3 align-middle text-slate-600',
      renderCell: (composition) => `${composition.rules.length} rule${composition.rules.length === 1 ? '' : 's'}`,
    },
    {
      id: 'updated_at',
      header: 'Updated At',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-600',
      renderCell: (composition) => formatDateTime(composition.updated_at),
    },
    {
      id: 'actions',
      header: 'Actions',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle',
      renderCell: (composition) => (
        <div className="flex justify-end gap-2">
          <ActionButton
            type="button"
            variant="primary"
            size="sm"
            className="rounded-lg"
            onClick={() => handlePublishComposition(composition)}
            disabled={isSubmittingComposition}
          >
            Publish
          </ActionButton>
          <ActionButton
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-lg"
            onClick={() => openEditCompositionPanel(composition)}
            disabled={isSubmittingComposition}
          >
            Edit
          </ActionButton>
          <ActionButton
            type="button"
            variant="danger"
            size="sm"
            className="rounded-lg"
            onClick={() => handleDeleteComposition(composition)}
            disabled={isSubmittingComposition}
          >
            Delete
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <div className="flex flex-col gap-4 md:items-start">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Agent Management
              </p>
              <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
                Feedback Agents
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                Create, duplicate, inspect inputs, and manage scope/visibility for feedback agents.
              </p>
            </div>
          </div>
        </section>

        <ManageListPanel
          toolbarLeft={(
            <div className="flex items-center gap-2">
              <ActionButton onClick={openCreatePanel} variant="primary" className="rounded-lg px-3.5 py-2">
                Create Agent
              </ActionButton>
            </div>
          )}
          toolbarRight={(
            <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
              <div className="relative w-full md:w-[34rem]">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-300"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  ⌕
                </span>
              </div>
              <ActionButton
                onClick={fetchAgents}
                variant="neutral"
                size="sm"
                className="rounded-xl md:shrink-0"
                disabled={isFetchingAgents}
              >
                {isFetchingAgents ? 'Refreshing...' : 'Refresh'}
              </ActionButton>
            </div>
          )}
          table={(
            <div className="space-y-3">
              {(message || error) && (
                <div
                  className={`whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm ${
                    error
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {error ?? message}
                </div>
              )}
              <ManageDataTable
                rows={filteredAgents}
                rowKey={(agent) => agent.agent_id}
                columns={columns}
                rowClassName="transition-colors hover:bg-slate-50/70"
                emptyContent={isFetchingAgents ? 'Loading agents...' : 'No agents found.'}
                expandableRows={{
                  getRowId: (agent) => agent.agent_id,
                  isRowExpandable: (agent) =>
                    agent.role !== 'human' &&
                    Boolean(agent.prompt_text?.trim() || agent.is_structured || agent.llm_params || (agent.inputs?.length ?? 0) > 0),
                  toggleAriaLabel: (agent, _index, isExpanded) =>
                    `${isExpanded ? 'Collapse' : 'Expand'} details for ${agent.title || agent.agent_id}`,
                  renderExpandedContent: (agent) => {
                    const normalizedInputs = (agent.inputs ?? [])
                      .map(normalizeAgentInput)
                      .filter(Boolean) as AgentFormInputRow[];
                    const retrievedSlidePagesInput = normalizedInputs.find(
                      (input) => input.input_key === 'retrieved_slide_pages'
                    );
                    const llmParams = agent.llm_params && typeof agent.llm_params === 'object' ? agent.llm_params : null;
                    const feedbackGenerationBlock =
                      (typeof llmParams?.feedback_generation_block === 'string'
                        ? llmParams.feedback_generation_block
                        : '') ||
                      agent.prompt_text?.trim() ||
                      '';
                    const promptTokens = extractPromptVariables(feedbackGenerationBlock, allowedPromptKeySet);
                    const promptHtml = feedbackGenerationBlock
                      ? buildPromptHighlightHtml(feedbackGenerationBlock, allowedPromptKeySet)
                      : '';

                    return (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Structured
                            </div>
                            <div className="mt-1 text-slate-700">{agent.is_structured ? 'Yes' : 'No'}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Provider
                            </div>
                            <div className="mt-1 text-slate-700">{agent.provider || '-'}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Model
                            </div>
                            <div className="mt-1 text-slate-700">{agent.model || '-'}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Apply Question Type
                            </div>
                            <div className="mt-1 text-slate-700">{agent.apply_question_type || 'all'}</div>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Prompt Template (Task 1)
                          </div>
                          {feedbackGenerationBlock ? (
                            <div className="mt-1 rounded-lg border border-slate-200 bg-white p-3">
                              <div
                                className="whitespace-pre-wrap break-words font-mono text-sm text-slate-700"
                                dangerouslySetInnerHTML={{ __html: promptHtml }}
                              />
                            </div>
                          ) : (
                            <div className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-400">
                              (empty)
                            </div>
                          )}
                          {(promptTokens.validKeys.length > 0 || promptTokens.invalidKeys.length > 0) && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {promptTokens.validKeys.map((key) => (
                                <span
                                  key={`agent-${agent.agent_id}-valid-${key}`}
                                  className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                                >
                                  {key}
                                </span>
                              ))}
                              {promptTokens.invalidKeys.map((key) => (
                                <span
                                  key={`agent-${agent.agent_id}-invalid-${key}`}
                                  className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                                >
                                  invalid: {key}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              retrieved_slide_pages Rule
                            </div>
                            <div className="mt-1 rounded-lg border border-slate-200 bg-white p-3">
                              {retrievedSlidePagesInput?.retrieval_rule ? (
                                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                                  {JSON.stringify(retrievedSlidePagesInput.retrieval_rule, null, 2)}
                                </pre>
                              ) : (
                                <div className="text-sm text-slate-400">(none)</div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            LLM Params
                          </div>
                          <div className="mt-1 rounded-lg border border-slate-200 bg-white p-3">
                            {agent.llm_params ? (
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                                {JSON.stringify(agent.llm_params, null, 2)}
                              </pre>
                            ) : (
                              <div className="text-sm text-slate-400">(none)</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  },
                }}
              />
            </div>
          )}
          summary={(
            <p className="text-center text-sm text-slate-500">
              Showing {filteredAgents.length} agent{filteredAgents.length === 1 ? '' : 's'}
              {queryUserId ? ' (mine + public)' : ' (public only)'}
            </p>
          )}
        />

        <ManageListPanel
          toolbarLeft={(
            <div className="flex items-center gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Agent Dry Run</p>
                <p className="text-xs text-slate-500">
                  Select a feedback agent and question (own private + public), then run a dry run in this page.
                </p>
              </div>
            </div>
          )}
          toolbarRight={(
            <ActionButton
              type="button"
              variant="neutral"
              size="sm"
              className="rounded-xl"
              onClick={fetchDryRunQuestions}
              disabled={isFetchingDryRunQuestions}
            >
              {isFetchingDryRunQuestions ? 'Loading Questions...' : 'Refresh Questions'}
            </ActionButton>
          )}
          table={(
            <div className="space-y-4">
              {dryRunQuestionError && (
                <div className="whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {dryRunQuestionError}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Feedback Agent</label>
                  <select
                    value={selectedDryRunAgentId}
                    onChange={(e) => setSelectedDryRunAgentId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  >
                    <option value="">Select an agent</option>
                    {dryRunAgents.map((agent) => (
                      <option key={`dry-run-agent-${agent.agent_id}`} value={agent.agent_id}>
                        {`${agent.title || agent.agent_id} (${String(agent.role ?? 'unknown')})`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Question</label>
                  <select
                    value={selectedDryRunQuestionId}
                    onChange={(e) => setSelectedDryRunQuestionId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  >
                    <option value="">Select a question</option>
                    {visibleDryRunQuestions.map((question) => (
                      <option key={`dry-run-question-${question.question_id}`} value={question.question_id}>
                        {getDryRunQuestionLabel(question)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Selected Question Preview
                </div>
                {selectedDryRunQuestion ? (
                  <div className="mt-2 space-y-3 text-sm text-slate-700">
                    <div>
                      <div className="text-xs font-semibold text-slate-600">Question Text</div>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-2 py-1">
                        {selectedDryRunQuestion.content
                          .filter((item) => item.type === 'text' && item.content.trim())
                          .map((item) => item.content.trim())
                          .join('\n\n') || '(empty)'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-600">Options Preview</div>
                      {selectedDryRunQuestion.options.length > 0 ? (
                        <ul className="mt-1 space-y-1">
                          {selectedDryRunQuestion.options.map((option, idx) => (
                            <li
                              key={`dry-run-option-preview-${selectedDryRunQuestion.question_id}-${idx}`}
                              className="rounded border border-slate-200 bg-slate-50 px-2 py-1"
                            >
                              <span className="mr-2 text-slate-500">{`${idx + 1}.`}</span>
                              <span>{option.text || '(empty option)'}</span>
                              {option.isCorrect ? (
                                <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                  Correct
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-1 text-slate-500">(no options)</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-500">(no question selected)</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Learner Answer (answer_text)
                </label>
                <textarea
                  rows={4}
                  value={dryRunLearnerAnswer}
                  onChange={(e) => setDryRunLearnerAnswer(e.target.value)}
                  placeholder="Type a sample learner answer for dry run"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300"
                />
                {dryRunAutoSampleAnswer ? (
                  <button
                    type="button"
                    className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => setDryRunLearnerAnswer(dryRunAutoSampleAnswer)}
                  >
                    Fill sample answer from correct option
                  </button>
                ) : null}
              </div>

              <div className="flex items-center justify-end">
                <ActionButton
                  type="button"
                  variant="primary"
                  className="rounded-lg"
                  onClick={runAgentDryRun}
                  disabled={isDryRunRunning || !selectedDryRunAgentId || !selectedDryRunQuestionId}
                >
                  {isDryRunRunning ? 'Running...' : 'Run Dry Run'}
                </ActionButton>
              </div>

              {dryRunError && (
                <div className="whitespace-pre-wrap rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {dryRunError}
                </div>
              )}

              {dryRunAiScoreResult && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI Score Result</div>
                  {Boolean(dryRunAiScoreResult.enabled) ? (
                    Boolean(dryRunAiScoreResult.has_score) ? (
                      <div className="mt-2 text-sm text-slate-700">
                        <span className="font-semibold">Score:</span>{' '}
                        {String(dryRunAiScoreResult.score ?? '-')} / {String(dryRunAiScoreResult.max_score ?? '-')}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-amber-700">
                        AI score unavailable{dryRunAiScoreResult.reason ? `: ${String(dryRunAiScoreResult.reason)}` : ''}
                      </div>
                    )
                  ) : (
                    <div className="mt-2 text-sm text-slate-500">AI scoring not enabled.</div>
                  )}
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-slate-600">Structured Feedback</div>
                    <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                      {dryRunStructuredFeedbackText || '(not returned)'}
                    </pre>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolved Input Values</div>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                    {JSON.stringify(dryRunResolvedInputValues ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rendered Prompt (Backend)</div>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                    {(dryRunResolvedSystemPrompt || dryRunResolvedUserText)
                      ? [dryRunResolvedSystemPrompt, dryRunResolvedUserText].filter(Boolean).join('\n\n')
                      : '(not returned by backend)'}
                  </pre>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dry Run Output</div>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                  {dryRunOutput || '(no output yet)'}
                </pre>
              </div>
            </div>
          )}
          summary={(
            <p className="text-center text-sm text-slate-500">
              {isFetchingDryRunQuestions
                ? 'Loading question list...'
                : `Questions available for dry run: ${visibleDryRunQuestions.length}`}
            </p>
          )}
        />

        <ManageListPanel
          toolbarLeft={(
            <div className="flex items-center gap-2">
              <ActionButton
                onClick={openCreateCompositionPanel}
                variant="primary"
                className="rounded-lg px-3.5 py-2"
                disabled={isFetchingCompositions || isSubmittingComposition}
              >
                Create Composition
              </ActionButton>
            </div>
          )}
          table={(
            <div className="space-y-3">
              {compositionError && (
                <div className="whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {compositionError}
                </div>
              )}
              <ManageDataTable
                rows={sortedCompositions}
                rowKey={(composition) => composition.composition_id}
                columns={compositionColumns}
                rowClassName="transition-colors hover:bg-slate-50/70"
                emptyContent={isFetchingCompositions ? 'Loading compositions...' : 'No compositions yet.'}
                expandableRows={{
                  getRowId: (composition) => composition.composition_id,
                  isRowExpandable: (composition) => composition.rules.length > 0 || Boolean(composition.description),
                  toggleAriaLabel: (composition, _index, isExpanded) =>
                    `${isExpanded ? 'Collapse' : 'Expand'} rules for ${composition.composition_id}`,
                  renderExpandedContent: (composition) => (
                    <div className="space-y-3">
                      {composition.description ? (
                        <p className="text-sm text-slate-700">{composition.description}</p>
                      ) : (
                        <p className="text-sm text-slate-400">(no description)</p>
                      )}
                      <div className="space-y-2">
                        {composition.rules.map((rule, index) => (
                          <div key={rule.rule_id} className="rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rule {index + 1}</p>
                            <p className="mt-1 font-mono text-xs text-slate-700">{rule.condition_expression}</p>
                            <p className="mt-1 text-xs text-slate-600">
                              {compositionFeedbackModeLabel(rule.feedback_mode)} | Agent: {rule.feedback_agent_id || '-'} | Slide:{' '}
                              {compositionSlideModeLabel(rule.slide_mode)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                }}
              />
            </div>
          )}
          summary={(
            <p className="text-center text-sm text-slate-500">
              {isFetchingCompositions
                ? 'Loading compositions...'
                : `Showing ${sortedCompositions.length} composition${sortedCompositions.length === 1 ? '' : 's'}`}
            </p>
          )}
        />

        {isPanelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">
                    {panelMode === 'duplicate' ? 'Duplicate Agent' : 'Create Agent'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {panelMode === 'duplicate'
                      ? `Seeded from ${editingSourceAgentId ?? 'selected agent'}.`
                      : 'Support AI agent setup and human feedback version management.'}
                  </p>
                </div>
                <ActionButton
                  type="button"
                  variant="ghost"
                  className="rounded-lg"
                  onClick={() => setIsPanelOpen(false)}
                  disabled={submitting}
                >
                  Close
                </ActionButton>
              </div>

              <form onSubmit={handleSubmitAgent} className="min-h-0 space-y-5 overflow-y-auto pr-1">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Agent Name</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setFormField('title', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    required
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-1">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
                    <select
                      value={form.role}
                      onChange={(e) => setRole(e.target.value === 'ai' ? 'ai' : 'human')}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    >
                      <option value="human">human</option>
                      <option value="ai">AI</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Apply Question Type</label>
                    <select
                      value={form.apply_question_type}
                      onChange={(e) => setFormField('apply_question_type', (e.target.value as ApplyQuestionType) || 'all')}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    >
                      <option value="all">All Question Types</option>
                      <option value="single_choice">Single Choice</option>
                      <option value="multi_choice">Multiple Choice</option>
                      <option value="dropdown">Dropdown</option>
                      <option value="true_false">True / False</option>
                      <option value="free_text">Free Text</option>
                      <option value="essay">Essay</option>
                    </select>
                  </div>
                  {form.role === 'human' && (
                    <div className="rounded-xl border border-slate-200 p-3">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.if_score}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              if_score: e.target.checked,
                              score_ai_agent_id: e.target.checked ? (prev.score_ai_agent_id ?? '') : '',
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        Enable AI Score
                      </label>
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium text-slate-700">AI Scoring Agent</label>
                        <select
                          value={form.score_ai_agent_id ?? ''}
                          onChange={(e) => setFormField('score_ai_agent_id', e.target.value)}
                          disabled={!form.if_score}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none disabled:bg-slate-50 disabled:text-slate-500 focus:border-slate-300"
                        >
                          <option value="">{form.if_score ? 'Select an AI scoring agent' : 'Enable AI Score first'}</option>
                          {aiAgents.map((agent) => (
                            <option key={`score-ai-agent-${agent.agent_id}`} value={agent.agent_id}>
                              {agent.title || agent.agent_id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {form.role === 'ai' && (
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Provider</label>
                      <select
                        value={form.provider}
                        onChange={(e) => setFormField('provider', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                      >
                        <option value="">Select provider</option>
                        <option value="openai">OpenAI</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Model</label>
                      <input
                        type="text"
                        list="agent-model-suggestions"
                        value={form.model}
                        onChange={(e) => setFormField('model', e.target.value)}
                        placeholder="e.g. gpt-4.1-mini"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                      />
                      <datalist id="agent-model-suggestions">
                        <option value="gpt-4.1-mini" />
                        <option value="gpt-4.1" />
                        <option value="gpt-4o-mini" />
                        <option value="gpt-4o" />
                        <option value="o4-mini" />
                      </datalist>
                    </div>
                    <div className="flex items-end">
                      <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.is_structured}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setForm((prev) => ({
                              ...prev,
                              is_structured: checked,
                              additional_formatting_instructions_block: checked
                                ? prev.additional_formatting_instructions_block
                                : '',
                            }));
                          }}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        Structured Output
                      </label>
                    </div>
                  </div>
                )}

                {form.role === 'ai' && (
                  <div className="grid gap-4 md:grid-cols-1">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <label className="block text-sm font-medium text-slate-700">Prompt Template (Task 1)</label>
                      <p className="mt-1 text-xs text-slate-500">
                        Write the main prompt used to generate feedback.
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Insert variables as <code>{'{{{key}}}'}</code>. Only predefined keys are allowed.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {availableInputKeys.map((key) => (
                          <ActionButton
                            key={key}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-lg"
                            onClick={() => insertPromptVariable(key)}
                            disabled={form.role === 'human'}
                          >
                            + {key}
                          </ActionButton>
                        ))}
                      </div>
                      <div className="relative mt-2 rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div
                          ref={feedbackBlockHighlightRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm leading-6 text-slate-800"
                          dangerouslySetInnerHTML={{ __html: feedbackBlockHighlightHtml }}
                        />
                        <textarea
                          ref={feedbackBlockTextareaRef}
                          rows={6}
                          value={form.feedback_generation_block}
                          onChange={(e) => setFormField('feedback_generation_block', e.target.value)}
                          onScroll={(e) => {
                            if (feedbackBlockHighlightRef.current) {
                              feedbackBlockHighlightRef.current.scrollTop = e.currentTarget.scrollTop;
                              feedbackBlockHighlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
                            }
                          }}
                          spellCheck={false}
                          placeholder={
                            promptBlocksMeta.feedback_generation_block?.placeholder ||
                            'Your Task 1 rules...'
                          }
                          className="relative w-full resize-y rounded-xl bg-transparent px-3 py-2 font-mono text-sm leading-6 text-transparent caret-slate-900 outline-none"
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {promptVariables.validKeys.map((key) => (
                          <span
                            key={`feedback-block-valid-${key}`}
                            className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                          >
                            {key}
                          </span>
                        ))}
                        {promptVariables.invalidKeys.map((key) => (
                          <span
                            key={`feedback-block-invalid-${key}`}
                            className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                          >
                            invalid: {key}
                          </span>
                        ))}
                        {promptVariables.validKeys.length === 0 && promptVariables.invalidKeys.length === 0 && (
                          <span className="text-xs text-slate-500">No variables detected.</span>
                        )}
                      </div>
                      {(isFetchingInputOptions || inputOptionsError) && (
                        <p className={`mt-2 text-xs ${inputOptionsError ? 'text-amber-700' : 'text-slate-500'}`}>
                          {inputOptionsError ?? 'Loading input option whitelist...'}
                        </p>
                      )}
                    </div>

                    {form.is_structured && (
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <label className="block text-sm font-medium text-slate-700">Additional Formatting Rules (Task 2)</label>
                        <p className="mt-1 text-xs text-slate-500">
                          Optional extra rules for how the final feedback should be formatted.
                        </p>
                        <textarea
                          rows={6}
                          value={form.additional_formatting_instructions_block}
                          onChange={(e) => setFormField('additional_formatting_instructions_block', e.target.value)}
                          spellCheck={false}
                          placeholder={
                            promptBlocksMeta.additional_formatting_instructions_block?.placeholder ||
                            'Your additional formatting rules...'
                          }
                          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                        />
                      </div>
                    )}

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <label className="block text-sm font-medium text-slate-700">
                        Prompt Assembly Preview (Server)
                      </label>
                      <p className="mt-1 text-xs text-slate-500">
                        Read-only preview of how the backend assembles Task 1 and Task 2 into the final prompt.
                      </p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
{promptAssemblyPreview}
                      </pre>
                    </div>
                  </div>
                )}

                {form.role === 'ai' && (
                  <div className="rounded-2xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setIsAdvancedLlmOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Advanced Config</div>
                        <div className="text-xs text-slate-500">
                          Retrieved-slide defaults (read-only) and optional LLM params.
                        </div>
                      </div>
                      <span className="text-slate-500" aria-hidden="true">
                        {isAdvancedLlmOpen ? '▾' : '▸'}
                      </span>
                    </button>
                    {isAdvancedLlmOpen && (
                      <div className="space-y-4 border-t border-slate-200 px-4 py-3">
                        {promptVariables.validKeys.includes('retrieved_slide_pages') && (
                          <div>
                            <div className="mb-2">
                              <h3 className="text-sm font-semibold text-slate-900">retrieved_slide_pages rule</h3>
                              <p className="text-xs text-slate-500">
                                Temporarily read-only in UI. Current payload will use the backend-aligned defaults below.
                              </p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="grid gap-3 md:grid-cols-5">
                                <div>
                                  <div className="text-xs font-medium text-slate-600">preferred_info_type</div>
                                  <div className="mt-1 rounded bg-white px-2.5 py-2 text-xs text-slate-900">
                                    {effectiveRetrievedSlidePagesRule.preferred_info_type ?? 'vision'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-slate-600">selection_mode</div>
                                  <div className="mt-1 rounded bg-white px-2.5 py-2 text-xs text-slate-900">
                                    {effectiveRetrievedSlidePagesRule.selection_mode ?? 'top_k'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-slate-600">max_pages</div>
                                  <div className="mt-1 rounded bg-white px-2.5 py-2 text-xs text-slate-900">
                                    {String(effectiveRetrievedSlidePagesRule.max_pages ?? 3)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-slate-600">similarity_threshold</div>
                                  <div className="mt-1 rounded bg-white px-2.5 py-2 text-xs text-slate-900">
                                    {String(effectiveRetrievedSlidePagesRule.similarity_threshold ?? 0)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-slate-600">include_similarity</div>
                                  <div className="mt-1 rounded bg-white px-2.5 py-2 text-xs text-slate-900">
                                    {(effectiveRetrievedSlidePagesRule.include_similarity ?? true) ? 'true' : 'false'}
                                  </div>
                                </div>
                              </div>
                              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded bg-white p-3 text-xs text-slate-700">
{JSON.stringify(getEffectiveRetrievedSlidePagesRule(form.retrieved_slide_pages_rule), null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="mb-2">
                            <div className="text-sm font-semibold text-slate-900">Advanced LLM Params</div>
                            <div className="text-xs text-slate-500">
                              Optional extra JSON object. Fixed block keys above always take precedence.
                            </div>
                          </div>
                          <textarea
                            rows={6}
                            value={form.llm_params_json}
                            onChange={(e) => setFormField('llm_params_json', e.target.value)}
                            spellCheck={false}
                            placeholder={'{\n  "temperature": 0.2,\n  "max_tokens": 500\n}'}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                          />
                          <p className="mt-2 text-xs text-slate-500">
                            Optional. If provided, must be a valid JSON object.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <ActionButton
                    type="button"
                    variant="ghost"
                    className="rounded-lg"
                    onClick={() => setIsPanelOpen(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </ActionButton>
                  <ActionButton type="submit" variant="primary" className="rounded-lg" disabled={submitting}>
                    {submitting
                      ? panelMode === 'duplicate'
                        ? 'Duplicating...'
                        : 'Creating...'
                      : panelMode === 'duplicate'
                        ? 'Duplicate Agent'
                        : 'Create Agent'}
                  </ActionButton>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCompositionPanelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">
                    {compositionPanelMode === 'edit' ? 'Edit Composition' : 'Create Composition'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Build ordered IF rules to decide feedback agent strategy and slide display mode.
                  </p>
                </div>
                <ActionButton
                  type="button"
                  variant="ghost"
                  className="rounded-lg"
                  onClick={() => setIsCompositionPanelOpen(false)}
                  disabled={isSubmittingComposition}
                >
                  Close
                </ActionButton>
              </div>

              <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Composition ID</label>
                    <input
                      type="text"
                      value={compositionForm.composition_id}
                      onChange={(e) => setCompositionField('composition_id', e.target.value)}
                      disabled={compositionPanelMode === 'edit'}
                      placeholder="e.g. comp_mcq_v1"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none disabled:bg-slate-50 disabled:text-slate-500 focus:border-slate-300"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Use this ID in URL, e.g. <code>composition_id=comp_mcq_v1</code>.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Title</label>
                    <input
                      type="text"
                      value={compositionForm.title}
                      onChange={(e) => setCompositionField('title', e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                  <textarea
                    rows={2}
                    value={compositionForm.description}
                    onChange={(e) => setCompositionField('description', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  />
                </div>

                <div className="space-y-3">
                  {compositionForm.rules.map((rule, index) => (
                    <div key={rule.rule_id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">IF Rule {index + 1}</p>
                        <ActionButton
                          type="button"
                          variant="danger"
                          size="sm"
                          className="rounded-lg"
                          onClick={() => removeCompositionRuleById(rule.rule_id)}
                          disabled={compositionForm.rules.length <= 1}
                        >
                          Remove
                        </ActionButton>
                      </div>

                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Condition Expression
                      </label>
                      <textarea
                        rows={2}
                        value={rule.condition_expression}
                        onChange={(e) =>
                          updateCompositionRule(rule.rule_id, { condition_expression: e.target.value })
                        }
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {COMPOSITION_VARIABLE_TOKENS.map((token) => (
                          <ActionButton
                            key={`${rule.rule_id}-var-${token}`}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-lg"
                            onClick={() => appendTokenToRuleExpression(rule.rule_id, token)}
                          >
                            + {token}
                          </ActionButton>
                        ))}
                        {COMPOSITION_LITERAL_TOKENS.map((token) => (
                          <ActionButton
                            key={`${rule.rule_id}-lit-${token}`}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-lg"
                            onClick={() => appendTokenToRuleExpression(rule.rule_id, token)}
                          >
                            + {token}
                          </ActionButton>
                        ))}
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Feedback Strategy
                          </label>
                          <select
                            value={rule.feedback_mode}
                            onChange={(e) =>
                              updateCompositionRule(rule.rule_id, {
                                feedback_mode: e.target.value as FeedbackCompositionRule['feedback_mode'],
                              })
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                          >
                            <option value="use_latest_version">Use feedback agent (latest version)</option>
                            <option value="runtime_generate">Use feedback agent (runtime generate)</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Feedback Agent
                          </label>
                          <select
                            value={rule.feedback_agent_id}
                            onChange={(e) =>
                              updateCompositionRule(rule.rule_id, { feedback_agent_id: e.target.value })
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                          >
                            <option value="">Select agent</option>
                            {agents.map((agent) => (
                              <option key={`rule-agent-${rule.rule_id}-${agent.agent_id}`} value={agent.agent_id}>
                                {(agent.title || agent.agent_id).trim()} ({agent.agent_id})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Slide Display
                          </label>
                          <select
                            value={rule.slide_mode}
                            onChange={(e) =>
                              updateCompositionRule(rule.rule_id, {
                                slide_mode: e.target.value as FeedbackCompositionRule['slide_mode'],
                              })
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                          >
                            <option value="most_relevant_slide_page">Most Relevant Slide Page</option>
                            <option value="slide_file">Slide File</option>
                            <option value="no_slide">No Slide</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}

                  <ActionButton type="button" variant="ghost" className="rounded-lg" onClick={addCompositionRule}>
                    + Add IF Rule
                  </ActionButton>
                </div>

                {compositionError && (
                  <div className="whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {compositionError}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <ActionButton
                    type="button"
                    variant="ghost"
                    className="rounded-lg"
                    onClick={() => setIsCompositionPanelOpen(false)}
                    disabled={isSubmittingComposition}
                  >
                    Cancel
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="primary"
                    className="rounded-lg"
                    onClick={handleSubmitComposition}
                    disabled={isSubmittingComposition}
                  >
                    {isSubmittingComposition
                      ? compositionPanelMode === 'edit'
                        ? 'Updating...'
                        : 'Creating...'
                      : compositionPanelMode === 'edit'
                        ? 'Update Composition'
                        : 'Create Composition'}
                  </ActionButton>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
