'use client';

import axios from 'axios';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import ActionButton from '@/app/components/ActionButton';
import ManageDataTable, { ManageTableColumn } from '@/app/components/manage/ManageDataTable';
import ManageListPanel from '@/app/components/manage/ManageListPanel';
import { useManagePermissionGuard } from '@/app/manage/hooks/useManagePermissionGuard';
import { buildStaticPageTitle } from '@/app/utils/title';

type AgentRole = 'human' | 'ai';
type AgentExecutionMode = 'static' | 'dynamic';
type AgentScope = 'private' | 'public';
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

interface FeedbackAgent {
  agent_id: string;
  title?: string;
  role?: string;
  execution_mode?: string;
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
  execution_mode: AgentExecutionMode;
  is_structured: boolean;
  provider: string;
  model: string;
  prompt_text: string;
  retrieved_slide_pages_rule?: RetrievalRule;
  llm_params_json: string;
}

const DEFAULT_INPUT_KEYS = [
  'question_content_blocks',
  'answer_text',
  'all_options',
  'selected_option_index',
  'retrieved_slide_pages',
] as const;
let cachedInputOptionKeys: string[] | null = null;
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
  execution_mode: 'static',
  is_structured: false,
  provider: '',
  model: '',
  prompt_text: '',
  retrieved_slide_pages_rule: undefined,
  llm_params_json: '',
});

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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
  if (!text) return '<span class="text-slate-400">Use {{{answer_text}}}, {{{question_content_blocks}}}, etc.</span>';
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

