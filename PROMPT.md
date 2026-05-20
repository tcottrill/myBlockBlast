# Recreating My Block Blast with Claude

This document is a self-contained project brief. Paste the entire contents (everything below the line) into [claude.ai](https://claude.ai) — or any capable LLM — and you should get back a working, single-file implementation of My Block Blast that matches the version in this repository.

Tested with Claude Opus 4.7. For best results, request the file in one shot rather than in parts; the model will keep the HTML, CSS, JavaScript, and inline SVG coherent across the whole document.

---

## Project: My Block Blast — a single-file Block Blast clone PWA

Build a complete, production-quality clone of the mobile puzzle game **Block Blast!** in a **single `index.html` file** with no build step, no server, no external dependencies, and no network calls after page load. The game must look and feel like the original: a dark navy 8×8 grid, brightly colored gradient tiles with glossy bevels, a three-piece tray, drag-to-place input, and row/column clears.

The entire game — HTML markup, CSS, JavaScript, tile rendering (Canvas + DOM), and synthesized sound effects — must live in one file. No `fetch`, no XHR, no service workers required for gameplay. The only sidecar files are the PWA manifest and the icon set.

### Target platforms

- iPhone Safari 16.4+ (primary). Portrait orientation. Add-to-Home-Screen as a PWA.
- Android Chrome (secondary). Same PWA install flow.
- Desktop Chrome / Edge / Firefox (tertiary, mostly for playtesting).

The layout is mobile-first portrait. The whole game, including header, board, and tray, must fit within a ~390 × 844 px viewport without scrolling.

---

## Game rules

- An 8×8 grid, initially empty.
- A tray of three pieces sits below the board.
- The player drags any tray piece onto the grid. The piece must fit entirely inside the board, and every target cell must be empty.
- When a piece is placed, any row that is completely filled and any column that is completely filled are cleared simultaneously.
- When all three tray pieces have been placed, three fresh random pieces appear.
- The game ends when none of the remaining tray pieces can fit anywhere on the board.

There is no undo. Every placement is committed.

### Piece library

About 35 polyomino shapes, all in fixed rotations (no spin/rotate input in the original):

- 1-cell single.
- 2/3/4/5-cell horizontal lines and 2/3/4/5-cell vertical lines.
- 2×2 and 3×3 solid squares.
- All four rotations of the 3-cell small L (a 2×2 with one corner missing).
- All four rotations of the T-tetromino.
- All four rotations of the L-tetromino.
- All four rotations of the J-tetromino (mirror of L).
- Both rotations of the S-tetromino.
- Both rotations of the Z-tetromino.
- The 5-cell plus sign.
- Both diagonals of a 2-cell `\` / `/` shape.

Each spawned piece is assigned a random color from a 7-color palette: red, orange, yellow, green, cyan, blue, purple.

### Scoring

- `+1` per cell placed.
- `+10` per cleared line.
- Combo bonus when one placement clears more than one line: `+10 × (lines − 1) × lines`. So 2 lines = +20, 3 = +60, 4 = +120.
- Streak bonus when consecutive placements each clear at least one line: `+5 × streak`, where streak is the run length. A placement that clears nothing resets the streak to 0.

---

## Architecture

Single-file PWA. Hybrid DOM + canvas layout — canvas for the dynamic board and clear-shatter particles, DOM for chrome (header, tray, dialogs).

```
myBlockBlast/
├── index.html                       # entire app
├── site.webmanifest                 # PWA manifest
├── icon-master.svg                  # vector icon source
├── icon-192.png, icon-512.png       # PWA icons
├── apple-touch-icon{,-167x167,-152x152}.png
├── favicon{,-16x16,-32x32}.{ico,png}
├── README.md
├── PROMPT.md
└── LICENSE
```

### `index.html` structure

```
<head>      PWA boilerplate, viewport, manifest link, inline <style>
<body>
  <header>  brand · score · best · mute · menu buttons
  <main>    <canvas id="board"> + an absolute combo-flash overlay
  <footer id="trayWrap">  three .slot elements
  <div id="dragPiece">    the drag overlay (positioned via JS transform)
  <div id="dlgMenu">      menu dialog (PLAY + CONTINUE)
  <div id="dlgGameOver">  game-over dialog (PLAY AGAIN + BACK TO MENU)
  <div id="dlgConfirm">   confirm-quit dialog
  <script>  all game logic in one IIFE
</body>
```

### State machine

`LOADING → MENU → PLAY → GAME_OVER`, with `CONFIRM_QUIT` as an overlay over `PLAY`. The menu offers `CONTINUE` if a saved game exists.

### Mobile must-dos

- Cap `devicePixelRatio` at 2. iPhones report 3, which means 9× pixel work per frame.
- Debounce `resize` (120 ms) and `orientationchange` (260 ms).
- `touch-action: none` and `overscroll-behavior: none` on `html, body` and the canvas.
- `-webkit-tap-highlight-color: transparent`, `user-select: none`.
- `<meta name="viewport" content="..., viewport-fit=cover">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style="black-translucent"`, `theme-color="#0e1330"`, `translate="no"` on `<html>` plus `<meta name="google" content="notranslate">` to suppress the Chrome translate prompt.

### Input

Pointer Events on each tray slot. On `pointerdown` clone the piece into the `#dragPiece` overlay and hide the source slot. On `pointermove` update the overlay transform; on `pointerup` either commit (if the ghost is valid) or animate the overlay snapping back to the slot with a CSS transition. `pointercancel` always snaps back. Ignore non-primary pointers (no multitouch drags).

The dragged piece floats so that its **bottom edge is `POINTER_OFFSET_Y = 80 px` above the fingertip**, centered horizontally on the finger. This matches Block Blast's feel and keeps the piece visible above your finger on a phone.

The ghost cell on the board is computed from the same offset — the top-left of the piece visual mapped to the nearest cell. A green tint marks valid placements; red marks invalid. When the placement would also clear lines, a faint cyan overlay paints the rows/columns that will clear.

### Rendering

`drawBoardBackground()` draws an inset card with rounded corners, then 8×8 empty cell slots (dark navy with subtle inset), then the locked tiles. `drawGhost()` overlays the placement preview. `drawParticles()` draws active shatter shards.

Tile rendering:
- Base: rounded rect with a vertical gradient from the color's light variant at the top to the dark variant at the bottom.
- Top sheen: 30% height rounded rect at ~30% white alpha.
- Bottom inner shadow: 5% black-alpha stroke on the rounded outline.

### Animation loop

One self-stopping `requestAnimationFrame` loop. `hasActiveAnimations()` returns true while shatter particles exist; the loop advances each particle (gravity = 800 px/s², mild air drag, life in ms) and exits when none remain.

Score "+N" pops are DOM spans with a CSS @keyframe rising 56 px and fading over 900 ms. Combo flash is a CSS @keyframe on a fixed-overlay div (full-board cyan glow, 480 ms).

### Sound (WebAudio, synthesized)

Lazy `AudioContext` on first user gesture, wrapped in `try/catch`. About 50 lines total. Sounds:

- `place` — short triangle + sine click at ~380 Hz / ~260 Hz.
- `clear` — sine sweep 440 Hz → 880 Hz, 220 ms.
- `combo` — three triangle tones forming a C-E-G chord, staggered ~40 ms apart.
- `streak` — square-wave arpeggio C-E-G-C, 70 ms apart.
- `gameOver` — sawtooth sweep 440 Hz → 110 Hz, 550 ms.

Mute toggle persisted in localStorage. `playSfx()` is a no-op when muted or when `AudioContext` failed to initialize.

### Persistence (localStorage)

Versioned keys: `bb.best.v1`, `bb.mute.v1`, `bb.game.v1`. Every read and write wrapped in `try/catch` (private-mode Safari throws). In-progress game state is debounced (250 ms) and flushed on `pagehide` and `visibilitychange → hidden`. Schema version stored in the saved object; mismatch discards the saved game (keeps best score).

### Dialogs

DOM overlays toggled via an `.open` class. The menu dialog shows the best score plus `PLAY` and (if a saved game exists) `CONTINUE`. The game-over dialog shows final + best score plus `PLAY AGAIN` and `BACK TO MENU`. The confirm-quit dialog shows `QUIT` (danger color) and `CANCEL`; cancel restores `preConfirmState`.

### Tests (dev-only)

Append `?test=1` to the URL to run inline `console.assert` checks for `canPlace`, `findFullLines`, `clearLines`, and `anyPieceFits` on both empty and full boards. Output goes to the console; the game still boots normally.

---

## Visual style

- Background: radial gradient from `#161a3a` (top) to `#0a0e26` (bottom).
- Board card: subtle white-on-dark inset, rounded 18 px.
- Empty cells: `#1a2152`.
- Brand: cyan `#46e3ff` with a soft glow.
- Score numbers: white; best is gold `#ffd351`.
- Buttons: rounded 14 px, cyan gradient with a 4 px shadow ledge; secondary in muted blue; danger in red.

The font stack is the native system stack — no web fonts.

---

## What NOT to do

- Do not use any framework (React, Vue, etc.).
- Do not use TypeScript.
- Do not split into multiple files (except the sidecar PWA icons and the manifest).
- Do not `fetch()` any sibling files — `file://` opens must work.
- Do not bundle audio files. Synthesize all sound with WebAudio.
- Do not add background music.
- Do not add an undo button.
- Do not add ads, telemetry, or accounts.

---

## Playtest matrix

| Area | Check |
|---|---|
| Boot | Fresh load → menu; reload with in-progress save → CONTINUE works |
| Drag | Piece follows finger with 80 px offset; ghost turns green/red correctly |
| Drop | Valid commits, invalid snaps back, off-board snaps back |
| Clear | Single row, single col, simultaneous row+col, 2/3/4-line combos |
| Combo/streak | +N pop appears; streak resets when a placement clears nothing |
| Refill | Tray refills only after all three pieces consumed |
| Game over | Dialog appears with final + best score |
| Persist | Best score, mute, in-progress game all survive reload + tab close |
| Audio | First gesture inits audio; mute kills sound; unmute restores |
| Pause | Backgrounded tab does not lose state |

Performance: hold 60 fps on iPhone 12 / mid-range Android during a 4-line simultaneous clear. If not, profile the shatter particle count.
