
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import DemoHub from './components/DemoHub';
import RhythmGame from './components/RhythmGame';
import DebugView from './components/DebugView';
import MotionRecorder from './components/MotionRecorder';
import FaceDemo from './components/FaceDemo';
import { AppMode } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('home');

  return (
    <div className="w-full h-screen bg-[#090A0C] overflow-hidden text-[#EDEDED] font-sans selection:bg-[#EE3B2B] selection:text-white">
      {mode === 'home' && <DemoHub onSelectMode={setMode} />}
      
      {mode === 'game' && (
        <RhythmGame onBack={() => setMode('home')} />
      )}

      {mode === 'debug' && (
        <DebugView onBack={() => setMode('home')} />
      )}

      {mode === 'recorder' && (
        <MotionRecorder onBack={() => setMode('home')} />
      )}

      {mode === 'face' && (
        <FaceDemo onBack={() => setMode('home')} />
      )}
    </div>
  );
};

export default App;