const normalizeAgent = (raw: any): FeedbackAgent => ({
  agent_id: String(raw?.agent_id ?? raw?.id ?? ''),
  title: raw?.title ?? raw?.name ?? '',
  role: raw?.role,
  execution_mode: raw?.execution_mode,
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
  const execution_mode =
    agent.execution_mode === 'dynamic'
      ? 'dynamic'
      : role === 'human'
        ? 'static'
        : 'static';

  return {
    title: agent.title ?? '',
    role,
    execution_mode: role === 'human' ? 'static' : execution_mode,
    is_structured: role === 'human' ? false : Boolean(agent.is_structured),
    provider: agent.provider ?? '',
    model: agent.model ?? '',
    prompt_text: role === 'human' ? '' : (agent.prompt_text ?? '').trim() || promptTextFromInputs,
    retrieved_slide_pages_rule: retrievedSlideInput?.retrieval_rule ? { ...retrievedSlideInput.retrieval_rule } : undefined,
    llm_params_json: agent.llm_params ? JSON.stringify(agent.llm_params, null, 2) : '',
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
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptHighlightRef = useRef<HTMLDivElement | null>(null);

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

  const fetchInputOptions = useCallback(async () => {
    if (cachedInputOptionKeys?.length) {
      setInputOptionKeys(cachedInputOptionKeys);
      setInputOptionsError(null);
      return;
    }

    setIsFetchingInputOptions(true);
    setInputOptionsError(null);
    try {
      const res = await axios.get('/api/feedback-agents/input-options');
      const keys = parseInputOptionKeys(res.data);
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

  useEffect(() => {
    if (sessionStatus === 'loading' || isPermissionChecking || !hasManagePermission) return;
    fetchAgents();
  }, [fetchAgents, hasManagePermission, isPermissionChecking, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'loading' || isPermissionChecking || !hasManagePermission) return;
    fetchInputOptions();
  }, [fetchInputOptions, hasManagePermission, isPermissionChecking, sessionStatus]);

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
        agent.execution_mode,
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
    () => extractPromptVariables(form.prompt_text, allowedPromptKeySet),
    [allowedPromptKeySet, form.prompt_text]
  );
  const promptHighlightHtml = useMemo(
    () => buildPromptHighlightHtml(form.prompt_text, allowedPromptKeySet),
    [allowedPromptKeySet, form.prompt_text]
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
    setIsAdvancedLlmOpen(Boolean(next.llm_params_json.trim()));
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
          execution_mode: 'static',
          is_structured: false,
          prompt_text: '',
          provider: '',
          model: '',
          retrieved_slide_pages_rule: undefined,
          llm_params_json: '',
        };
      }
      return {
        ...prev,
        role: 'ai',
        execution_mode: prev.execution_mode,
        provider: prev.provider || 'openai',
      };
    });
  };

  const insertPromptVariable = (key: string) => {
    if (form.role === 'human') return;
    const token = `{{{${key}}}}`;
    const el = promptTextareaRef.current;
    if (!el) {
      setForm((prev) => ({ ...prev, prompt_text: `${prev.prompt_text}${prev.prompt_text ? ' ' : ''}${token}` }));
      return;
    }
    const start = el.selectionStart ?? form.prompt_text.length;
    const end = el.selectionEnd ?? form.prompt_text.length;
    const next = `${form.prompt_text.slice(0, start)}${token}${form.prompt_text.slice(end)}`;
    setForm((prev) => ({ ...prev, prompt_text: next }));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
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
      return { errorMessage: 'retrieved_slide_pages rule is configured, but {{{retrieved_slide_pages}}} is missing in prompt_text.' };
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

    if (form.role === 'human') {
      const payload = {
        name: title,
        title,
        role: 'human',
        execution_mode: 'static',
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

    if (form.execution_mode === 'dynamic' && !form.provider.trim()) {
      return { errorMessage: 'Provider is required for AI dynamic agent.' };
    }
    if (form.execution_mode === 'dynamic' && !form.model.trim()) {
      return { errorMessage: 'Model is required for AI dynamic agent.' };
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

    const payload = {
      name: title,
      title,
      role: 'ai',
      execution_mode: form.execution_mode,
      prompt_text: form.prompt_text.trim() || null,
      is_structured: Boolean(form.is_structured),
      provider: form.provider.trim(),
      model: form.model.trim(),
      access_scope: 'private' as AgentScope,
      is_visible: true,
      created_by: actorUserId,
      updated_by: actorUserId,
      inputs: derivedInputs,
      ...(parsedLlmParams ? { llm_params: parsedLlmParams } : {}),
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
      id: 'execution_mode',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Execution',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-600',
      renderCell: (agent) => agent.execution_mode || '-',
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
                  placeholder="Search... (supports creator:xxx)"
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
                    const promptText = agent.prompt_text?.trim() || '';
                    const promptTokens = extractPromptVariables(promptText, allowedPromptKeySet);
                    const promptHtml = promptText ? buildPromptHighlightHtml(promptText, allowedPromptKeySet) : '';

                    return (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                        </div>

                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Prompt Template
                          </div>
                          {promptText ? (
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

                <div className="grid gap-4 md:grid-cols-2">
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
                    <label className="mb-1 block text-sm font-medium text-slate-700">Execution Mode</label>
                    <select
                      value={form.execution_mode}
                      onChange={(e) =>
                        setFormField('execution_mode', e.target.value === 'dynamic' ? 'dynamic' : 'static')
                      }
                      disabled={form.role === 'human'}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none disabled:bg-slate-50 disabled:text-slate-500 focus:border-slate-300"
                    >
                      <option value="static">static</option>
                      <option value="dynamic">dynamic</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Provider</label>
                    <select
                      value={form.provider}
                      onChange={(e) => setFormField('provider', e.target.value)}
                      disabled={form.role === 'human'}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none disabled:bg-slate-50 disabled:text-slate-500 focus:border-slate-300"
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
                      disabled={form.role === 'human'}
                      placeholder={form.role === 'human' ? 'Forced empty for human' : 'e.g. gpt-4.1-mini'}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none disabled:bg-slate-50 disabled:text-slate-500 focus:border-slate-300"
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
                        onChange={(e) => setFormField('is_structured', e.target.checked)}
                        disabled={form.role === 'human'}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Structured Output
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Prompt Template</label>
                      <p className="text-xs text-slate-500">
                        Insert variables as <code>{'{{{key}}}'}</code>. Only the predefined keys are allowed.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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
                  </div>

                  <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div
                      ref={promptHighlightRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm leading-6 text-slate-800"
                      dangerouslySetInnerHTML={{ __html: promptHighlightHtml }}
                    />
                    <textarea
                      ref={promptTextareaRef}
                      rows={6}
                      value={form.prompt_text}
                      onChange={(e) => setFormField('prompt_text', e.target.value)}
                      onScroll={(e) => {
                        if (promptHighlightRef.current) {
                          promptHighlightRef.current.scrollTop = e.currentTarget.scrollTop;
                          promptHighlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
                        }
                      }}
                      disabled={form.role === 'human'}
                      placeholder=""
                      spellCheck={false}
                      className="relative w-full resize-y rounded-xl bg-transparent px-3 py-2 font-mono text-sm leading-6 text-transparent caret-slate-900 outline-none disabled:bg-slate-50 disabled:text-transparent disabled:caret-transparent"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {promptVariables.validKeys.map((key) => (
                      <span
                        key={key}
                        className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                      >
                        {key}
                      </span>
                    ))}
                    {promptVariables.invalidKeys.map((key) => (
                      <span
                        key={key}
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
                  {form.role === 'human' && (
                    <p className="mt-1 text-xs text-slate-500">
                      Human agent rules enforced: `execution_mode=static`, `prompt_text=''`, `is_structured=false`.
                    </p>
                  )}
                </div>

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
                              Optional JSON object passed through for model generation settings.
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
      </div>
    </main>
  );
}
