'use client';

import axios from 'axios';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ActionButton from '@/app/components/ActionButton';
import ManageBreadcrumb from '@/app/components/manage/ManageBreadcrumb';
import ManageDataTable, { ManageTableColumn } from '@/app/components/manage/ManageDataTable';
import ManageListPanel from '@/app/components/manage/ManageListPanel';
import { useManagePermissionGuard } from '@/app/manage/hooks/useManagePermissionGuard';
import { Course } from '@/app/types';
import { formatDateTimeForUser } from '@/app/utils/datetime';
import { buildStaticPageTitle } from '@/app/utils/title';

type RecordView = 'records' | 'learner' | 'question' | 'learner-question';

interface LearningRecordItem {
  record_id: string;
  course_id?: string;
  course_title?: string;
  module_id?: string;
  module_title?: string;
  slide_id?: string;
  slide_title?: string;
  question_id?: string;
  question_preview?: string;
  learner_id?: string;
  learner_name?: string;
  answer?: string;
  feedback?: string;
  status?: string;
  submitted_at?: string;
  final_score?: number | string | null;
  final_score_max?: number | string | null;
}

interface LearningRecordsResponse {
  items?: LearningRecordItem[];
  next_cursor?: string | null;
  has_more?: boolean;
}

interface LearnerGroup {
  learnerKey: string;
  learnerName: string;
  learnerId: string;
  records: LearningRecordItem[];
}

interface QuestionGroup {
  questionKey: string;
  questionId: string;
  questionPreview: string;
  latestSubmittedAt: string;
  finalScoreLabel: string;
  records: LearningRecordItem[];
}

interface LearnerQuestionGroup extends LearnerGroup {
  questionGroups: QuestionGroup[];
}

const COURSE_PAGE_SIZE = 100;
const INITIAL_RECORD_TARGET = 900;
const INITIAL_RECORD_PAGE_SIZE = 100;
const LOAD_MORE_RECORD_PAGE_SIZE = 50;
const QUIZ_LINKED_SLIDE_IDS = new Set([
  'bc58212f-ab19-43ec-a99c-eec5122dd6cf',
  'bf45d41c-9f9a-4604-a14b-4fbe52c7c359',
  '842960bc-8a94-400e-a254-018e7633f770',
]);

const VIEW_OPTIONS: Array<{ id: RecordView; label: string }> = [
  { id: 'records', label: 'By Record' },
  { id: 'learner', label: 'By Learner' },
  { id: 'question', label: 'By Question' },
  { id: 'learner-question', label: 'Learner > Question' },
];

const parseCoursesResponse = (data: unknown) => {
  if (Array.isArray(data)) {
    return data as Course[];
  }

  if (!data || typeof data !== 'object') {
    return [] as Course[];
  }

  const payload = data as Record<string, unknown>;
  const itemsCandidate = payload.items ?? payload.courses ?? payload.data ?? payload.results ?? payload.rows;

  return Array.isArray(itemsCandidate) ? (itemsCandidate as Course[]) : [];
};

const parseLearningRecordsResponse = (data: unknown): Required<LearningRecordsResponse> => {
  if (!data || typeof data !== 'object') {
    return { items: [], next_cursor: null, has_more: false };
  }

  const payload = data as Record<string, unknown>;
  return {
    items: Array.isArray(payload.items) ? (payload.items as LearningRecordItem[]) : [],
    next_cursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null,
    has_more: Boolean(payload.has_more),
  };
};

const buildSelectedCourseSearch = (searchParams: URLSearchParams, courseId?: string) => {
  const next = new URLSearchParams(searchParams.toString());
  if (courseId) {
    next.set('course_id', courseId);
  } else {
    next.delete('course_id');
  }
  const query = next.toString();
  return query ? `?${query}` : '';
};

const getRecordSubmittedAt = (record: LearningRecordItem) => record.submitted_at || '';

const toScoreLabel = (score?: number | string | null, max?: number | string | null) => {
  const hasScore = score !== null && score !== undefined && String(score).trim() !== '';
  const hasMax = max !== null && max !== undefined && String(max).trim() !== '';
  if (hasScore && hasMax) return `${score}/${max}`;
  if (hasScore) return String(score);
  return 'Pending';
};

const getLearnerDisplayName = (record: LearningRecordItem) =>
  record.learner_name?.trim() || record.learner_id?.trim() || 'Unknown learner';

const getQuestionDisplay = (record: LearningRecordItem) =>
  record.question_preview?.trim() || record.question_id?.trim() || 'Untitled question';

