import type { OllamaModel } from '../../hooks/useSettings';
import { CustomSelect } from './CustomSelect';

interface ModelSelectionProps {
  models: OllamaModel[];
  defaultModel: string;
  onDefaultModelChange: (model: string) => void;
  filterEmbedding?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export function ModelSelection({ models, defaultModel, onDefaultModelChange, filterEmbedding = false, allowEmpty = false, emptyLabel = 'None (auto-detect)' }: ModelSelectionProps) {
  const filteredModels = filterEmbedding ? models.filter(m => !m.isEmbedding) : models;

  if (filteredModels.length === 0) {
    return (
      <div className="model-selection">
        <CustomSelect
          options={[]}
          value=""
          onChange={() => {}}
          placeholder="No models available"
          disabled
        />
      </div>
    );
  }

  const options = [];

  // Add empty/none option when allowed (e.g. for vision model)
  if (allowEmpty) {
    options.push({ value: '', label: emptyLabel });
  }

  options.push(...filteredModels.map((model) => ({
    value: model.name,
    label: model.name,
  })));

  // When allowEmpty, use the actual saved value (which may be empty).
  // When not allowEmpty, fall back to first model as before.
  const effectiveValue = allowEmpty ? defaultModel : (defaultModel || filteredModels[0].name);

  return (
    <div className="model-selection">
      <CustomSelect
        options={options}
        value={effectiveValue}
        onChange={onDefaultModelChange}
        placeholder={allowEmpty ? emptyLabel : 'Select a model'}
      />
    </div>
  );
}