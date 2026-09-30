
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { AppMode } from './types';
import { isTakePath, resolveInitialMode, resolveTakeId, withDemoParam } from './appRoute';
import IdleOverlay from './components/IdleOverlay';

// Face Puppet is the default landing demo (no params); ?demo=<id> deep-links to another one and
// ?demo=menu opens the all-demos overview (DemoHub). Each demo pulls in the heavy Three.js / R3F /
// drei / MediaPipe stack, so they are code-split and loaded on demand.
const DemoHub = lazy(() => import('./components/DemoHub'));
const RhythmGame = lazy(() => import('./components/RhythmGame'));
const AirCanvas = lazy(() => import('./components/aircanvas/AirCanvas'));
const HandTelemetry = lazy(() => import('./components/telemetry/HandTelemetry'));
const MotionRecorder = lazy(() => import('./components/MotionRecorder'));
const FaceDemo = lazy(() => import('./components/FaceDemo'));
const TakeViewer = lazy(() => import('./components/TakeViewer'));

const DemoFallback: React.FC = () => (
  <div className="w-full h-full flex items-center justify-center text-[#EDEDED]/60 text-sm font-mono tracking-wider">
    Loading demo...
  </div>
);

const Lab: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(() => resolveInitialMode(window.location.search));
  // Keep the URL in step with the demo (replace, not push) so a copied address reopens the same demo; other params (?debug) stay.
  const select = useCallback((next: AppMode) => {
    setMode(next);
    try {
      window.history.replaceState(null, '', window.location.pathname + withDemoParam(window.location.search, next) + window.location.hash);
    } catch {
      /* sandboxed frames may forbid it; the demo still switches */
    }
  }, []);
  const back = () => select('home');

  return (
    <div className="w-full h-[100dvh] bg-[#090A0C] overflow-hidden text-[#EDEDED] font-sans selection:bg-[#EE3B2B] selection:text-white">
      <Suspense fallback={<DemoFallback />}>
        {mode === 'home' && <DemoHub onSelectMode={select} />}
        {mode === 'game' && <RhythmGame onBack={back} />}
        {mode === 'aircanvas' && <AirCanvas onBack={back} />}
        {mode === 'telemetry' && <HandTelemetry onBack={back} />}
        {mode === 'recorder' && <MotionRecorder onBack={back} />}
        {mode === 'face' && <FaceDemo onSelectMode={select} />}
      </Suspense>
      {mode !== 'home' && <IdleOverlay />}
    </div>
  );
};

const App: React.FC = () => {
  const route = useMemo(() => {
    const p = window.location.pathname;
    return isTakePath(p) ? { id: resolveTakeId(p) } : null; // id null = a cut-off/garbled link: the viewer says not found
  }, []);
  if (!route) return <Lab />;
  return (
    <div className="w-full h-[100dvh] bg-[#090A0C] overflow-hidden text-[#EDEDED] font-sans">
      <Suspense fallback={<DemoFallback />}>
        <TakeViewer id={route.id} />
      </Suspense>
    </div>
  );
};

export default App;
