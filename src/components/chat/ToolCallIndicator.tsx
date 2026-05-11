import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ToolCallIndicatorProps {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  isLoading?: boolean;
}

export function ToolCallIndicator({ name, args, result, isLoading }: ToolCallIndicatorProps) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (result) {
      setExpanded(false);
    }
  }, [result]);

  const isExecuting = isLoading && !result;
  const hasArgs = args && Object.keys(args).length > 0;

  return (
    <div className={`tool-call-indicator ${isExecuting ? 'tool-call-indicator--loading' : ''}`}>
      <button className="tool-call-indicator__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-indicator__toggle">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-indicator__label">
          {isExecuting ? 'Using' : 'Used'}:
        </span>
        <span className="tool-call-indicator__name">{name}</span>
        {isExecuting && <span className="tool-call-indicator__spinner" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="tool-call-indicator__content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {hasArgs && (
              <pre className="tool-call-indicator__args">{JSON.stringify(args, null, 2)}</pre>
            )}
            {result && (
              <div className="tool-call-indicator__result">
                <span className="tool-call-indicator__result-label">Result:</span>
                <span className="tool-call-indicator__result-text">{result}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}