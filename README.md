# Camera Bookmarks — Onshape Application Extension

Places named camera bookmarks in a document, then shows a live PIP
preview of that saved viewpoint using Onshape's own server-rendered
image — not a reconstructed/tessellated scene.

## Architecture

- **Element Tab** extension (required for `requestCameraProperties`).
- **Capture**: native `openSelectItemDialog` picks the target Part
  Studio/Assembly; `requestCameraProperties` grabs its live camera
  transform (`viewMatrix`, `projectionMatrix`, FOV, projection type).
- **PIP preview**: fetches a real shaded-view image from Onshape's
  `shadedviews` REST endpoint using the saved camera's transform —
  this is Onshape actually rendering the current model from that
  viewpoint, not us reconstructing geometry in Three.js.
- **Auth**: `shadedviews` needs an OAuth Bearer token, which Element
  Tab extensions don't get automatically. A popup-based OAuth flow
  (via the Cloudflare Worker) handles this without ever navigating
  the tab itself away — only the popup navigates, so `documentId`/
  `workspaceId`/`elementId` context is preserved throughout.
- **Refresh**: manual button only, by design — avoids burning API
  quota on auto-refresh (this was flagged after hitting quota on the
  wireframe viewer previously). Event-triggered refresh is a possible
  future upgrade, not built.

## Known unverified piece — check this first when testing

`cameraProperties` returns a 16-number `viewMatrix`; `shadedviews`
expects a 12-number row-major `[rotation | translation]` string. The
conversion in `viewMatrixTo12()` just takes the first 12 of the 16 —
this assumes the last row is the standard `[0,0,0,1]` homogeneous row,
which hasn't been confirmed. **If the PIP image looks rotated, skewed,
or facing the wrong way, this conversion is the first place to fix** —
log the raw 16-element array and compare against what a correct
render needs.

## Setup (in addition to earlier steps)

1. Update the Worker (`worker.js`) — the `/oauth/callback` handler now
   returns a page that `postMessage`s the token back to the opener
   and closes itself, instead of redirecting. Full replacement given
   separately.
2. First time you click "preview" on a camera, a popup will ask you
   to sign in / authorize — this only needs to happen once per token
   lifetime (roughly the OAuth token's expiry, currently not refreshed
   automatically — re-auth via the popup again once it expires).
3. Make sure popups aren't blocked for `nbbishop.github.io`.

## Stored camera shape

Unchanged from before, plus `targetElementType` (`'partstudio'` or
`'assembly'`, from the picker's `itemSelectedInSelectItemDialog`
response) — needed to pick the right REST path
(`/api/v10/partstudios/...` vs `/api/v10/assemblies/...`).

## Not yet built

- Event-triggered auto-refresh (kept "in the back pocket" per
  discussion, not implemented)
- Token refresh (currently just re-runs the full popup auth flow once
  the stored token expires)
- Syncing bookmarks to the document itself instead of `localStorage`
