import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <button className="code-block__copy" onClick={handleCopy}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

interface StreamingTextProps {
  content: string;
  isStreaming: boolean;
}

export function StreamingText({ content, isStreaming }: StreamingTextProps) {
  return (
    <div className="streaming-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const code = String(children).replace(/\n$/, '');

            if (match) {
              const lang = match[1];
              if (isStreaming) {
                return (
                  <div className="code-block">
                    <div className="code-block__header">
                      <span className="code-block__lang">{lang}</span>
                    </div>
                    <code className={`hljs ${className}`}>
                      {code}
                    </code>
                  </div>
                );
              }

              let highlighted = code;
              try {
                const result = hljs.highlight(code, { language: lang });
                highlighted = result.value;
              } catch {
                const result = hljs.highlightAuto(code);
                highlighted = result.value;
              }
              return (
                <div className="code-block">
                  <div className="code-block__header">
                    <span className="code-block__lang">{lang}</span>
                    <CopyButton code={code} />
                  </div>
                  <code
                    className={`hljs ${className}`}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                  />
                </div>
              );
            }
            return <code className="inline-code" {...props}>{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <motion.span
          className="streaming-cursor"
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, repeatType: 'reverse' }}
        >
          |
        </motion.span>
      )}
    </div>
  );
}