import { useState, useEffect, useCallback, createContext, useContext } from 'react';

export type Theme = 'dark' | 'light';
export type AnimationIntensity = 'subtle' | 'normal' | 'intense';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  animationIntensity: AnimationIntensity;
  setAnimationIntensity: (intensity: AnimationIntensity) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  animationIntensity: 'normal',
  setAnimationIntensity: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  const [animationIntensity, setAnimationIntensity] = useState<AnimationIntensity>(() => {
    const saved = localStorage.getItem('animationIntensity');
    return (saved === 'subtle' || saved === 'normal' || saved === 'intense') ? saved : 'normal';
  });

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('animationIntensity', animationIntensity);
    document.documentElement.setAttribute('data-animation', animationIntensity);
  }, [animationIntensity]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, animationIntensity, setAnimationIntensity }}
    >
      {children}
    </ThemeContext.Provider>
  );
}