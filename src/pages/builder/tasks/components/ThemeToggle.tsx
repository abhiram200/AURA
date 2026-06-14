import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useTodoStore } from '../store/todoStore';
import { Tooltip } from './ui/Tooltip';

export function ThemeToggle() {
  const theme = useTodoStore((s) => s.theme);
  const toggleTheme = useTodoStore((s) => s.toggleTheme);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Detect system preference on first load
  useEffect(() => {
    const stored = localStorage.getItem('todo-app-storage');
    if (!stored) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      useTodoStore.getState().setTheme(prefersDark ? 'dark' : 'light');
    }
  }, []);

  return (
    <Tooltip content={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
      <button
        onClick={toggleTheme}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:bg-surface-raised hover:text-text transition-colors focus-ring"
        aria-label="Toggle theme"
      >
        <AnimatePresence mode="wait">
          {theme === 'light' ? (
            <motion.div
              key="sun"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Sun className="h-5 w-5" />
            </motion.div>
          ) : (
            <motion.div
              key="moon"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Moon className="h-5 w-5" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    </Tooltip>
  );
}