const sortBySubmittedAtDesc = (a: LearningRecordItem, b: LearningRecordItem) => {
  const dateCompare = getRecordSubmittedAt(b).localeCompare(getRecordSubmittedAt(a));
  if (dateCompare !== 0) return dateCompare;
  return String(b.record_id || '').localeCompare(String(a.record_id || ''));
};

const toDisplayScoreLabel = (score?: number | string | null, max?: number | string | null) => {
  const label = toScoreLabel(score, max);
  return label === 'Pending' ? 'No Score' : label;
};

const renderExpandedRecordContent = (record: LearningRecordItem) => (
  <div className="grid gap-3 sm:grid-cols-[auto,1fr] sm:gap-x-4">
    <div className="font-medium text-slate-700">Question</div>
    <div className="whitespace-pre-wrap break-words text-slate-600">{getQuestionDisplay(record)}</div>
    <div className="font-medium text-slate-700">Answer</div>
    <div className="whitespace-pre-wrap break-words text-slate-600">{record.answer?.trim() || 'No answer captured.'}</div>
    <div className="font-medium text-slate-700">Feedback</div>
    <div className="whitespace-pre-wrap break-words text-slate-600">{record.feedback?.trim() || 'No feedback captured.'}</div>
  </div>
);

export default function RecordManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const { hasManagePermission, isPermissionChecking } = useManagePermissionGuard();
  const [courses, setCourses] = useState<Course[]>([]);
  const [isFetchingCourses, setIsFetchingCourses] = useState(false);
  const [records, setRecords] = useState<LearningRecordItem[]>([]);
  const [isFetchingRecords, setIsFetchingRecords] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<RecordView>('records');
  const [selectedLearnerId, setSelectedLearnerId] = useState('all');
  const [showQuizLinkedOnly, setShowQuizLinkedOnly] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMoreRecords, setHasMoreRecords] = useState(false);
  const creatorEmail = session?.user?.email;
  const selectedCourseId = searchParams.get('course_id') ?? '';

  useEffect(() => {
    document.title = buildStaticPageTitle('Learning Record Management');
  }, []);

  const fetchCourses = useCallback(async () => {
    if (!creatorEmail) return;
    setIsFetchingCourses(true);
    try {
      const res = await axios.get(`/api/courses/createdby/${creatorEmail}`, {
        params: {
          page: 1,
          page_size: COURSE_PAGE_SIZE,
          per_page: COURSE_PAGE_SIZE,
          sort_key: 'created_at',
          sort_direction: 'desc',
        },
      });
      setCourses(parseCoursesResponse(res.data));
    } catch (error) {
      console.error('Error fetching courses for record management:', error);
      setCourses([]);
    } finally {
      setIsFetchingCourses(false);
    }
  }, [creatorEmail]);

  useEffect(() => {
    if (sessionStatus === 'loading' || isPermissionChecking || !hasManagePermission) return;
    fetchCourses();
  }, [fetchCourses, hasManagePermission, isPermissionChecking, sessionStatus]);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.course_id === selectedCourseId) ?? null,
    [courses, selectedCourseId]
  );

  useEffect(() => {
    if (!selectedCourseId || courses.length === 0) return;
    if (selectedCourse) return;
    router.replace(`/manage/record${buildSelectedCourseSearch(new URLSearchParams(searchParams.toString()))}`);
  }, [courses.length, router, searchParams, selectedCourse, selectedCourseId]);

  const fetchLearningRecords = useCallback(async (cursor?: string | null, append = false) => {
    if (!selectedCourseId) return;

    if (append) {
      setIsFetchingMore(true);
    } else {
      setIsFetchingRecords(true);
      setRecordsError('');
    }

    try {
      if (append) {
        const params: Record<string, string | number> = {
          course_id: selectedCourseId,
          page_size: LOAD_MORE_RECORD_PAGE_SIZE,
        };
        if (cursor) params.cursor = cursor;
        if (searchQuery.trim()) params.search = searchQuery.trim();
        const res = await axios.get('/api/learning-records', { params });
        const parsed = parseLearningRecordsResponse(res.data);

        setRecords((prev) => [...prev, ...parsed.items]);
        setNextCursor(parsed.next_cursor);
        setHasMoreRecords(parsed.has_more);
      } else {
        let remaining = INITIAL_RECORD_TARGET;
        let requestCursor = cursor ?? null;
        let combinedItems: LearningRecordItem[] = [];
        let finalNextCursor: string | null = null;
        let finalHasMore = false;

        while (remaining > 0) {
          const params: Record<string, string | number> = {
            course_id: selectedCourseId,
            page_size: Math.min(INITIAL_RECORD_PAGE_SIZE, remaining),
          };
          if (requestCursor) params.cursor = requestCursor;
          if (searchQuery.trim()) params.search = searchQuery.trim();

          const res = await axios.get('/api/learning-records', { params });
          const parsed = parseLearningRecordsResponse(res.data);

          combinedItems = [...combinedItems, ...parsed.items];
          finalNextCursor = parsed.next_cursor;
          finalHasMore = parsed.has_more;
          remaining -= parsed.items.length;

          if (!parsed.has_more || !parsed.next_cursor || parsed.items.length === 0) {
            break;
          }

          requestCursor = parsed.next_cursor;
        }

        setRecords(combinedItems);
        setNextCursor(finalNextCursor);
        setHasMoreRecords(finalHasMore);
      }
    } catch (error) {
      console.error('Error fetching learning records:', error);
      setRecordsError('Failed to load learning records.');
      if (!append) {
        setRecords([]);
        setNextCursor(null);
        setHasMoreRecords(false);
      }
    } finally {
      setIsFetchingRecords(false);
      setIsFetchingMore(false);
    }
  }, [searchQuery, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseId || !selectedCourse) return;
    fetchLearningRecords(null, false);
  }, [fetchLearningRecords, selectedCourse, selectedCourseId]);

  const courseSelectionRows = useMemo(() => {
    const courseQuery = searchQuery.trim().toLowerCase();
    return courses.filter((course) => {
      if (!courseQuery) return true;
      const title = String(course.course_title ?? '').toLowerCase();
      const description = String(course.course_description ?? '').toLowerCase();
      return title.includes(courseQuery) || description.includes(courseQuery);
    });
  }, [courses, searchQuery]);

  const learnerOptions = useMemo(() => {
    return Array.from(
      new Set(
        records
          .map((record) => record.learner_id?.trim())
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const matchesLearner = selectedLearnerId === 'all' || record.learner_id?.trim() === selectedLearnerId;
      if (!matchesLearner) return false;

      const isQuizLinked = Boolean(record.slide_id && QUIZ_LINKED_SLIDE_IDS.has(record.slide_id));
      if (showQuizLinkedOnly && !isQuizLinked) return false;

      return true;
    });
  }, [records, selectedLearnerId, showQuizLinkedOnly]);

  const learnerGroups = useMemo<LearnerGroup[]>(() => {
    const grouped = new Map<string, LearnerGroup>();

    filteredRecords.forEach((record) => {
      const learnerKey = record.learner_id?.trim() || record.learner_name?.trim() || record.record_id;
      const existing = grouped.get(learnerKey);
      if (existing) {
        existing.records.push(record);
        return;
      }
      grouped.set(learnerKey, {
        learnerKey,
        learnerName: getLearnerDisplayName(record),
        learnerId: record.learner_id?.trim() || '-',
        records: [record],
      });
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        records: [...group.records].sort(sortBySubmittedAtDesc),
      }))
      .sort((a, b) => {
        const aLatest = getRecordSubmittedAt(a.records[0]);
        const bLatest = getRecordSubmittedAt(b.records[0]);
        return bLatest.localeCompare(aLatest);
      });
  }, [filteredRecords]);

  const questionGroups = useMemo<QuestionGroup[]>(() => {
    const grouped = new Map<string, QuestionGroup>();

    filteredRecords.forEach((record) => {
      const questionKey = record.question_id?.trim() || record.question_preview?.trim() || record.record_id;
      const existing = grouped.get(questionKey);
      if (existing) {
        existing.records.push(record);
        if (getRecordSubmittedAt(record) > existing.latestSubmittedAt) {
          existing.latestSubmittedAt = getRecordSubmittedAt(record);
        }
        return;
      }
      grouped.set(questionKey, {
        questionKey,
        questionId: record.question_id?.trim() || '-',
        questionPreview: getQuestionDisplay(record),
        latestSubmittedAt: getRecordSubmittedAt(record),
        finalScoreLabel: toScoreLabel(record.final_score, record.final_score_max),
        records: [record],
      });
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        records: [...group.records].sort(sortBySubmittedAtDesc),
      }))
      .sort((a, b) => b.latestSubmittedAt.localeCompare(a.latestSubmittedAt));
  }, [filteredRecords]);

  const learnerQuestionGroups = useMemo<LearnerQuestionGroup[]>(() => {
    return learnerGroups.map((learnerGroup) => {
      const grouped = new Map<string, QuestionGroup>();

      learnerGroup.records.forEach((record) => {
        const questionKey = record.question_id?.trim() || record.question_preview?.trim() || record.record_id;
        const existing = grouped.get(questionKey);
        if (existing) {
          existing.records.push(record);
          if (getRecordSubmittedAt(record) > existing.latestSubmittedAt) {
            existing.latestSubmittedAt = getRecordSubmittedAt(record);
          }
          return;
        }
        grouped.set(questionKey, {
          questionKey,
          questionId: record.question_id?.trim() || '-',
          questionPreview: getQuestionDisplay(record),
          latestSubmittedAt: getRecordSubmittedAt(record),
          finalScoreLabel: toScoreLabel(record.final_score, record.final_score_max),
          records: [record],
        });
      });

      return {
        ...learnerGroup,
        questionGroups: Array.from(grouped.values())
          .map((group) => ({
            ...group,
            records: [...group.records].sort(sortBySubmittedAtDesc),
          }))
          .sort((a, b) => b.latestSubmittedAt.localeCompare(a.latestSubmittedAt)),
      };
    });
  }, [learnerGroups]);

  const recordColumns: ManageTableColumn<LearningRecordItem>[] = [
    {
      id: 'record_id',
      header: 'Record ID',
      headerClassName: 'w-[22%] px-4 py-3 text-left font-semibold text-slate-700',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (record) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{record.record_id}</div>
          <div className="mt-1 text-xs text-slate-400">{formatDateTimeForUser(record.submitted_at)}</div>
        </div>
      ),
    },
    {
      id: 'question_id',
      header: 'Question ID',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (record) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{record.question_id?.trim() || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">{record.slide_title?.trim() || 'Unknown slide'}</div>
        </div>
      ),
    },
    {
      id: 'participant_id',
      header: 'Participant ID',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (record) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{record.learner_id?.trim() || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">{getLearnerDisplayName(record)}</div>
        </div>
      ),
    },
    {
      id: 'score',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Score',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-700',
      renderCell: (record) => <span className="font-medium">{toDisplayScoreLabel(record.final_score, record.final_score_max)}</span>,
    },
  ];

  const learnerColumns: ManageTableColumn<LearnerGroup>[] = [
    {
      id: 'learner_id',
      header: 'Learner ID',
      headerClassName: 'w-[28%] px-4 py-3 text-left font-semibold text-slate-700',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (group) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{group.learnerId}</div>
          <div className="mt-1 text-xs text-slate-400">{group.learnerName}</div>
        </div>
      ),
    },
    {
      id: 'latest_record',
      header: 'Latest Record',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (group) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{group.records[0]?.record_id || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">{formatDateTimeForUser(group.records[0]?.submitted_at)}</div>
        </div>
      ),
    },
    {
      id: 'latest_question',
      header: 'Latest Question',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (group) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{group.records[0]?.question_id?.trim() || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">{getQuestionDisplay(group.records[0])}</div>
        </div>
      ),
    },
    {
      id: 'count',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Count',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-700',
      renderCell: (group) => <span className="font-medium">{group.records.length}</span>,
    },
  ];

  const questionColumns: ManageTableColumn<QuestionGroup>[] = [
    {
      id: 'question_id',
      header: 'Question ID',
      headerClassName: 'w-[28%] px-4 py-3 text-left font-semibold text-slate-700',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (group) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{group.questionId}</div>
          <div className="mt-1 text-xs text-slate-400">{group.questionPreview}</div>
        </div>
      ),
    },
    {
      id: 'latest_record',
      header: 'Latest Record',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (group) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{group.records[0]?.record_id || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">{formatDateTimeForUser(group.records[0]?.submitted_at)}</div>
        </div>
      ),
    },
    {
      id: 'latest_participant',
      header: 'Latest Participant',
      cellClassName: 'px-4 py-3 align-middle',
      renderCell: (group) => (
        <div>
          <div className="font-mono text-xs text-slate-600">{group.records[0]?.learner_id?.trim() || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">{getLearnerDisplayName(group.records[0])}</div>
        </div>
      ),
    },
    {
      id: 'count',
      headerClassName: 'w-[1%] whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700',
      header: 'Count',
      cellClassName: 'w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-700',
      renderCell: (group) => <span className="font-medium">{group.records.length}</span>,
    },
  ];

  if (isPermissionChecking || !hasManagePermission) {
    return null;
  }

  const handleCourseSelect = (courseId: string) => {
    setSearchQuery('');
    setActiveView('records');
    setSelectedLearnerId('all');
    setShowQuizLinkedOnly(false);
    setRecords([]);
    setNextCursor(null);
    setHasMoreRecords(false);
    router.push(`/manage/record${buildSelectedCourseSearch(new URLSearchParams(searchParams.toString()), courseId)}`);
  };

  const handleCourseReset = () => {
    setSearchQuery('');
    setActiveView('records');
    setSelectedLearnerId('all');
    setShowQuizLinkedOnly(false);
    setRecords([]);
    setNextCursor(null);
    setHasMoreRecords(false);
    router.push(`/manage/record${buildSelectedCourseSearch(new URLSearchParams(searchParams.toString()))}`);
  };

  const renderScoreSummary = () => {
    const scoredCount = filteredRecords.filter((record) => String(toScoreLabel(record.final_score, record.final_score_max)) !== 'Pending').length;
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Filtered Records</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{filteredRecords.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Learners</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{learnerGroups.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Scored Items</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{scoredCount}</p>
        </div>
      </div>
    );
  };

  const renderRecordSubTable = (items: LearningRecordItem[], keyPrefix: string) => (
    <ManageDataTable
      rows={items}
      rowKey={(record) => `${keyPrefix}-${record.record_id}`}
      columns={recordColumns}
      rowClassName="transition-colors hover:bg-slate-50/70"
      wrapperClassName="overflow-hidden rounded-2xl border border-slate-200 bg-white"
      emptyContent="No grouped records available."
      expandableRows={{
        getRowId: (record) => `${keyPrefix}-${record.record_id}`,
        renderExpandedContent: (record) => renderExpandedRecordContent(record),
      }}
    />
  );

  const renderViewContent = () => {
    if (recordsError) {
      return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{recordsError}</div>;
    }

    if (isFetchingRecords) {
      return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">Loading learning records...</div>;
    }

    if (filteredRecords.length === 0) {
      return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">No learning records match the current filters.</div>;
    }

    if (activeView === 'records') {
      return (
        <ManageDataTable
          rows={filteredRecords}
          rowKey={(record) => record.record_id}
          columns={recordColumns}
          rowClassName="transition-colors hover:bg-slate-50/70"
          emptyContent="No learning records match the current filters."
          expandableRows={{
            getRowId: (record) => record.record_id,
            renderExpandedContent: (record) => renderExpandedRecordContent(record),
          }}
        />
      );
    }

    if (activeView === 'learner') {
      return (
        <ManageDataTable
          rows={learnerGroups}
          rowKey={(group) => group.learnerKey}
          columns={learnerColumns}
          rowClassName="transition-colors hover:bg-slate-50/70"
          emptyContent="No learning records match the current filters."
          expandableRows={{
            getRowId: (group) => group.learnerKey,
            renderExpandedContent: (group) => renderRecordSubTable(group.records, `learner-${group.learnerKey}`),
          }}
        />
      );
    }

    if (activeView === 'question') {
      return (
        <ManageDataTable
          rows={questionGroups}
          rowKey={(group) => group.questionKey}
          columns={questionColumns}
          rowClassName="transition-colors hover:bg-slate-50/70"
          emptyContent="No learning records match the current filters."
          expandableRows={{
            getRowId: (group) => group.questionKey,
            renderExpandedContent: (group) => renderRecordSubTable(group.records, `question-${group.questionKey}`),
          }}
        />
      );
    }

    return (
      <ManageDataTable
        rows={learnerQuestionGroups}
        rowKey={(group) => group.learnerKey}
        columns={learnerColumns}
        rowClassName="transition-colors hover:bg-slate-50/70"
        emptyContent="No learning records match the current filters."
        expandableRows={{
          getRowId: (group) => group.learnerKey,
          renderExpandedContent: (learnerGroup) => (
            <ManageDataTable
              rows={learnerGroup.questionGroups}
              rowKey={(group) => `${learnerGroup.learnerKey}-${group.questionKey}`}
              columns={questionColumns}
              rowClassName="transition-colors hover:bg-slate-50/70"
              wrapperClassName="overflow-hidden rounded-2xl border border-slate-200 bg-white"
              emptyContent="No grouped questions available."
              expandableRows={{
                getRowId: (group) => `${learnerGroup.learnerKey}-${group.questionKey}`,
                renderExpandedContent: (group) =>
                  renderRecordSubTable(group.records, `learner-question-${learnerGroup.learnerKey}-${group.questionKey}`),
              }}
            />
          ),
        }}
      />
    );
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
        <section>
          <ManageBreadcrumb />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <div className="flex flex-col gap-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Learning Record Management</p>
              <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
                {selectedCourse ? selectedCourse.course_title || 'Selected Course' : 'Select a Course'}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                {selectedCourse
                  ? 'Switch between record, learner, question, and learner-question views over the same answer stream.'
                  : 'Start by selecting a course. Learning records are scoped to the selected course and loaded from the new learning-records API.'}
              </p>
            </div>

            {selectedCourse ? (
              renderScoreSummary()
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  {isFetchingCourses ? 'Loading courses...' : `${courses.length} course${courses.length === 1 ? '' : 's'} available`}
                </span>
                <Link href="/manage/course" className="text-blue-700 underline-offset-4 hover:underline">
                  Manage courses
                </Link>
              </div>
            )}
          </div>
        </section>

        {!selectedCourse ? (
          <ManageListPanel
            toolbarLeft={(
              <div>
                <p className="text-sm font-medium text-slate-900">Course Selection</p>
                <p className="mt-1 text-sm text-slate-500">Choose the course whose slide questions and learner answers you want to inspect.</p>
              </div>
            )}
            toolbarRight={(
              <>
                <div className="relative w-full md:w-96">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search title or description..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-300"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
                </div>
                <ActionButton onClick={() => fetchCourses()} variant="neutral" size="sm" className="rounded-xl">
                  {isFetchingCourses ? 'Refreshing...' : 'Refresh'}
                </ActionButton>
              </>
            )}
            table={(
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {courseSelectionRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                    {searchQuery.trim() ? 'No matching courses found.' : 'No courses available.'}
                  </div>
                ) : (
                  courseSelectionRows.map((course) => (
                    <button
                      key={course.course_id}
                      type="button"
                      onClick={() => handleCourseSelect(course.course_id)}
                      className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Course</p>
                      <h2 className="mt-3 line-clamp-2 text-lg font-semibold text-slate-900 group-hover:text-sky-700">
                        {course.course_title || '(Untitled course)'}
                      </h2>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                        {course.course_description?.trim() || 'No description available.'}
                      </p>
                      <div className="mt-5 flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-slate-400">{course.course_id}</span>
                        <span className="font-medium text-sky-700">Select</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
            summary={<p className="text-center text-sm text-slate-500">Showing {courseSelectionRows.length} of {courses.length} courses</p>}
          />
        ) : (
          <ManageListPanel
            toolbarLeft={(
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Learning Records</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Current scope: <span className="font-medium text-slate-700">{selectedCourse.course_title || 'Selected course'}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {VIEW_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setActiveView(option.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                        activeView === option.id
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            toolbarRight={(
              <>
                <div className="relative w-full md:w-80">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search learner, question, answer..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-300"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
                </div>
                <select
                  value={selectedLearnerId}
                  onChange={(e) => setSelectedLearnerId(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-slate-300"
                >
                  <option value="all">All Learners</option>
                  {learnerOptions.map((learnerId) => (
                    <option key={learnerId} value={learnerId}>
                      {learnerId}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                  <input
                    type="checkbox"
                    checked={showQuizLinkedOnly}
                    onChange={(e) => setShowQuizLinkedOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
                  />
                  <span>Quiz Linked Only</span>
                </label>
                <ActionButton onClick={handleCourseReset} variant="neutral" size="sm" className="rounded-xl">
                  Change Course
                </ActionButton>
              </>
            )}
            table={renderViewContent()}
            summary={(
              <div className="flex flex-col items-center gap-3">
                <p className="text-center text-sm text-slate-500">
                  Showing {filteredRecords.length} of {records.length} record{records.length === 1 ? '' : 's'} for {selectedCourse.course_title || 'the selected course'}
                </p>
                {hasMoreRecords ? (
                  <ActionButton
                    onClick={() => fetchLearningRecords(nextCursor, true)}
                    variant="neutral"
                    size="sm"
                    className="rounded-xl"
                    disabled={isFetchingMore}
                  >
                    {isFetchingMore ? 'Loading more...' : 'Load More'}
                  </ActionButton>
                ) : null}
              </div>
            )}
          />
        )}
      </div>
    </main>
  );
}
