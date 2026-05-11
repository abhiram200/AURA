import { useState, useEffect, useRef } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CustomSelect({ options, value, onChange, placeholder, disabled }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selected = options.find((opt) => opt.value === value);

  return (
    <div className="custom-select" ref={ref}>
      <button
        className={`custom-select__button${disabled ? ' custom-select__button--disabled' : ''}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        type="button"
        disabled={disabled}
      >
        <span className="custom-select__label">
          {selected ? selected.label : placeholder || 'Default'}
        </span>
        <span className={`custom-select__arrow ${open ? 'custom-select__arrow--open' : ''}`}>
          &#9662;
        </span>
      </button>
      {open && (
        <ul className="custom-select__dropdown" role="listbox">
          {options.map((opt) => (
            <li
              key={opt.value}
              className={`custom-select__option ${opt.value === value ? 'custom-select__option--active' : ''}`}
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}