// ---------------------------------------------------------------
// Onshape Application Extension: Camera Bookmarks
// Handles the client-messaging handshake, requests camera state,
// and stores named camera bookmarks per document/workspace/element.
// ---------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const documentId = params.get("documentId");
const workspaceId = params.get("workspaceId") || params.get("versionId");
const elementId = params.get("elementId");
const server = params.get("server") || "https://cad.onshape.com";

console.log("%c[boot params]", "background: cyan; color: black;", {
  documentId,
  workspaceId,
  elementId,
  server,
  fullQueryString: window.location.search,
});

const statusEl = document.getElementById("status");
const placeBtn = document.getElementById("placeBtn");
const listEl = document.getElementById("cameraList");

let ready = false;
let pendingCameraRequest = null;

// ---------- Client messaging plumbing ----------

function postToOnshape(message) {
  window.parent.postMessage(
    {
      documentId,
      workspaceId,
      elementId,
      ...message,
    },
    server
  );
}

function sendKeepAlive() {
  postToOnshape({ messageName: "keepAlive" });
}

function requestCameraProperties() {
  return new Promise((resolve, reject) => {
    pendingCameraRequest = { resolve, reject };

    // Onshape's documented client message shape is just
    // {documentId, workspaceId, elementId, messageName} — no custom
    // fields. An earlier version of this added a `requestId` field,
    // which may have made the message invalid and gotten it silently
    // dropped. Keeping this minimal until we confirm otherwise.
    postToOnshape({
      messageName: "requestCameraProperties",
    });

    // Fail safe if Onshape never responds
    setTimeout(() => {
      if (pendingCameraRequest) {
        pendingCameraRequest = null;
        reject(new Error("requestCameraProperties timed out"));
      }
    }, 4000);
  });
}

window.addEventListener("message", (event) => {
  // Log everything BEFORE the origin check — if event.origin doesn't
  // exactly match `server`, the check below silently drops the
  // message before it's ever seen. Logging first turns that into a
  // visible mismatch instead of dead silence.
  console.log(
    "%c[raw message]",
    "background: orange; color: black;",
    "origin:", event.origin,
    "| expected server:", server,
    "| data:", event.data
  );

  // SECURITY: only accept messages from the Onshape server this
  // iframe was loaded from. Do not remove this check.
  if (event.origin !== server) return;

  const data = event.data;
  if (!data || !data.messageName) return;

  switch (data.messageName) {
    case "cameraProperties": {
      if (pendingCameraRequest) {
        const req = pendingCameraRequest;
        pendingCameraRequest = null;
        req.resolve(data);
      }
      break;
    }

    default:
      // Unhandled message types land here during development —
      // console.log to see what Onshape actually sends.
      console.debug("Unhandled client message:", data);
  }
});

function setStatus(cls, text) {
  statusEl.className = cls;
  statusEl.textContent = text;
}

// Onshape will not message an app that hasn't first sent a valid
// message. keepAlive is the documented first message to send — there
// is no separate "ready" reply to wait for, so we enable the button
// right after sending it.
function initHandshake() {
  sendKeepAlive();
  setInterval(sendKeepAlive, 20000);

  ready = true;
  setStatus("ready", "connected");
  placeBtn.disabled = false;
}

// ---------- Storage ----------

function storageKey() {
  return `cameras:${documentId}:${workspaceId}:${elementId}`;
}

function loadCameras() {
  try {
    return JSON.parse(localStorage.getItem(storageKey()) || "[]");
  } catch {
    return [];
  }
}

function saveCameras(cameras) {
  localStorage.setItem(storageKey(), JSON.stringify(cameras));
}

// ---------- UI ----------

function renderCameras() {
  const cameras = loadCameras();
  listEl.innerHTML = "";

  if (cameras.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No cameras placed yet.";
    li.style.color = "#888";
    listEl.appendChild(li);
    return;
  }

  cameras.forEach((cam, i) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "cam-name";
    name.textContent = cam.name;
    const meta = document.createElement("div");
    meta.className = "cam-meta";
    meta.textContent = `fov ${cam.fov?.toFixed(1) ?? "?"} · placed ${new Date(
      cam.createdAt
    ).toLocaleTimeString()}`;
    info.appendChild(name);
    info.appendChild(meta);

    const delBtn = document.createElement("button");
    delBtn.textContent = "remove";
    delBtn.onclick = () => {
      const updated = loadCameras().filter((_, idx) => idx !== i);
      saveCameras(updated);
      renderCameras();
    };

    li.appendChild(info);
    li.appendChild(delBtn);
    listEl.appendChild(li);
  });
}

async function placeCamera() {
  placeBtn.disabled = true;
  placeBtn.textContent = "capturing…";

  try {
    const camData = await requestCameraProperties();

    // NOTE: the exact shape of `camData` depends on what Onshape's
    // client actually returns — verify field names once you see a
    // real response in the console, then adjust the mapping below.
    const camera = {
      name: `Camera ${loadCameras().length + 1}`,
      position: camData.position || camData.viewMatrix?.position,
      target: camData.target || camData.viewMatrix?.target,
      fov: camData.fieldOfView ?? camData.fov,
      isOrtho: camData.isOrthographic ?? camData.orthographic ?? false,
      createdAt: Date.now(),
    };

    const cameras = loadCameras();
    cameras.push(camera);
    saveCameras(cameras);
    renderCameras();
  } catch (err) {
    console.error(err);
    setStatus("error", "capture failed — see console");
  } finally {
    placeBtn.disabled = false;
    placeBtn.textContent = "+ Place Camera Here";
  }
}

placeBtn.addEventListener("click", placeCamera);

// ---------- Boot ----------

renderCameras();
initHandshake();
