
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, lazy, Suspense } from 'react';
import DemoHub from './components/DemoHub';
import { AppMode } from './types';

// The hub is the landing view, so it stays eager. Each demo pulls in the heavy
// Three.js / R3F / drei / MediaPipe stack, so they are code-split and loaded on
// demand: the initial bundle drops to the hub, and a demo's chunk is fetched
// only when its card is opened.
const RhythmGame = lazy(() => import('./components/RhythmGame'));
const AirCanvas = lazy(() => import('./components/aircanvas/AirCanvas'));
const HandTelemetry = lazy(() => import('./components/telemetry/HandTelemetry'));
const MotionRecorder = lazy(() => import('./components/MotionRecorder'));
const FaceDemo = lazy(() => import('./components/FaceDemo'));

const DemoFallback: React.FC = () => (
  <div className="w-full h-full flex items-center justify-center text-[#EDEDED]/60 text-sm font-mono tracking-wider">
    Loading demo...
  </div>
);

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('home');
  const back = () => setMode('home');

  return (
    <div className="w-full h-screen bg-[#090A0C] overflow-hidden text-[#EDEDED] font-sans selection:bg-[#EE3B2B] selection:text-white">
      {mode === 'home' && <DemoHub onSelectMode={setMode} />}

      {mode !== 'home' && (
        <Suspense fallback={<DemoFallback />}>
          {mode === 'game' && <RhythmGame onBack={back} />}
          {mode === 'aircanvas' && <AirCanvas onBack={back} />}
          {mode === 'telemetry' && <HandTelemetry onBack={back} />}
          {mode === 'recorder' && <MotionRecorder onBack={back} />}
          {mode === 'face' && <FaceDemo onBack={back} />}
        </Suspense>
      )}
    </div>
  );
};

export default App;
