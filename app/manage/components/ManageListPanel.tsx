'use client';

import React from 'react';

type PaginationToken = number | 'ellipsis';

interface ManageListPanelProps {
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  table: React.ReactNode;
  summary?: React.ReactNode;
  className?: string;
  pagination?: {
    currentPage: number;
    totalPages: number;
    tokens: PaginationToken[];
    isLoading?: boolean;
    onPrev: () => void;
    onNext: () => void;
    onPageSelect: (page: number) => void;
  };
}

export default function ManageListPanel({
  toolbarLeft,
  toolbarRight,
  table,
  summary,
  className = '',
  pagination,
}: ManageListPanelProps) {
  return (
    <section className={`rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm ring-1 ring-white md:p-5 ${className}`.trim()}>
      {(toolbarLeft || toolbarRight) && (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">{toolbarLeft}</div>
          <div className="flex w-full items-center gap-2 md:w-auto">{toolbarRight}</div>
        </div>
      )}

      {table}

      {(pagination || summary) && (
        <div className="mt-4 flex flex-col gap-3">
          {pagination && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={pagination.onPrev}
                disabled={Boolean(pagination.isLoading) || pagination.currentPage <= 1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                &lt;-
              </button>
              {pagination.tokens.map((token, index) =>
                token === 'ellipsis' ? (
                  <span key={`ellipsis-${index}`} className="px-1 text-sm text-slate-400">
                    ...
                  </span>
                ) : (
                  <button
                    key={token}
                    type="button"
                    onClick={() => pagination.onPageSelect(token)}
                    disabled={Boolean(pagination.isLoading) || token === pagination.currentPage}
                    className={`min-w-9 rounded-lg border px-3 py-1.5 text-sm shadow-sm transition ${
                      token === pagination.currentPage
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                    } disabled:cursor-not-allowed`}
                  >
                    {token}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={pagination.onNext}
                disabled={Boolean(pagination.isLoading) || pagination.currentPage >= pagination.totalPages}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                -&gt;
              </button>
            </div>
          )}
          {summary}
        </div>
      )}
    </section>
  );
}
