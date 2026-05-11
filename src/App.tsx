import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { IntroSequence } from './components/intro/IntroSequence';
import { ChatLayout } from './components/chat/ChatLayout';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { ProjectModePage } from './pages/ProjectModePage';
import { ProjectModeBuilderPage } from './pages/ProjectModeBuilderPage';
import { ProjectAutoCreatePage } from './pages/ProjectAutoCreatePage';
import { ParticleBackground } from './components/shared/ParticleBackground';
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
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={getTransition(0.8, animationIntensity)}
          >
            <ParticleBackground />
            <Routes>
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/project-mode" element={<ProjectModePage />} />
              <Route path="/project-mode/auto" element={<ProjectAutoCreatePage />} />
              <Route path="/project-mode/:projectId" element={<ProjectModeBuilderPage />} />
              <Route path="*" element={<ChatLayout />} />
            </Routes>
          </motion.div>
        )}
      </AnimatePresence>
    </BrowserRouter>
  );
}

export default App;