import type { UserPreferences as UserPreferencesType } from '../../hooks/useSettings';
import { CustomSelect } from './CustomSelect';

interface AIPreferencesProps {
  preferences: UserPreferencesType;
  onPreferenceChange: (key: keyof UserPreferencesType, value: string | null) => void;
  onReset: () => void;
}

const PREFERENCE_OPTIONS: {
  key: keyof UserPreferencesType;
  label: string;
  type: 'select' | 'text';
  options?: { value: string; label: string }[];
  placeholder?: string;
}[] = [
  {
    key: 'responseDetail',
    label: 'Response Detail',
    type: 'select',
    options: [
      { value: 'brief', label: 'Brief & concise' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'thorough', label: 'Thorough & detailed' },
    ],
  },
  {
    key: 'technicalLevel',
    label: 'Technical Level',
    type: 'select',
    options: [
      { value: 'beginner', label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
      { value: 'expert', label: 'Expert' },
    ],
  },
  {
    key: 'responseFormat',
    label: 'Response Format',
    type: 'select',
    options: [
      { value: 'code-first', label: 'Code-first' },
      { value: 'explanation-first', label: 'Explanation-first' },
      { value: 'balanced', label: 'Balanced' },
    ],
  },
  {
    key: 'domains',
    label: 'Domains',
    type: 'text',
    placeholder: 'e.g., web development, data science',
  },
  {
    key: 'personality',
    label: 'Personality',
    type: 'select',
    options: [
      { value: 'friendly', label: 'Friendly & casual' },
      { value: 'professional', label: 'Professional & formal' },
      { value: 'witty', label: 'Witty & playful' },
      { value: 'direct', label: 'Direct & no-nonsense' },
      { value: 'adaptable', label: 'Adaptable (matches your tone)' },
    ],
  },
  {
    key: 'proactiveness',
    label: 'Proactiveness',
    type: 'select',
    options: [
      { value: 'answer-only', label: 'Answer only what’s asked' },
      { value: 'suggest', label: 'Suggest alternatives & improvements' },
      { value: 'proactive', label: 'Actively offer ideas & next steps' },
    ],
  },
  {
    key: 'languageStyle',
    label: 'Language Style',
    type: 'select',
    options: [
      { value: 'simple', label: 'Simple & jargon-free' },
      { value: 'technical-explained', label: 'Technical with explanations' },
      { value: 'technical-concise', label: 'Technical, skip explanations' },
    ],
  },
  {
    key: 'useOfExamples',
    label: 'Use of Examples',
    type: 'select',
    options: [
      { value: 'analogies', label: 'Prefer analogies & metaphors' },
      { value: 'code-examples', label: 'Prefer code examples' },
      { value: 'walkthroughs', label: 'Prefer step-by-step walkthroughs' },
      { value: 'minimal', label: 'Minimal examples' },
    ],
  },
];

export function AIPreferences({ preferences, onPreferenceChange, onReset }: AIPreferencesProps) {
  return (
    <div className="ai-preferences">
      {PREFERENCE_OPTIONS.map(({ key, label, type, options, placeholder }) => (
        <div key={key} className="ai-preferences__row">
          <label className="ai-preferences__label">{label}</label>
          {type === 'text' ? (
            <input
              type="text"
              className="ai-preferences__input"
              value={preferences[key] ?? ''}
              onChange={(e) => onPreferenceChange(key, e.target.value || null)}
              placeholder={placeholder}
            />
          ) : (
            <CustomSelect
              options={[{ value: '', label: 'Default' }, ...(options ?? [])]}
              value={preferences[key] ?? ''}
              onChange={(v) => onPreferenceChange(key, v || null)}
              placeholder="Default"
            />
          )}
        </div>
      ))}
      <button className="ai-preferences__reset" onClick={onReset}>
        Reset to Defaults
      </button>
    </div>
  );
}