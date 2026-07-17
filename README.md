# Camera Bookmarks — Onshape Application Extension

Captures the current viewport camera (view/projection matrices + FOV)
from a chosen Part Studio/Assembly tab and saves it as a named
bookmark.

## Architecture (confirmed against current official docs)

- This app must be registered as an **Element Tab** extension, not
  Element Right Panel — `requestCameraProperties` is only supported
  there.
- Element Tab does **not** support `{$...}` Action URL placeholders.
  Leave the Action URL plain: `https://nbbishop.github.io/Camera-Test/`
  — Onshape appends `documentId`, `workspaceId`/`versionId`,
  `elementId`, `server`, etc. as query params automatically.
- Your app's own `elementId` (its tab) is different from the
  `graphicsElementId` of the Part Studio/Assembly you want the camera
  from. Since your app is a separate tab, it has no automatic
  knowledge of "the tab you were just looking at" — you pick the
  target explicitly via Onshape's native **Select Item** dialog
  (`openSelectItemDialog` / `itemSelectedInSelectItemDialog`
  messages), no custom REST calls needed.

## Setup

1. Host this folder on GitHub Pages (unchanged).
2. Dev portal → your app → Extensions → set **Location = Element Tab**.
   Action URL = plain hosted URL, no placeholder tokens.
3. In a document: **+ menu → Add Application** → pick this app. It
   opens as its own tab.

## Workflow

1. Open the Part Studio/Assembly tab you want to bookmark from, orbit
   to the view you want.
2. Switch to this extension's tab.
3. Click **Choose Target Tab…** — Onshape's native picker opens; pick
   the Part Studio/Assembly.
4. Click **+ Place Camera Here** — captures that tab's current camera.

Note: per Onshape's docs, the target tab "must have been opened at
least once in the current session" for `requestCameraProperties` to
return `isValid: true`.

## Stored camera shape

```json
{
  "name": "Camera 1",
  "targetElementId": "...",
  "targetElementName": "Part Studio 1",
  "projectionType": "perspective | orthographic",
  "viewMatrix": [16 numbers],
  "projectionMatrix": [16 numbers],
  "verticalFieldOfView": number,
  "viewportWidth": number,
  "viewportHeight": number,
  "createdAt": timestamp
}
```

Stored raw (not decomposed into position/target) since the exact
index mapping for camera position within `viewMatrix` wasn't fully
verifiable from docs alone — log a real response and confirm before
building the gizmo/PIP renderer that will need to decompose this.

## Not yet built

- Camera gizmo rendering (Three.js frustum overlay at saved transform)
- Live PIP viewport showing the saved camera's POV while editing
- Syncing bookmarks to the document itself instead of `localStorage`
