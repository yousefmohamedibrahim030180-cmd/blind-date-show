# Blind Date Show — GitHub Pages + Firebase

This version removes the Node/Express/Socket.IO server. The frontend is static and can run from GitHub Pages. Firebase Realtime Database handles rooms, host-controlled questions, round ratings, final choices, chat, and WebRTC signaling. WebRTC carries camera/audio directly between the two participants.

## Firebase setup
1. Enable **Authentication → Sign-in method → Anonymous**.
2. In Realtime Database → Rules, paste `database.rules.json` and publish.
3. The web app config is in `public/firebase-config.js`.

## GitHub Pages
Push the repository to GitHub on `main`. The included workflow deploys `public/` automatically. In GitHub: Settings → Pages → Source: **GitHub Actions**.

Participant URL: the GitHub Pages URL.
Host URL: append `/control.html`.

## Notes
- The controller key is a UI gate only; it is not a server secret because GitHub Pages code is public. Firebase rules protect a claimed room by the authenticated anonymous host UID.
- Camera/microphone require HTTPS; GitHub Pages supplies HTTPS.
- WebRTC uses public STUN servers. Some restrictive networks may require a TURN server for reliable calls.
- Ratings are exactly: -100, 0, 1–10. Ratings remain private until the final result phase.
