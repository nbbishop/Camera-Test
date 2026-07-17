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
const pipTitle = document.getElementById("pipTitle");
const pipImg = document.getElementById("pipImg");
const pipStatus = document.getElementById("pipStatus");
const refreshPipBtn = document.getElementById("refreshPipBtn");

let targetElementId = null;
let targetElementName = null;
let targetElementType = null;
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
      targetElementType = data.elementType; // e.g. 'partstudio' | 'assembly'
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

// ---------- OAuth (popup flow — never navigates this tab away) ----------

const OAUTH_START_URL = "https://shy-lab-1d0e.bishopcents.workers.dev/oauth/start";
const TOKEN_KEY = "onshape_access_token";

function getStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { access_token, expiresAt } = JSON.parse(raw);
    if (Date.now() > expiresAt) return null;
    return access_token;
  } catch {
    return null;
  }
}

function storeToken(access_token, expires_in) {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      access_token,
      expiresAt: Date.now() + (expires_in - 60) * 1000,
    })
  );
}

function requestAuthToken() {
  return new Promise((resolve, reject) => {
    const popup = window.open(OAUTH_START_URL, "onshape-oauth", "width=500,height=650");
    if (!popup) {
      reject(new Error("Popup blocked — allow popups for this site and try again"));
      return;
    }

    function onMessage(event) {
      if (!event.data || event.data.type !== "onshape-oauth-token") return;
      window.removeEventListener("message", onMessage);
      clearInterval(closeTimer);
      storeToken(event.data.access_token, event.data.expires_in);
      resolve(event.data.access_token);
    }
    window.addEventListener("message", onMessage);

    const closeTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(closeTimer);
        window.removeEventListener("message", onMessage);
        reject(new Error("Sign-in window was closed before completing"));
      }
    }, 500);
  });
}

async function ensureAuthToken() {
  const existing = getStoredToken();
  if (existing) return existing;
  return requestAuthToken();
}

// ---------- Shaded view (PIP) ----------

// NOTE: shadedviews expects a 12-number row-major [rotation|translation]
// matrix as a comma string. cameraProperties gives us a 16-number array
// whose exact layout we haven't fully confirmed (see README). This drops
// the last row (assumed to be the [0,0,0,1] homogeneous row) and takes
// the first 12 — verify the resulting image orientation looks right
// once tested, and adjust the slice/order here if it's flipped/skewed.
function viewMatrixTo12(viewMatrix16) {
  return viewMatrix16.slice(0, 12).join(",");
}

async function fetchShadedView(camera) {
  const token = await ensureAuthToken();

  const elementTypePath =
    camera.targetElementType === "assembly" ? "assemblies" : "partstudios";
  const wOrV = workspaceId ? `w/${workspaceId}` : `v/${versionId}`;

  const url = new URL(
    `https://cad.onshape.com/api/v10/${elementTypePath}/d/${documentId}/${wOrV}/e/${camera.targetElementId}/shadedviews`
  );
  url.searchParams.set("viewMatrix", viewMatrixTo12(camera.viewMatrix));
  url.searchParams.set("outputWidth", "360");
  url.searchParams.set("outputHeight", "240");
  url.searchParams.set("pixelSize", "0"); // 0 = fit to model extents, per Onshape forum guidance
  url.searchParams.set("includeSurfaces", "true");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`shadedviews request failed: ${res.status} ${await res.text()}`);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

let activePipCamera = null;

async function showPip(camera) {
  activePipCamera = camera;
  pipTitle.textContent = camera.name;
  pipStatus.textContent = "loading…";
  pipImg.style.display = "none";

  try {
    const objectUrl = await fetchShadedView(camera);
    pipImg.src = objectUrl;
    pipImg.style.display = "block";
    pipStatus.textContent = "";
  } catch (err) {
    console.error(err);
    pipStatus.textContent = "failed to load — see console";
  }
}

function refreshPip() {
  if (activePipCamera) showPip(activePipCamera);
}

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
    delBtn.className = "remove-btn";
    delBtn.onclick = () => {
      const updated = loadCameras().filter((_, idx) => idx !== i);
      saveCameras(updated);
      renderCameras();
    };

    const previewBtn = document.createElement("button");
    previewBtn.textContent = "preview";
    previewBtn.className = "preview-btn";
    previewBtn.onclick = () => showPip(cam);

    li.appendChild(info);
    li.appendChild(previewBtn);
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
      targetElementType,
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
refreshPipBtn.addEventListener("click", refreshPip);

// ---------- Boot ----------

renderCameras();
initHandshake();
