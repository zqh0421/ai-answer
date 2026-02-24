'use client';

import axios from 'axios';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ActionButton from '@/app/components/ActionButton';
import DynamicImage from '@/app/components/DynamicImage';
import ManageListPanel from '@/app/components/manage/ManageListPanel';
import { buildStaticPageTitle } from '@/app/utils/title';

type PaginationToken = number | 'ellipsis';

interface QuestionContentItem {
  type: string;
  content: string;
}

interface QuestionRow {
  question_id: string;
  type?: string;
  content?: QuestionContentItem[];
  objective?: string[];
  slide_ids?: string[];
  created_at?: string;
}

type SortKey = 'type' | 'preview' | 'created_at';
type SortDirection = 'asc' | 'desc';
type FeedbackOptionKey = 'no_feedback' | 'test_feedback';
type SlideModeKey = 'no_slide' | 'full_slide' | 'retrieved_slide_page';

const PAGE_SIZE = 20;
const TEST_FEEDBACK_PLACEHOLDER =
  'The feedback is currently in the process of being migrated, this is for a placeholder purpose.';

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

const formatCreatedAt = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export default function LtiQuestionsPage() {
  const searchParams = useSearchParams();
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [feedbackSelectionByQuestion, setFeedbackSelectionByQuestion] = useState<Record<string, FeedbackOptionKey>>({});
  const [slideModeByQuestion, setSlideModeByQuestion] = useState<Record<string, SlideModeKey>>({});
  const isDeepLinkMode = searchParams.get('lti_mode') === 'deep_link';
  const launchId = searchParams.get('launch_id');
  const ltiLaunchId = searchParams.get('lti_launch_id');
  const ltiUserId = searchParams.get('lti_user_id');

  useEffect(() => {
    document.title = buildStaticPageTitle('LTI Question Library');
  }, []);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/questions/all');
      setQuestions(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error('Error fetching questions:', error);
      setQuestions([]);
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
  const getSelectedFeedback = (questionId: string): FeedbackOptionKey =>
    feedbackSelectionByQuestion[questionId] ?? 'test_feedback';
  const getSelectedSlideMode = (questionId: string): SlideModeKey =>
    slideModeByQuestion[questionId] ?? 'retrieved_slide_page';
  const getQuestionPlayerHref = (question: QuestionRow) => {
    const normalizedType = (question.type ?? '').toLowerCase();
    const route = normalizedType.includes('multiple') || normalizedType.includes('mcq') ? 'mcq' : 'oeq';
    const params = new URLSearchParams({
      feedback_key: getSelectedFeedback(question.question_id),
      slide_mode: getSelectedSlideMode(question.question_id),
    });
    if (isDeepLinkMode) {
      params.set('lti_mode', 'deep_link');
      if (launchId) params.set('launch_id', launchId);
      if (ltiLaunchId) params.set('lti_launch_id', ltiLaunchId);
      if (ltiUserId) params.set('lti_user_id', ltiUserId);
    }
    return `/${route}/${question.question_id}?${params.toString()}`;
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
              {loading ? 'Loading questions...' : `Loaded ${questions.length} question${questions.length === 1 ? '' : 's'}`}
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
                            <div className="flex min-w-[320px] flex-col items-end gap-2">
                              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                                <select
                                  value={getSelectedFeedback(question.question_id)}
                                  onChange={(e) =>
                                    setFeedbackSelectionByQuestion((prev) => ({
                                      ...prev,
                                      [question.question_id]: e.target.value as FeedbackOptionKey,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm outline-none focus:border-slate-300 sm:w-[150px]"
                                >
                                  <option value="no_feedback">No Feedback</option>
                                  <option value="test_feedback">Test Feedback</option>
                                </select>
                                <select
                                  value={getSelectedSlideMode(question.question_id)}
                                  onChange={(e) =>
                                    setSlideModeByQuestion((prev) => ({
                                      ...prev,
                                      [question.question_id]: e.target.value as SlideModeKey,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm outline-none focus:border-slate-300 sm:w-[170px]"
                                >
                                  <option value="no_slide">No Slide</option>
                                  <option value="full_slide">Full Slide</option>
                                  <option value="retrieved_slide_page">Retrieved Slide Page</option>
                                </select>
                                <Link
                                  href={getQuestionPlayerHref(question)}
                                >
                                  <ActionButton variant="ghost" size="sm" className="w-full rounded-lg sm:w-auto">
                                    Open
                                  </ActionButton>
                                </Link>
                              </div>
                              {getSelectedFeedback(question.question_id) === 'test_feedback' ? (
                                <p className="max-w-[320px] text-right text-xs leading-relaxed text-slate-500">
                                  {TEST_FEEDBACK_PLACEHOLDER}
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
              {' '}({normalizedSearch || typeFilter !== 'all' ? 'filters active, ' : ''}page {currentPage} of {totalPages}, {PAGE_SIZE} per page)
            </p>
          )}
        />
      </div>
    </main>
  );
}
