'use client';

import React from 'react';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'neutral'
  | 'ghost';

type ButtonSize = 'sm' | 'md';

type ActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClassMap: Record<ButtonVariant, string> = {
  primary: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200',
  secondary: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200',
  success: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200',
  danger: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200',
  warning: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200',
  neutral: 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200',
  ghost: 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300',
};

const sizeClassMap: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3 py-2 text-sm',
};

export default function ActionButton({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled,
  children,
  ...props
}: ActionButtonProps) {
  const disabledClasses = disabled
    ? 'opacity-60 cursor-not-allowed pointer-events-none shadow-none'
    : 'shadow-sm hover:shadow transition-all duration-150';

  return (
    <button
      {...props}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md font-medium ${sizeClassMap[size]} ${variantClassMap[variant]} ${disabledClasses} ${className}`.trim()}
    >
      {children}
    </button>
  );
}
