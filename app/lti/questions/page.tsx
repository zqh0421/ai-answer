'use client';

import axios from 'axios';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ActionButton from '@/app/components/ActionButton';
import DynamicImage from '@/app/components/DynamicImage';
import ManageListPanel from '@/app/components/manage/ManageListPanel';
import {
  FeedbackComposition,
  parseFeedbackCompositionsResponse,
} from '@/app/lib/feedbackCompositions';
import { formatDateTimeForUser } from '@/app/utils/datetime';
import { buildStaticPageTitle } from '@/app/utils/title';

type PaginationToken = number | 'ellipsis';

interface QuestionContentItem {
  type: string;
  content: string;
}

interface QuestionRow {
  question_id: string;
  type?: string;
  question_type?: string;
  content?: QuestionContentItem[];
  content_blocks?: Array<{
    block_type?: string;
    type?: string;
    text_content?: string;
    media_url?: string;
    content?: string;
  }>;
  objective?: string[];
  slide_ids?: string[];
  created_at?: string;
}

type QuestionListPayload = {
  items?: QuestionRow[];
  questions?: QuestionRow[];
  data?: QuestionRow[] | { items?: QuestionRow[]; questions?: QuestionRow[] };
  results?: QuestionRow[];
};

type SortKey = 'type' | 'preview' | 'created_at';
type SortDirection = 'asc' | 'desc';
type SlideModeKey = 'no_slide' | 'full_slide' | 'retrieved_slide_page';

const PAGE_SIZE = 20;

const compositionSlideModeToLegacyMode = (value?: string): SlideModeKey => {
  if (value === 'no_slide') return 'no_slide';
  if (value === 'slide_file') return 'full_slide';
  return 'retrieved_slide_page';
};

const getPaginationTokens = (currentPage: number, totalPages: number): PaginationToken[] => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const tokens: PaginationToken[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  if (start > 2) tokens.push('ellipsis');
  for (let p = start; p <= end; p += 1) tokens.push(p);
  if (end < totalPages - 1) tokens.push('ellipsis');
  tokens.push(totalPages);
  return tokens;
};

const getQuestionTextPreview = (question: QuestionRow) => {
  const text = (question.content ?? []).find((item) => item.type === 'text')?.content?.trim() ?? '';
  if (!text) return '-';
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
};

const getQuestionImagePreview = (question: QuestionRow) =>
  (question.content ?? []).find((item) => item.type === 'image')?.content ?? '';

const formatCreatedAt = (value?: string) => formatDateTimeForUser(value);

const normalizeQuestionRow = (raw: any): QuestionRow => {
  const contentFromBlocks = Array.isArray(raw?.content_blocks)
    ? raw.content_blocks
        .map((block: any) => ({
          type: String(block?.type ?? block?.block_type ?? 'text'),
          content: String(block?.content ?? block?.text_content ?? block?.media_url ?? ''),
        }))
        .filter((item: QuestionContentItem) => Boolean(item.content))
    : [];
  const content = Array.isArray(raw?.content) ? raw.content : contentFromBlocks;
  const questionType = String(raw?.question_type ?? raw?.type ?? '').trim();

  return {
    question_id: String(raw?.question_id ?? ''),
    question_type: questionType,
    type: String(raw?.type ?? questionType),
    content,
    content_blocks: Array.isArray(raw?.content_blocks) ? raw.content_blocks : [],
    objective: Array.isArray(raw?.objective) ? raw.objective : [],
    slide_ids: Array.isArray(raw?.slide_ids) ? raw.slide_ids : [],
    created_at: typeof raw?.created_at === 'string' ? raw.created_at : undefined,
  };
};

const parsePublicQuestionsResponse = (payload: unknown): QuestionRow[] => {
  if (Array.isArray(payload)) return payload.map(normalizeQuestionRow).filter((item) => item.question_id);
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as QuestionListPayload;
  if (Array.isArray(data.items)) return data.items.map(normalizeQuestionRow).filter((item) => item.question_id);
  if (Array.isArray(data.questions)) return data.questions.map(normalizeQuestionRow).filter((item) => item.question_id);
  if (Array.isArray(data.results)) return data.results.map(normalizeQuestionRow).filter((item) => item.question_id);
  if (Array.isArray(data.data)) return data.data.map(normalizeQuestionRow).filter((item) => item.question_id);
  if (data.data && typeof data.data === 'object') {
    if (Array.isArray(data.data.items)) return data.data.items.map(normalizeQuestionRow).filter((item) => item.question_id);
    if (Array.isArray(data.data.questions)) return data.data.questions.map(normalizeQuestionRow).filter((item) => item.question_id);
  }
  return [];
};

