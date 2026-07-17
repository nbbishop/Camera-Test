// ---------------------------------------------------------------
// Onshape Application Extension: Camera Bookmarks (Element Tab)
// ---------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const documentId = params.get("documentId");
const workspaceId = params.get("workspaceId");
const versionId = params.get("versionId");
const elementId = params.get("elementId"); // this app's own tab
const server = params.get("server") || "https://cad.onshape.com";

console.log("%c[boot params]", "background: cyan; color: black;", {
  documentId, workspaceId, versionId, elementId, server,
  fullQueryString: window.location.search,
});

const statusEl = document.getElementById("status");
const placeBtn = document.getElementById("placeBtn");
const pickBtn = document.getElementById("pickBtn");
const targetLabel = document.getElementById("targetLabel");
const listEl = document.getElementById("cameraList");

let targetElementId = null;
let targetElementName = null;
let pendingCameraRequest = null;

// ---------- Client messaging plumbing ----------

function postToOnshape(message) {
  window.parent.postMessage(
    { documentId, workspaceId, versionId, elementId, ...message },
    server
  );
}

function sendApplicationInit() {
  postToOnshape({ messageName: "applicationInit" });
}

function sendKeepAlive() {
  postToOnshape({ messageName: "keepAlive" });
}

function openTabPicker() {
  postToOnshape({
    messageName: "openSelectItemDialog",
    dialogTitle: "Choose the Part Studio or Assembly to bookmark cameras from",
    selectPartStudios: true,
    selectAssemblies: true,
    selectMultiple: false,
    showBrowseDocuments: true,
  });
}

function requestCameraProperties(graphicsElementId) {
  return new Promise((resolve, reject) => {
    pendingCameraRequest = { resolve, reject };

    postToOnshape({
      messageName: "requestCameraProperties",
      graphicsElementId,
    });

    setTimeout(() => {
      if (pendingCameraRequest) {
        pendingCameraRequest = null;
        reject(new Error("requestCameraProperties timed out"));
      }
    }, 4000);
  });
}

window.addEventListener("message", (event) => {
  console.log(
    "%c[raw message]", "background: orange; color: black;",
    "origin:", event.origin, "| expected:", server, "| data:", event.data
  );

  if (event.origin !== server) return;

  const data = event.data;
  if (!data || !data.messageName) return;

  switch (data.messageName) {
    case "itemSelectedInSelectItemDialog":
      targetElementId = data.elementId;
      targetElementName = data.elementName || data.elementId;
      targetLabel.textContent = `Target: ${targetElementName}`;
      placeBtn.disabled = false;
      break;

    case "cameraProperties": {
      if (pendingCameraRequest) {
        const req = pendingCameraRequest;
        pendingCameraRequest = null;
        req.resolve(data);
      }
      break;
    }

    default:
      console.debug("Unhandled client message:", data);
  }
});

function setStatus(cls, text) {
  statusEl.className = cls;
  statusEl.textContent = text;
}

function initHandshake() {
  sendApplicationInit();
  sendKeepAlive();
  setInterval(sendKeepAlive, 20000);

  setStatus("ready", "connected");
}

// ---------- Storage ----------

function storageKey() {
  return `cameras:${documentId}:${workspaceId || versionId}:${elementId}`;
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
    const fovText = cam.projectionType === "orthographic"
      ? "orthographic"
      : `fov ${cam.verticalFieldOfView?.toFixed(1) ?? "?"}`;
    meta.textContent = `${cam.targetElementName} · ${fovText} · placed ${new Date(
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
  if (!targetElementId) return;

  placeBtn.disabled = true;
  placeBtn.textContent = "capturing…";

  try {
    const camData = await requestCameraProperties(targetElementId);

    if (!camData.isValid) {
      throw new Error(
        "Onshape reports this camera is not valid — make sure the target tab has been opened at least once this session."
      );
    }

    const camera = {
      name: `Camera ${loadCameras().length + 1}`,
      targetElementId,
      targetElementName,
      projectionType: camData.projectionType,
      viewMatrix: camData.viewMatrix,
      projectionMatrix: camData.projectionMatrix,
      verticalFieldOfView: camData.verticalFieldOfView,
      viewportWidth: camData.viewportWidth,
      viewportHeight: camData.viewportHeight,
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

pickBtn.addEventListener("click", openTabPicker);
placeBtn.addEventListener("click", placeCamera);

// ---------- Boot ----------

renderCameras();
initHandshake();
