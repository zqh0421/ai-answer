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

const normalizeRule = (raw: unknown): FeedbackCompositionRule | null => {
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

const normalizeComposition = (raw: unknown): FeedbackComposition | null => {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const compositionId = typeof data.composition_id === 'string' ? data.composition_id.trim() : '';
  if (!compositionId) return null;

  const rules = Array.isArray(data.rules)
    ? data.rules.map(normalizeRule).filter((rule): rule is FeedbackCompositionRule => Boolean(rule))
    : [];

  return {
    composition_id: compositionId,
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : compositionId,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    question_id: typeof data.question_id === 'string' ? data.question_id.trim() : '',
    question_type:
      data.question_type === 'mcq' || data.question_type === 'oeq'
        ? data.question_type
        : '',
    rules: rules.length > 0 ? rules : [createDefaultCompositionRule()],
    created_at: typeof data.created_at === 'string' && data.created_at ? data.created_at : nowIso(),
    updated_at: typeof data.updated_at === 'string' && data.updated_at ? data.updated_at : nowIso(),
  };
};

export const loadFeedbackCompositions = (): FeedbackComposition[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeComposition)
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
