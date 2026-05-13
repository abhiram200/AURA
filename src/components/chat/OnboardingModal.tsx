import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { UserPreferences } from '../../hooks/useSettings';

interface OnboardingModalProps {
  open: boolean;
  onComplete: (preferences: UserPreferences) => void;
  onSkip: () => void;
}

interface Step {
  key: keyof UserPreferences;
  question: string;
  type: 'select' | 'text';
  options?: { value: string; label: string }[];
}

const STEPS: Step[] = [
  {
    key: 'responseDetail',
    question: 'How detailed should responses be?',
    type: 'select',
    options: [
      { value: 'brief', label: 'Brief & concise' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'thorough', label: 'Thorough & detailed' },
    ],
  },
  {
    key: 'technicalLevel',
    question: 'What is your technical level?',
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
    question: 'Preferred response format?',
    type: 'select',
    options: [
      { value: 'code-first', label: 'Code-first' },
      { value: 'explanation-first', label: 'Explanation-first' },
      { value: 'balanced', label: 'Balanced' },
    ],
  },
  {
    key: 'domains',
    question: 'What domains are you most interested in?',
    type: 'text',
  },
  {
    key: 'personality',
    question: 'What personality style do you prefer?',
    type: 'select',
    options: [
      { value: 'friendly', label: 'Friendly & casual' },
      { value: 'professional', label: 'Professional & formal' },
      { value: 'witty', label: 'Witty & playful' },
      { value: 'direct', label: 'Direct & no-nonsense' },
      { value: 'adaptable', label: 'Adaptable' },
    ],
  },
  {
    key: 'proactiveness',
    question: 'How proactive should the AI be?',
    type: 'select',
    options: [
      { value: 'answer-only', label: 'Answer only what\'s asked' },
      { value: 'suggest', label: 'Suggest alternatives' },
      { value: 'proactive', label: 'Actively offer ideas' },
    ],
  },
  {
    key: 'languageStyle',
    question: 'Preferred language style?',
    type: 'select',
    options: [
      { value: 'simple', label: 'Simple & jargon-free' },
      { value: 'technical-explained', label: 'Technical with explanations' },
      { value: 'technical-concise', label: 'Technical, skip explanations' },
    ],
  },
  {
    key: 'useOfExamples',
    question: 'How should examples be used?',
    type: 'select',
    options: [
      { value: 'analogies', label: 'Analogies' },
      { value: 'code-examples', label: 'Code examples' },
      { value: 'walkthroughs', label: 'Walkthroughs' },
      { value: 'minimal', label: 'Minimal examples' },
    ],
  },
];

export function OnboardingModal({ open, onComplete, onSkip }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [preferences, setPreferences] = useState<UserPreferences>({
    responseDetail: null,
    technicalLevel: null,
    responseFormat: null,
    domains: null,
    personality: null,
    proactiveness: null,
    languageStyle: null,
    useOfExamples: null,
  });

  if (!open) return null;

  const currentStep = STEPS[step];
  const totalSteps = STEPS.length;

  function handleSelect(value: string) {
    const updated = { ...preferences, [currentStep.key]: value };
    setPreferences(updated);
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      onComplete(updated);
    }
  }

  function handleTextSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const value = (formData.get('domain-text') as string)?.trim() || null;
    const updated = { ...preferences, [currentStep.key]: value };
    setPreferences(updated);
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      onComplete(updated);
    }
  }

  function handleSkip() {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      onComplete(preferences);
    }
  }

  function handleSkipAll() {
    onSkip();
  }

  return (
    <div className="onboarding-overlay">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="onboarding-modal"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.25 }}
        >
          <div className="onboarding-modal__progress">{step + 1} / {totalSteps}</div>
          <h2 className="onboarding-modal__question">{currentStep.question}</h2>

          {currentStep.type === 'select' && currentStep.options && (
            <div className="onboarding-modal__options">
              {currentStep.options.map((option) => (
                <button
                  key={option.value}
                  className={`onboarding-modal__option ${
                    preferences[currentStep.key] === option.value ? 'onboarding-modal__option--selected' : ''
                  }`}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {currentStep.type === 'text' && (
            <form className="onboarding-modal__form" onSubmit={handleTextSubmit}>
              <input
                className="onboarding-modal__input"
                name="domain-text"
                type="text"
                placeholder="e.g. web development, data science, DevOps..."
                autoFocus
              />
              <button className="onboarding-modal__submit" type="submit">Next</button>
            </form>
          )}

          <div className="onboarding-modal__actions">
            <button className="onboarding-modal__skip" onClick={handleSkip}>
              Skip
            </button>
            <button className="onboarding-modal__skip-all" onClick={handleSkipAll}>
              Skip All
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}