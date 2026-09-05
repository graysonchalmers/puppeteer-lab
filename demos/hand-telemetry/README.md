# Hand Telemetry

The full diagnostic view: skeleton, HUD, connectors, bounding boxes, inter-hand distances (palm, finger, thumb, pinky), center estimate, confidence gate, smoothing filter, 3D hologram, proximity audio synth, landmark recorder with playback, and live metrics. Split out of the former DebugView on 2026-09-04.

Component: `components/telemetry/HandTelemetry.tsx`. Shares the `components/shared` engine (`resolveHands`, `useHandRenderLoop`) with the Air Canvas demo.
