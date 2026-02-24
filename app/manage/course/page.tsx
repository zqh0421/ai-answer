'use client';

import axios from 'axios';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import ActionButton from '@/app/components/ActionButton';
import ManageListPanel from '@/app/components/manage/ManageListPanel';
import { Course } from '@/app/types';
import { buildStaticPageTitle } from '@/app/utils/title';

type SortKey = 'course_title' | 'course_description' | 'created_at';
type SortDirection = 'asc' | 'desc';
type PaginationToken = number | 'ellipsis';

const PAGE_SIZE = 20;
const DESCRIPTION_PREVIEW_LENGTH = 100;

const formatCreatedAt = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const getSortValue = (course: Course, key: SortKey) => {
  if (key === 'created_at') return String(course.created_at ?? '');
  if (key === 'course_description') return String(course.course_description ?? '');
  return String(course.course_title ?? '');
};

const getPaginationTokens = (currentPage: number, totalPages: number): PaginationToken[] => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: PaginationToken[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) tokens.push('ellipsis');
  for (let page = start; page <= end; page += 1) tokens.push(page);
  if (end < totalPages - 1) tokens.push('ellipsis');

  tokens.push(totalPages);
  return tokens;
};

const parseCoursesResponse = (data: unknown, requestedPage: number) => {
  if (Array.isArray(data)) {
    return {
      items: data as Course[],
      total: data.length,
      page: 1,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(data.length / PAGE_SIZE)),
      hasPaginationMeta: false,
    };
  }

  if (!data || typeof data !== 'object') {
    return {
      items: [] as Course[],
      total: 0,
      page: requestedPage,
      pageSize: PAGE_SIZE,
      totalPages: 1,
      hasPaginationMeta: false,
    };
  }

  const payload = data as Record<string, unknown>;
  const itemsCandidate =
    payload.items ?? payload.courses ?? payload.data ?? payload.results ?? payload.rows;
  const items = Array.isArray(itemsCandidate) ? (itemsCandidate as Course[]) : [];

  const totalCandidate = payload.total ?? payload.count ?? payload.total_count;
  const parsedTotal = typeof totalCandidate === 'number' ? totalCandidate : items.length;

  const pageCandidate = payload.page ?? payload.current_page;
  const parsedPage =
    typeof pageCandidate === 'number' && pageCandidate > 0 ? Math.floor(pageCandidate) : requestedPage;

  const pageSizeCandidate = payload.page_size ?? payload.pageSize ?? payload.per_page ?? payload.limit;
  const parsedPageSize =
    typeof pageSizeCandidate === 'number' && pageSizeCandidate > 0
      ? Math.floor(pageSizeCandidate)
      : PAGE_SIZE;

  const totalPagesCandidate = payload.total_pages ?? payload.totalPages;
  const parsedTotalPages =
    typeof totalPagesCandidate === 'number' && totalPagesCandidate > 0
      ? Math.floor(totalPagesCandidate)
      : Math.max(1, Math.ceil(parsedTotal / parsedPageSize));

  return {
    items,
    total: parsedTotal,
    page: parsedPage,
    pageSize: parsedPageSize,
    totalPages: parsedTotalPages,
    hasPaginationMeta:
      typeof totalCandidate === 'number' ||
      typeof totalPagesCandidate === 'number' ||
      typeof pageCandidate === 'number' ||
      typeof pageSizeCandidate === 'number',
  };
};

