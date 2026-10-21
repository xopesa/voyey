"use client";

import { useId } from "react";

type ChoiceGroupProps<Value extends string> = {
  label: string;
  value: Value;
  options: ReadonlyArray<{
    value: Value;
    label: string;
    accessibleLabel?: string;
  }>;
  onChange: (value: Value) => void;
};

export function ChoiceGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
}: ChoiceGroupProps<Value>) {
  const name = useId();
  return (
    <fieldset className="ui-choice-group">
      <legend className="ui-choice-group__legend">{label}</legend>
      <div className="ui-choice-group__options">
        {options.map((option) => (
          <label key={option.value} className="ui-choice-group__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              aria-label={option.accessibleLabel ?? option.label}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
