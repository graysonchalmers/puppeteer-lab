# ⚔️ Tempo Strike

**Tempo Strike** is a spatial rhythm game that uses computer vision to map hand movements to 3D sabers. Players must slice incoming "Sparks" (notes) in time with the music.

## 🎮 Gameplay
*   **Goal:** Slice the blocks as they pass the player.
*   **Controls:** 
    *   **Red Saber:** Left Hand
    *   **Blue Saber:** Right Hand
*   **Scoring:** Hitting a note increases Score and Combo. High combo grants score multipliers (2x, 4x, 8x).

## 🛠️ Components
*   **Entry Point:** `RhythmGame.tsx` (Manages Game State, Score, HUD)
*   **Scene:** `GameScene.tsx` (The R3F Canvas, Saber logic, Note spawning)
*   **Entities:**
    *   `Note.tsx`: The hittable targets.
    *   `Saber.tsx`: The visual representation of the player's hands.

## ⚙️ Configuration
Game constants such as `NOTE_SPEED`, `SONG_BPM`, and `SPAWN_Z` can be configured in `src/constants.ts`.