const CourseOverview = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isFetchingCourses, setIsFetchingCourses] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCourses, setTotalCourses] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({});
  const { data: session, status: sessionStatus } = useSession();
  const creatorEmail = session?.user?.email;
  const searchParams = useSearchParams();
  const isDeepLinkMode = searchParams.get('lti_mode') === 'deep_link';
  const launchId = searchParams.get('launch_id');
  const ltiLaunchId = searchParams.get('lti_launch_id');
  const ltiUserId = searchParams.get('lti_user_id');
  const normalizedSearch = searchQuery.trim().toLowerCase();

  useEffect(() => {
    document.title = buildStaticPageTitle('Course Management');
  }, []);

  const ltiParams = new URLSearchParams();
  if (isDeepLinkMode) {
    ltiParams.set('lti_mode', 'deep_link');
    if (launchId) ltiParams.set('launch_id', launchId);
    if (ltiLaunchId) ltiParams.set('lti_launch_id', ltiLaunchId);
    if (ltiUserId) ltiParams.set('lti_user_id', ltiUserId);
  }
  const ltiQuery = ltiParams.toString() ? `?${ltiParams.toString()}` : '';

  const fetchCourses = useCallback(async (page = currentPage) => {
    if (!creatorEmail) return;
    setIsFetchingCourses(true);
    try {
      const res = await axios.get(`/api/courses/createdby/${creatorEmail}`, {
        params: {
          page,
          page_size: PAGE_SIZE,
          per_page: PAGE_SIZE,
          search: normalizedSearch || undefined,
          sort_key: sortKey,
          sort_direction: sortDirection,
        },
      });
      const parsed = parseCoursesResponse(res.data, page);
      setCourses(parsed.items);
      setTotalCourses(parsed.total);
      setTotalPages(parsed.totalPages);

      if (parsed.totalPages > 0 && page > parsed.totalPages) {
        setCurrentPage(parsed.totalPages);
      }
    } catch (err) {
      console.error('Error fetching courses:', err);
      setCourses([]);
      setTotalCourses(0);
      setTotalPages(1);
    } finally {
      setIsFetchingCourses(false);
    }
  }, [creatorEmail, currentPage, normalizedSearch, sortDirection, sortKey]);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    fetchCourses(currentPage);
  }, [currentPage, fetchCourses, sessionStatus]);

  const handleCreateCourse = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post('/api/courses/create', {
        title: newCourseTitle,
        description: newCourseDescription,
        creater_id: '1',
      });

      if (res.status === 200 || res.status === 201) {
        if (currentPage !== 1) {
          setCurrentPage(1);
        } else {
          await fetchCourses(1);
        }
        setNewCourseTitle('');
        setNewCourseDescription('');
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error('Error creating course:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    const confirmDelete = window.confirm('Are you sure you want to delete this course?');
    if (!confirmDelete) return;

    setDeleting(courseId);
    try {
      const res = await axios.delete(`/api/courses/by_id/${courseId}`);
      if (res.status === 200 || res.status === 204) {
        await fetchCourses(currentPage);
      }
    } catch (error) {
      console.error('Error deleting course:', error);
    } finally {
      setDeleting(null);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      setCurrentPage(1);
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'created_at' ? 'desc' : 'asc');
    setCurrentPage(1);
  };

  const filteredCourses = courses.filter((course) => {
    if (!normalizedSearch) return true;
    const title = String(course.course_title ?? '').toLowerCase();
    const description = String(course.course_description ?? '').toLowerCase();
    return title.includes(normalizedSearch) || description.includes(normalizedSearch);
  });

  const sortedCourses = [...filteredCourses].sort((a, b) => {
    const aValue = getSortValue(a, sortKey).toLowerCase();
    const bValue = getSortValue(b, sortKey).toLowerCase();
    const base = aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
    return sortDirection === 'asc' ? base : -base;
  });

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const toggleDescriptionExpanded = (courseId: string) => {
    setExpandedDescriptions((prev) => ({
      ...prev,
      [courseId]: !prev[courseId],
    }));
  };

  const paginationTokens = getPaginationTokens(currentPage, totalPages);
  const displayedCount = sortedCourses.length;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <div className="flex flex-col gap-4 md:items-start">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Course Management
              </p>
              <h1 className="mt-3 break-words text-2xl font-bold text-slate-900 md:text-3xl">
                Your Courses
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
                Browse, search, sort, and manage course content from one place.
              </p>
            </div>
          </div>
        </section>

        <ManageListPanel
          toolbarLeft={(
            <ActionButton
              onClick={() => setIsModalOpen(true)}
              variant="primary"
              className="rounded-lg px-3.5 py-2"
            >
              Create Course
            </ActionButton>
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
                  placeholder="Search title or description..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-300"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  ⌕
                </span>
              </div>
              <ActionButton
                onClick={() => fetchCourses(currentPage)}
                variant="neutral"
                size="sm"
                className="rounded-xl"
              >
                {isFetchingCourses ? 'Refreshing...' : 'Refresh'}
              </ActionButton>
            </>
          )}
          table={(
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="w-[28%] px-4 py-3 text-left font-semibold text-slate-700">
                        <button
                          type="button"
                          onClick={() => handleSort('course_title')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          Title
                          <span className="text-slate-400">{sortIndicator('course_title')}</span>
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        <button
                          type="button"
                          onClick={() => handleSort('course_description')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          Description
                          <span className="text-slate-400">{sortIndicator('course_description')}</span>
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
                      <th className="w-[1%] whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {sortedCourses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                          {normalizedSearch ? 'No matching courses found.' : 'No courses available.'}
                        </td>
                      </tr>
                    ) : (
                      sortedCourses.map((course, index) => (
                        <tr
                          key={course.course_id || `course-${index}-${course.course_title}`}
                          className="transition-colors hover:bg-slate-50/70"
                        >
                          <td className="px-4 py-3 align-middle">
                            <Link
                              href={`/manage/course/${course.course_id}${ltiQuery}`}
                              className="font-medium text-slate-900 underline-offset-4 hover:text-blue-700 hover:underline"
                            >
                              {course.course_title || '(Untitled course)'}
                            </Link>
                          </td>
                          <td className="w-full px-4 py-3 align-middle text-slate-600">
                            {(() => {
                              const description = course.course_description?.trim() || '';
                              if (!description) return <span>No description</span>;

                              const isExpanded = Boolean(expandedDescriptions[course.course_id]);
                              const shouldTruncate = description.length > DESCRIPTION_PREVIEW_LENGTH;
                              const preview = `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH)}...`;

                              return (
                                <div>
                                  <span>{isExpanded || !shouldTruncate ? description : preview}</span>
                                  {shouldTruncate ? (
                                    <>
                                      {'\u00A0\u00A0\u00A0'}
                                      <button
                                        type="button"
                                        onClick={() => toggleDescriptionExpanded(course.course_id)}
                                        className="inline text-xs text-blue-600 hover:text-blue-700"
                                      >
                                        {isExpanded ? 'Show less' : 'Show More'}
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="w-[1%] whitespace-nowrap px-4 py-3 align-middle text-slate-600">
                            {formatCreatedAt(course.created_at)}
                          </td>
                          <td className="w-[1%] whitespace-nowrap px-4 py-3 align-middle">
                            <div className="flex justify-end gap-2">
                              <Link href={`/manage/course/${course.course_id}${ltiQuery}`}>
                                <ActionButton variant="ghost" size="sm" className="rounded-lg">
                                  Open
                                </ActionButton>
                              </Link>
                              <ActionButton
                                onClick={() => handleDeleteCourse(course.course_id)}
                                variant="danger"
                                size="sm"
                                className="rounded-lg"
                                disabled={deleting === course.course_id}
                              >
                                {deleting === course.course_id ? 'Deleting...' : 'Delete'}
                              </ActionButton>
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
            isLoading: isFetchingCourses,
            onPrev: () => setCurrentPage((prev) => Math.max(1, prev - 1)),
            onNext: () => setCurrentPage((prev) => Math.min(totalPages, prev + 1)),
            onPageSelect: (page) => setCurrentPage(page),
          }}
          summary={(
            <p className="text-center text-sm text-slate-500">
              Showing {displayedCount} item{displayedCount === 1 ? '' : 's'} of {totalCourses} total
              {' '}({normalizedSearch ? 'filtered, ' : ''}page {currentPage} of {totalPages}, {PAGE_SIZE} per page)
            </p>
          )}
        />

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-slate-900">Create New Course</h2>
                <p className="mt-1 text-sm text-slate-500">Add a title and optional description for your course.</p>
              </div>

              <form onSubmit={handleCreateCourse} className="space-y-4">
                <div>
                  <label htmlFor="courseTitle" className="mb-1 block text-sm font-medium text-slate-700">
                    Course Title
                  </label>
                  <input
                    id="courseTitle"
                    type="text"
                    value={newCourseTitle}
                    onChange={(e) => setNewCourseTitle(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="courseDescription" className="mb-1 block text-sm font-medium text-slate-700">
                    Course Description
                  </label>
                  <textarea
                    id="courseDescription"
                    value={newCourseDescription}
                    onChange={(e) => setNewCourseDescription(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <ActionButton
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    variant="ghost"
                    className="rounded-lg"
                  >
                    Cancel
                  </ActionButton>
                  <ActionButton
                    type="submit"
                    disabled={loading || !newCourseTitle.trim()}
                    variant="primary"
                    className="rounded-lg"
                  >
                    {loading ? 'Creating...' : 'Create Course'}
                  </ActionButton>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default CourseOverview;
