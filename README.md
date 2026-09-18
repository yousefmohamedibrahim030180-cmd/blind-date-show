# Blind Date Show — v23 Final Reveal Studio

Production-focused real-time Blind Date Show with cinematic participant UI, Director monitoring, intercom, OBS overlays, private final choices and a controlled answer reveal.

## What's new in v23
- Private final choice: each player locks YES / NO without seeing the other answer.
- Director-only final answer vault: the Director sees lock status first and actual answers only after both players have chosen.
- Final reveal workflow: ARM REVEAL → REVEAL ANSWERS.
- Cinematic 3-second reveal for both players.
- Each player sees **YOUR ANSWER** and **THEIR ANSWER** at reveal time.
- Explicit MATCH / DIFFERENT ANSWERS result.
- 30-second automatic safety reveal if the Director does not trigger the reveal.
- Final answer state survives the normal room state updates until the reveal is complete.
- Participant names remain hidden from each other; the UI uses "YOUR DATE" / player labels.
- Existing WebRTC, ratings, chat, Director monitor, intercom and OBS routes preserved.

## Run
```bash
npm install
npm start
```

Participant: `/`
Director: `/control` or `/director`
OBS overlay: `/overlay`
Health: `/health`

## Production
Set `ADMIN_KEY` to a strong secret in the hosting environment. The app listens on `process.env.PORT` and `0.0.0.0` for Render/Railway-style deployments.
