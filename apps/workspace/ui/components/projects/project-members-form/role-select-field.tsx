'use client'

import type { JSX } from 'react'
import { FieldShell, useFieldContext } from '@/components/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProjectRole } from './member-types'

interface RoleSelectFieldProps {
  label: string
  options: Array<{ value: ProjectRole; label: string; description: string }>
  containerClassName?: string
}

export function RoleSelectField({
  label,
  options,
  containerClassName,
}: RoleSelectFieldProps): JSX.Element {
  const field = useFieldContext<ProjectRole>()
  const errors = field.state.meta.isTouched
    ? (field.state.meta.errors as Array<string | { message: string } | undefined>)
    : []
  const selectedLabel = options.find((option) => option.value === field.state.value)?.label

  return (
    <FieldShell label={label} htmlFor={field.name} errors={errors} className={containerClassName}>
      <Select
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value as ProjectRole)}
      >
        <SelectTrigger id={field.name} className="w-full" onBlur={field.handleBlur}>
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex flex-col gap-0.5 py-0.5 text-left">
                <span>{option.label}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {option.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}