export default function LtiQuestionsPage() {
  const searchParams = useSearchParams();
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [compositionSelectionByQuestion, setCompositionSelectionByQuestion] = useState<Record<string, string>>({});
  const [compositions, setCompositions] = useState<FeedbackComposition[]>([]);
  const isDeepLinkMode = searchParams.get('lti_mode') === 'deep_link';
  const launchId = searchParams.get('launch_id');
  const ltiLaunchId = searchParams.get('lti_launch_id');
  const ltiUserId = searchParams.get('lti_user_id');
  const defaultCompositionId = searchParams.get('composition_id') || '';
  const queryLearnerId = searchParams.get('learner_id');
  const [learnerIdInput, setLearnerIdInput] = useState(queryLearnerId || ltiUserId || '');

  useEffect(() => {
    document.title = buildStaticPageTitle('LTI Question Library');
  }, []);

  const fetchCompositions = useCallback(async () => {
    try {
      const requests = [
        axios.get('/api/feedback-compositions', {
          params: {
            include_public: true,
          },
        }),
      ];
      if (ltiUserId) {
        requests.push(
          axios.get('/api/feedback-compositions', {
            params: {
              user_id: ltiUserId,
              include_public: true,
            },
          })
        );
      }
      const responses = await Promise.all(requests);
      const merged = responses.flatMap((res) => parseFeedbackCompositionsResponse(res.data));
      const seen = new Set<string>();
      const deduped = merged.filter((item) => {
        const key = item.composition_id.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setCompositions(deduped);
    } catch (error) {
      console.error('Error fetching compositions:', error);
      setCompositions([]);
    }
  }, [ltiUserId]);

  useEffect(() => {
    void fetchCompositions();
  }, [fetchCompositions]);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await axios.get('/api/questions/public');
      const parsed = parsePublicQuestionsResponse(res.data);
      setQuestions(parsed);
      if (parsed.length === 0) {
        setLoadError('No public questions were returned (empty response).');
      }
    } catch (error) {
      console.error('Error fetching questions:', error);
      setQuestions([]);
      setLoadError('Failed to load public questions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (typeFilter !== 'all' && (q.type ?? '') !== typeFilter) return false;
      if (!normalizedSearch) return true;
      const id = String(q.question_id ?? '').toLowerCase();
      const type = String(q.type ?? '').toLowerCase();
      const preview = getQuestionTextPreview(q).toLowerCase();
      return id.includes(normalizedSearch) || type.includes(normalizedSearch) || preview.includes(normalizedSearch);
    });
  }, [questions, normalizedSearch, typeFilter]);

  const sortedQuestions = useMemo(() => {
    const list = [...filteredQuestions];
    list.sort((a, b) => {
      let aValue = '';
      let bValue = '';

      if (sortKey === 'created_at') {
        aValue = String(a.created_at ?? '');
        bValue = String(b.created_at ?? '');
      } else if (sortKey === 'type') {
        aValue = String(a.type ?? '');
        bValue = String(b.type ?? '');
      } else {
        aValue = getQuestionTextPreview(a);
        bValue = getQuestionTextPreview(b);
      }

      const base = aValue.localeCompare(bValue, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return sortDirection === 'asc' ? base : -base;
    });
    return list;
  }, [filteredQuestions, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedQuestions.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedQuestions = sortedQuestions.slice(pageStart, pageStart + PAGE_SIZE);
  const paginationTokens = getPaginationTokens(currentPage, totalPages);
  const sortIndicator = (key: SortKey) => (sortKey !== key ? '↕' : sortDirection === 'asc' ? '↑' : '↓');
  const typeOptions = useMemo(
    () => ['all', ...Array.from(new Set(questions.map((q) => q.type).filter(Boolean) as string[])).sort()],
    [questions]
  );
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'created_at' ? 'desc' : 'asc');
  };
  const compositionById = useMemo(
    () => new Map(compositions.map((composition) => [composition.composition_id, composition])),
    [compositions]
  );
  const dropdownCompositions = useMemo(() => {
    if (!defaultCompositionId || compositionById.has(defaultCompositionId)) return compositions;
    return [
      ...compositions,
      {
        composition_id: defaultCompositionId,
        title: defaultCompositionId,
        description: '',
        rules: [],
        created_at: '',
        updated_at: '',
      } as FeedbackComposition,
    ];
  }, [compositions, compositionById, defaultCompositionId]);
  const getSelectedCompositionId = (questionId: string) =>
    compositionSelectionByQuestion[questionId] ?? defaultCompositionId;
  const getSelectedComposition = (questionId: string) => {
    const compositionId = getSelectedCompositionId(questionId);
    if (!compositionId) return null;
    return compositionById.get(compositionId) ?? null;
  };
  const getSelectedSlideMode = (questionId: string): SlideModeKey =>
    getSelectedComposition(questionId)
      ? compositionSlideModeToLegacyMode(getSelectedComposition(questionId)?.rules?.[0]?.slide_mode)
      : 'retrieved_slide_page';
  const getQuestionPlayerHref = (question: QuestionRow) => {
    const compositionId = getSelectedCompositionId(question.question_id);
    const params = new URLSearchParams();
    if (compositionId) params.set('composition_id', compositionId);
    const normalizedLearnerId = learnerIdInput.trim();
    if (normalizedLearnerId) params.set('learner_id', normalizedLearnerId);
    if (isDeepLinkMode) params.set('lti_mode', 'deep_link');
    if (launchId) params.set('launch_id', launchId);
    if (ltiLaunchId) params.set('lti_launch_id', ltiLaunchId);
    if (ltiUserId) params.set('lti_user_id', ltiUserId);
    const query = params.toString();
    return `/question/${question.question_id}${query ? `?${query}` : ''}`;
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <div className="flex flex-col gap-4 md:items-start">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                LTI Questions
              </p>
              <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
                Question Library
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                Browse all questions in the database for LTI-related workflows.
              </p>
            </div>
          </div>
        </section>

        <ManageListPanel
          toolbarLeft={(
            <div className="text-sm text-slate-500">
              {loading
                ? 'Loading questions...'
                : loadError || `Loaded ${questions.length} question${questions.length === 1 ? '' : 's'}`}
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
                  placeholder="Search question ID, type, or text..."
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
                    {option === 'all' ? 'All types' : option}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={learnerIdInput}
                onChange={(e) => setLearnerIdInput(e.target.value)}
                placeholder="learner_id (optional)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-300 md:w-56"
              />
              <ActionButton
                onClick={() => fetchQuestions()}
                variant="neutral"
                size="sm"
                className="rounded-xl"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </ActionButton>
            </>
          )}
          table={(
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="w-[14%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                        <button
                          type="button"
                          onClick={() => handleSort('type')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          Type
                          <span className="text-slate-400">{sortIndicator('type')}</span>
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        <button
                          type="button"
                          onClick={() => handleSort('preview')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          Preview
                          <span className="text-slate-400">{sortIndicator('preview')}</span>
                        </button>
                      </th>
                      <th className="w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                        <button
                          type="button"
                          onClick={() => handleSort('created_at')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          Created
                          <span className="text-slate-400">{sortIndicator('created_at')}</span>
                        </button>
                      </th>
                      <th className="w-[1%] whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {pagedQuestions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                          {normalizedSearch ? 'No matching questions found.' : 'No questions available.'}
                        </td>
                      </tr>
                    ) : (
                      pagedQuestions.map((question) => (
                        <tr key={question.question_id} className="transition-colors hover:bg-slate-50/70">
                          <td className="px-4 py-3 align-middle text-slate-700">
                            {question.type || '-'}
                          </td>
                          <td className="px-4 py-3 align-middle text-slate-600">
                            <div className="flex items-start gap-3">
                              {getQuestionImagePreview(question) ? (
                                <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                                  <DynamicImage
                                    src={getQuestionImagePreview(question)}
                                    alt="Question preview"
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              ) : null}
                              <div className="min-w-0">
                                <p className="line-clamp-2 break-words text-sm text-slate-700">
                                  {getQuestionTextPreview(question)}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-middle whitespace-nowrap text-slate-600">
                            {formatCreatedAt(question.created_at)}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <div className="flex min-w-[360px] flex-col items-end gap-2">
                              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                                <select
                                  value={getSelectedCompositionId(question.question_id)}
                                  onChange={(e) =>
                                    setCompositionSelectionByQuestion((prev) => ({
                                      ...prev,
                                      [question.question_id]: e.target.value,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm outline-none focus:border-slate-300 sm:w-[220px]"
                                  >
                                    <option value="">No Feedback</option>
                                    {dropdownCompositions.map((composition) => (
                                      <option key={`composition-${composition.composition_id}`} value={composition.composition_id}>
                                        {composition.title || composition.composition_id}
                                      </option>
                                    ))}
                                </select>
                                <Link
                                  href={getQuestionPlayerHref(question)}
                                >
                                  <ActionButton variant="ghost" size="sm" className="w-full rounded-lg sm:w-auto">
                                    Open
                                  </ActionButton>
                                </Link>
                              </div>
                              {getSelectedComposition(question.question_id) ? (
                                <p className="max-w-[500px] text-right text-xs leading-relaxed text-slate-500">
                                  Composition: <span className="font-mono">{getSelectedComposition(question.question_id)?.composition_id}</span>
                                  {' '}| Rule-1 slide mode: {getSelectedSlideMode(question.question_id)}
                                </p>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          pagination={{
            currentPage,
            totalPages,
            tokens: paginationTokens,
            isLoading: loading,
            onPrev: () => setCurrentPage((prev) => Math.max(1, prev - 1)),
            onNext: () => setCurrentPage((prev) => Math.min(totalPages, prev + 1)),
            onPageSelect: (page) => setCurrentPage(page),
          }}
          summary={(
            <p className="text-center text-sm text-slate-500">
              Showing {pagedQuestions.length} item{pagedQuestions.length === 1 ? '' : 's'} of {sortedQuestions.length} filtered
              {' '}({normalizedSearch || typeFilter !== 'all' ? 'filters active, ' : ''}page {currentPage} of {totalPages}, {PAGE_SIZE} per page, {compositions.length} composition{compositions.length === 1 ? '' : 's'})
            </p>
          )}
        />
      </div>
    </main>
  );
}
