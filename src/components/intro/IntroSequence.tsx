import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnimationConfig } from '../../hooks/useAnimationConfig';
import { getTransition } from '../../hooks/useAnimationConfig';

interface IntroSequenceProps {
  onComplete: () => void;
}

export function IntroSequence({ onComplete }: IntroSequenceProps) {
  const [text, setText] = useState('');
  const fullText = 'A.U.R.A. ONLINE';
  const { animationIntensity } = useAnimationConfig();

  useEffect(() => {
    const typingSpeed = animationIntensity === 'subtle' ? 30 : animationIntensity === 'intense' ? 140 : 100;
    let i = 0;
    const typeInterval = setInterval(() => {
      i++;
      setText(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(typeInterval);
        const delay = animationIntensity === 'subtle' ? 300 : 1000;
        setTimeout(onComplete, delay);
      }
    }, typingSpeed);

    return () => clearInterval(typeInterval);
  }, [onComplete, animationIntensity]);

  return (
    <AnimatePresence>
      <motion.div
        className="intro-sequence"
        initial={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={getTransition(0.5, animationIntensity)}
      >
        <motion.div
          className="intro-text-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={getTransition(0.3, animationIntensity)}
        >
          <span className="online-dot-wrapper">
            <span className="online-dot" />
            <span className="online-dot-ripple" />
          </span>
          {text}
          {text.length < fullText.length && (
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.6, repeat: Infinity, repeatType: 'reverse' }}
            >
              _
            </motion.span>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}