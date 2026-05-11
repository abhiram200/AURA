import { useState, useEffect } from 'react';

interface SystemPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SystemPromptEditor({ value, onChange }: SystemPromptEditorProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="system-prompt-editor">
      <textarea
        className="system-prompt-editor__textarea"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          onChange(e.target.value);
        }}
        placeholder="e.g., Always respond in markdown format. Focus on practical examples. Avoid unnecessary preamble..."
        rows={4}
      />
    </div>
  );
}