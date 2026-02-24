'use client';

import React, { useState } from 'react';

type RowClassName<T> = string | ((row: T, rowIndex: number) => string | undefined);
type CellClassName<T> = string | ((row: T, rowIndex: number) => string | undefined);

export interface ManageTableColumn<T> {
  id: string;
  header: React.ReactNode;
  headerClassName?: string;
  cellClassName?: CellClassName<T>;
  renderCell: (row: T, rowIndex: number) => React.ReactNode;
}

export interface ManageTableExpandableRows<T> {
  getRowId: (row: T, rowIndex: number) => string;
  renderExpandedContent: (row: T, rowIndex: number) => React.ReactNode;
  isRowExpandable?: (row: T, rowIndex: number) => boolean;
  initialExpandedRowIds?: string[];
  toggleAriaLabel?: (row: T, rowIndex: number, isExpanded: boolean) => string;
}

interface ManageDataTableProps<T> {
  rows: T[];
  rowKey: (row: T, rowIndex: number) => string;
  columns: ManageTableColumn<T>[];
  emptyContent?: React.ReactNode;
  rowClassName?: RowClassName<T>;
  wrapperClassName?: string;
  tableClassName?: string;
  theadClassName?: string;
  tbodyClassName?: string;
  emptyCellClassName?: string;
  expandableRows?: ManageTableExpandableRows<T>;
}

const getClassName = <T,>(
  value: string | ((row: T, rowIndex: number) => string | undefined) | undefined,
  row: T,
  rowIndex: number
) => {
  if (!value) return '';
  return typeof value === 'function' ? value(row, rowIndex) ?? '' : value;
};

export default function ManageDataTable<T>({
  rows,
  rowKey,
  columns,
  emptyContent = 'No data available.',
  rowClassName,
  wrapperClassName = 'overflow-hidden rounded-2xl border border-slate-200',
  tableClassName = 'min-w-full divide-y divide-slate-200 text-sm',
  theadClassName = 'bg-slate-50',
  tbodyClassName = 'divide-y divide-slate-100 bg-white',
  emptyCellClassName = 'px-4 py-10 text-center text-slate-500',
  expandableRows,
}: ManageDataTableProps<T>) {
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(
    () => new Set(expandableRows?.initialExpandedRowIds ?? [])
  );

  const totalColumns = columns.length + (expandableRows ? 1 : 0);

  const toggleRow = (rowId: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  return (
    <div className={wrapperClassName}>
      <div className="overflow-x-auto">
        <table className={tableClassName}>
          <thead className={theadClassName}>
            <tr>
              {expandableRows ? (
                <th className="w-[1%] whitespace-nowrap px-2 py-3 text-left font-semibold text-slate-700" />
              ) : null}
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={column.headerClassName ?? 'px-4 py-3 text-left font-semibold text-slate-700'}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={tbodyClassName}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={totalColumns} className={emptyCellClassName}>
                  {emptyContent}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const key = rowKey(row, rowIndex);
                const expandable = Boolean(expandableRows?.isRowExpandable?.(row, rowIndex) ?? expandableRows);
                const rowId = expandableRows ? expandableRows.getRowId(row, rowIndex) : key;
                const isExpanded = expandable && expandedRowIds.has(rowId);

                return (
                  <React.Fragment key={key}>
                    <tr className={getClassName(rowClassName, row, rowIndex)}>
                      {expandableRows ? (
                        <td className="w-[1%] whitespace-nowrap px-2 py-3 align-middle">
                          {expandable ? (
                            <button
                              type="button"
                              onClick={() => toggleRow(rowId)}
                              aria-expanded={isExpanded}
                              aria-label={
                                expandableRows.toggleAriaLabel?.(row, rowIndex, isExpanded) ??
                                (isExpanded ? 'Collapse row details' : 'Expand row details')
                              }
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                            >
                              <span aria-hidden="true" className="text-xs">
                                {isExpanded ? '▾' : '▸'}
                              </span>
                            </button>
                          ) : (
                            <span className="block h-7 w-7" aria-hidden="true" />
                          )}
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td
                          key={column.id}
                          className={
                            getClassName(column.cellClassName, row, rowIndex) ||
                            'px-4 py-3 align-middle text-slate-700'
                          }
                        >
                          {column.renderCell(row, rowIndex)}
                        </td>
                      ))}
                    </tr>
                    {expandableRows && expandable && isExpanded ? (
                      <tr className="bg-slate-50/70">
                        <td colSpan={totalColumns} className="px-4 py-4 text-sm text-slate-600">
                          {expandableRows.renderExpandedContent(row, rowIndex)}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
