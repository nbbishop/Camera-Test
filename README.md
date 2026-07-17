# Camera Bookmarks — Onshape Application Extension

Captures the current viewport camera (position/target/FOV) and saves it
as a named bookmark, scoped to the current document/workspace/element.

## What's here

- `index.html` — panel UI
- `app.js` — client-messaging handshake + camera capture + storage
- `styles.css` — Onshape-blue styling to match your other tools

## Setup

1. **Host it** — same pattern as your McMaster app: push this folder to
   a GitHub Pages repo (public HTTPS URL required for the iframe).

2. **Register the app** — cad.onshape.com → App Store → Dev Portal →
   create a new app.
   - Type: **Application Extension**
   - Extension location: pick a toolbar/panel location so it's visible
     while modeling
   - Point it at your hosted `index.html`
   - Onshape appends `documentId`, `workspaceId` (or `versionId`),
     `elementId`, and `server` as query params automatically — the
     code already reads these.

3. **OAuth** — set up your client ID/secret in the dev portal per
   Onshape's Application Extension flow. This build doesn't touch
   OAuth directly since `requestCameraProperties` rides the
   client-messaging channel, not REST — but the dev portal still
   requires OAuth config to register the extension at all.

## Things I couldn't verify and you should check first

I don't have access to Onshape's live client-messaging schema, so two
things in `app.js` are best-guesses flagged with comments — confirm
both against your browser console once the handshake is running:

- **Handshake message name**: I used `applicationInit` as the message
  Onshape sends once it's acknowledged your app. If nothing fires,
  `console.debug` in the `message` listener's `default` case will show
  you what Onshape is actually sending — adjust the `case` to match.
- **`cameraProperties` response shape**: field names for position /
  target / FOV are guessed (`camData.position`, `camData.fieldOfView`,
  etc.) with fallbacks. Log `camData` once and fix the mapping in
  `placeCamera()` to the real field names.

## Not yet built (next steps per our earlier plan)

- Camera gizmo rendering (Three.js frustum overlay at saved transform)
- Live PIP viewport showing the saved camera's POV as you edit
- Syncing bookmarks to the document itself instead of `localStorage`
  (so they're shared across users/machines)
