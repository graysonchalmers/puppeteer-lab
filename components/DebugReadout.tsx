/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ?debug overlay: one line of live numbers (render fps, tracker fps, delegate,
 * camera size and facing) so real-phone performance can be reported without dev tools.
 */
import React, { useEffect, useState } from 'react';

const DebugReadout: React.FC<{ getLine: () => string }> = ({ getLine }) => {
  const [line, setLine] = useState(getLine);
  useEffect(() => {
    const id = setInterval(() => setLine(getLine()), 500);
    return () => clearInterval(id);
  }, [getLine]);
  return (
    <div
      data-testid="debug-readout"
      className="absolute bottom-2 left-2 z-50 pointer-events-none bg-black/70 text-[#7CFFB2] font-mono text-[10px] px-2 py-1 rounded"
    >
      {line}
    </div>
  );
};

export default DebugReadout;
