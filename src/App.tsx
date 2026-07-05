import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { IntroSequence } from './components/intro/IntroSequence';
import { ProjectModePage } from './pages/ProjectModePage';
import { ProjectModeBuilderPage } from './pages/ProjectModeBuilderPage';
import { ProjectAutoCreatePage } from './pages/ProjectAutoCreatePage';
import { ParticleBackground } from './components/shared/ParticleBackground';
import { ThemeToggle } from './components/shared/ThemeToggle';
import { useAnimationConfig } from './hooks/useAnimationConfig';
import { getTransition } from './hooks/useAnimationConfig';

function App() {
  const [introComplete, setIntroComplete] = useState(false);
  const { animationIntensity } = useAnimationConfig();

  return (
    <BrowserRouter>
      <AnimatePresence mode="wait">
        {!introComplete ? (
          <IntroSequence key="intro" onComplete={() => setIntroComplete(true)} />
        ) : (
          <motion.div
            key="main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={getTransition(0.8, animationIntensity)}
          >
            <ParticleBackground />
            <ThemeToggle />
            <Routes>
              <Route path="/" element={<Navigate to="/project-mode" replace />} />
              <Route path="/project-mode" element={<ProjectModePage />} />
              <Route path="/project-mode/auto" element={<ProjectAutoCreatePage />} />
              <Route path="/project-mode/:projectId" element={<ProjectModeBuilderPage />} />
            </Routes>
          </motion.div>
        )}
      </AnimatePresence>
    </BrowserRouter>
  );
}

export default App;