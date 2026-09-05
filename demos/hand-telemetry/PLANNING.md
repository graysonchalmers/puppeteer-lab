# Hand Telemetry: Planning

Hand Telemetry is the diagnostic counterpart to the Air Canvas drawing demo. Both demos sit on the shared `components/shared` engine: `resolveHands` (handedness + confidence gating) and `useHandRenderLoop` (canvas sizing, mirrored webcam blit, rAF lifecycle). Hand Telemetry keeps every diagnostic overlay and readout; Air Canvas is the minimal drawing surface.
