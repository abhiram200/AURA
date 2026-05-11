import type { OllamaModel } from '../../hooks/useSettings';
import { CustomSelect } from './CustomSelect';

interface ModelSelectionProps {
  models: OllamaModel[];
  defaultModel: string;
  onDefaultModelChange: (model: string) => void;
  filterEmbedding?: boolean;
}

export function ModelSelection({ models, defaultModel, onDefaultModelChange, filterEmbedding = false }: ModelSelectionProps) {
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

  const options = filteredModels.map((model) => ({
    value: model.name,
    label: model.name,
  }));

  const effectiveValue = defaultModel || filteredModels[0].name;

  return (
    <div className="model-selection">
      <CustomSelect
        options={options}
        value={effectiveValue}
        onChange={onDefaultModelChange}
        placeholder="Select a model"
      />
    </div>
  );
}