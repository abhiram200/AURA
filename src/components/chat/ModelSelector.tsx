import { useState, useEffect, useRef } from 'react';
import type { OllamaModel } from '../../hooks/useSettings';

interface ModelSelectorProps {
  models: OllamaModel[];
  currentModel: string;
  onModelChange: (model: string) => void;
}

export function ModelSelector({ models, currentModel, onModelChange }: ModelSelectorProps) {
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

  const displayName = currentModel || 'No model';
  const chatModels = models.filter(m => !m.isEmbedding);

  return (
    <div className="model-selector" ref={ref}>
      <button
        className="model-selector__button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="model-selector__label">{displayName}</span>
        <span className={`model-selector__arrow ${open ? 'model-selector__arrow--open' : ''}`}>
          &#9662;
        </span>
      </button>
      {open && (
        <ul className="model-selector__dropdown" role="listbox">
          {chatModels.map((model) => (
            <li
              key={model.name}
              className={`model-selector__option ${
                model.name === currentModel ? 'model-selector__option--active' : ''
              }`}
              role="option"
              aria-selected={model.name === currentModel}
              onClick={() => {
                onModelChange(model.name);
                setOpen(false);
              }}
            >
              {model.name}
            </li>
          ))}
          {chatModels.length === 0 && (
            <li className="model-selector__option model-selector__option--empty">
              No models available
            </li>
          )}
        </ul>
      )}
    </div>
  );
}