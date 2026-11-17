import type { InputHTMLAttributes, ReactNode } from 'react';
import { joinClasses } from './join-classes';

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={joinClasses('ui-check small', className)}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
