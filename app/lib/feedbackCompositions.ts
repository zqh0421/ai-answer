export type CompositionMetricKey = 'attempted_count' | 'wrong_count' | 'correct_count';

export type CompositionFeedbackMode = 'use_latest_version' | 'runtime_generate';

export type CompositionSlideMode = 'most_relevant_slide_page' | 'slide_file' | 'no_slide';

export interface FeedbackCompositionRule {
  rule_id: string;
  condition_expression: string;
  feedback_mode: CompositionFeedbackMode;
  feedback_agent_id: string;
  slide_mode: CompositionSlideMode;
}

export interface FeedbackComposition {
  composition_id: string;
  title: string;
  description?: string;
  question_id?: string;
  question_type?: 'mcq' | 'oeq' | '';
  rules: FeedbackCompositionRule[];
  created_at: string;
  updated_at: string;
}

const STORAGE_KEY = 'ai_feedback_compositions_v1';

export const COMPOSITION_VARIABLE_TOKENS: CompositionMetricKey[] = [
  'attempted_count',
  'wrong_count',
  'correct_count',
];

export const COMPOSITION_LITERAL_TOKENS = ['TRUE', 'FALSE', '&&', '||', '==', '!=', '>', '<', '>=', '<=', '(', ')'];

const nowIso = () => new Date().toISOString();

export const createRuleId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `r_${crypto.randomUUID()}`;
  }
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const createDefaultCompositionRule = (): FeedbackCompositionRule => ({
  rule_id: createRuleId(),
  condition_expression: 'TRUE',
  feedback_mode: 'use_latest_version',
  feedback_agent_id: '',
  slide_mode: 'most_relevant_slide_page',
});

export const normalizeFeedbackCompositionRule = (raw: unknown): FeedbackCompositionRule | null => {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const ruleId = typeof data.rule_id === 'string' && data.rule_id.trim() ? data.rule_id.trim() : createRuleId();
  const conditionExpression =
    typeof data.condition_expression === 'string' && data.condition_expression.trim()
      ? data.condition_expression.trim()
      : 'TRUE';
  const feedbackMode =
    data.feedback_mode === 'runtime_generate' || data.feedback_mode === 'use_latest_version'
      ? data.feedback_mode
      : 'use_latest_version';
  const slideMode =
    data.slide_mode === 'slide_file' || data.slide_mode === 'no_slide' || data.slide_mode === 'most_relevant_slide_page'
      ? data.slide_mode
      : 'most_relevant_slide_page';

  return {
    rule_id: ruleId,
    condition_expression: conditionExpression,
    feedback_mode: feedbackMode,
    feedback_agent_id: typeof data.feedback_agent_id === 'string' ? data.feedback_agent_id.trim() : '',
    slide_mode: slideMode,
  };
};

export const normalizeFeedbackComposition = (raw: unknown): FeedbackComposition | null => {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const compositionId = (
    typeof data.composition_id === 'string'
      ? data.composition_id
      : typeof data.id === 'string'
        ? data.id
        : typeof data.compositionId === 'string'
          ? data.compositionId
          : ''
  ).trim();
  if (!compositionId) return null;

  const rawRules = Array.isArray(data.rules)
    ? data.rules
    : Array.isArray(data.composition_rules)
      ? data.composition_rules
      : Array.isArray(data.rule_list)
        ? data.rule_list
        : [];
  const rules = rawRules
    .map(normalizeFeedbackCompositionRule)
    .filter((rule): rule is FeedbackCompositionRule => Boolean(rule));

  const title = (
    typeof data.title === 'string'
      ? data.title
      : typeof data.name === 'string'
        ? data.name
        : compositionId
  ).trim();

  const description = (
    typeof data.description === 'string'
      ? data.description
      : typeof data.desc === 'string'
        ? data.desc
        : ''
  ).trim();

  const questionId = (
    typeof data.question_id === 'string'
      ? data.question_id
      : typeof data.questionId === 'string'
        ? data.questionId
        : ''
  ).trim();

  const rawQuestionType =
    data.question_type === 'mcq' || data.question_type === 'oeq'
      ? data.question_type
      : data.questionType === 'mcq' || data.questionType === 'oeq'
        ? data.questionType
        : '';

  const createdAt = (
    typeof data.created_at === 'string'
      ? data.created_at
      : typeof data.createdAt === 'string'
        ? data.createdAt
        : ''
  ) || nowIso();

  const updatedAt = (
    typeof data.updated_at === 'string'
      ? data.updated_at
      : typeof data.updatedAt === 'string'
        ? data.updatedAt
        : ''
  ) || nowIso();

  return {
    composition_id: compositionId,
    title: title || compositionId,
    description,
    question_id: questionId,
    question_type: rawQuestionType,
    rules: rules.length > 0 ? rules : [createDefaultCompositionRule()],
    created_at: createdAt,
    updated_at: updatedAt,
  };
};

const collectCompositionCandidates = (raw: unknown): unknown[] => {
  if (!raw || typeof raw !== 'object') {
    return Array.isArray(raw) ? raw : [];
  }
  if (Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const listFields = [
    record.items,
    record.data,
    record.compositions,
    record.feedback_compositions,
    record.results,
    record.rows,
  ];
  for (const candidate of listFields) {
    if (Array.isArray(candidate)) return candidate;
  }
  const singleFields = [record.item, record.composition, record.feedback_composition, record.result];
  for (const candidate of singleFields) {
    if (candidate && typeof candidate === 'object') return [candidate];
  }
  if (typeof record.composition_id === 'string' || typeof record.id === 'string') return [record];
  return [];
};

export const parseFeedbackCompositionsResponse = (raw: unknown): FeedbackComposition[] => {
  const candidates = collectCompositionCandidates(raw);
  const parsed = candidates
    .map(normalizeFeedbackComposition)
    .filter((composition): composition is FeedbackComposition => Boolean(composition));

  // Deduplicate by composition_id while preserving order from server response.
  const seen = new Set<string>();
  return parsed.filter((item) => {
    const key = item.composition_id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const loadFeedbackCompositions = (): FeedbackComposition[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeFeedbackComposition)
      .filter((composition): composition is FeedbackComposition => Boolean(composition));
  } catch {
    return [];
  }
};

export const saveFeedbackCompositions = (items: FeedbackComposition[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
};

export const upsertFeedbackComposition = (
  current: FeedbackComposition[],
  next: Omit<FeedbackComposition, 'created_at' | 'updated_at'>
): FeedbackComposition[] => {
  const index = current.findIndex((item) => item.composition_id === next.composition_id);
  const timestamp = nowIso();
  const normalizedNext: FeedbackComposition = {
    ...next,
    description: next.description?.trim() || '',
    question_id: next.question_id?.trim() || '',
    question_type: next.question_type === 'mcq' || next.question_type === 'oeq' ? next.question_type : '',
    created_at: index >= 0 ? current[index].created_at : timestamp,
    updated_at: timestamp,
  };

  if (index >= 0) {
    const clone = [...current];
    clone[index] = normalizedNext;
    return clone;
  }

  return [normalizedNext, ...current];
};

export const removeFeedbackComposition = (current: FeedbackComposition[], compositionId: string) =>
  current.filter((item) => item.composition_id !== compositionId);

export const FEEDBACK_COMPOSITION_STORAGE_KEY = STORAGE_KEY;
