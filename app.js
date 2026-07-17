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

const statusEl = document.getElementById("status");
const placeBtn = document.getElementById("placeBtn");
const listEl = document.getElementById("cameraList");

let ready = false;
let pendingCameraRequests = {};
let requestCounter = 0;

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
    const requestId = ++requestCounter;
    pendingCameraRequests[requestId] = { resolve, reject };

    postToOnshape({
      messageName: "requestCameraProperties",
      requestId, // NOTE: confirm Onshape echoes this back in the response;
                 // if not, fall back to matching on messageName + timestamp.
    });

    // Fail safe if Onshape never responds
    setTimeout(() => {
      if (pendingCameraRequests[requestId]) {
        delete pendingCameraRequests[requestId];
        reject(new Error("requestCameraProperties timed out"));
      }
    }, 4000);
  });
}

window.addEventListener("message", (event) => {
  // SECURITY: only accept messages from the Onshape server this
  // iframe was loaded from. Do not remove this check.
  if (event.origin !== server) return;

  const data = event.data;
  if (!data || !data.messageName) return;

  switch (data.messageName) {
    case "applicationInit":
      // Onshape acknowledges our app is registered and ready.
      ready = true;
      setStatus("ready", "connected");
      placeBtn.disabled = false;
      break;

    case "cameraProperties": {
      const req = pendingCameraRequests[data.requestId];
      if (req) {
        delete pendingCameraRequests[data.requestId];
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

// Onshape will not message an app that hasn't first announced itself.
function initHandshake() {
  postToOnshape({ messageName: "applicationInit" });
  sendKeepAlive();
  setInterval(sendKeepAlive, 20000);

  // If we don't hear back, surface that instead of hanging on
  // "connecting..." forever.
  setTimeout(() => {
    if (!ready) setStatus("error", "no response from Onshape");
  }, 5000);
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
