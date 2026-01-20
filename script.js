/* script.js - Jewels-Ai Atelier: v10.0 (Smart Button, Zoom Fix & Live Party) */

/* --- 1. CONFIGURATION --- */
const API_KEY = "AIzaSyAXG3iG2oQjUA_BpnO8dK8y-MHJ7HLrhyE"; 

const DRIVE_FOLDERS = {
  earrings: "1eftKhpOHbCj8hzO11-KioFv03g0Yn61n",
  chains: "1G136WEiA9QBSLtRk0LW1fRb3HDZb4VBD",
  rings: "1iB1qgTE-Yl7w-CVsegecniD_DzklQk90",
  bangles: "1d2b7I8XlhIEb8S_eXnRFBEaNYSwngnba"
};

/* --- 2. ASSETS & STATE --- */
const JEWELRY_ASSETS = {}; const CATALOG_PROMISES = {}; const IMAGE_CACHE = {}; 
let dailyItem = null; const watermarkImg = new Image(); watermarkImg.src = 'logo_watermark.png'; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');
const flashOverlay = document.getElementById('flash-overlay'); 
const smartBtn = document.getElementById('smart-btn');

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     
let currentAssetName = "Select a Design"; 
let currentAssetIndex = 0; 

/* Physics & Stabilizer */
let physics = { earringAngle: 0, earringVelocity: 0, swayOffset: 0, lastHeadX: 0 };
const SMOOTH_FACTOR = 0.8; 
let handSmoother = { active: false, ring: {x:0,y:0,angle:0,size:0}, bangle: {x:0,y:0,angle:0,size:0} };
let currentCameraMode = 'user'; 

/* --- 3. CO-SHOPPING ENGINE --- */
const coShop = {
    peer: null, conns: [], calls: [], myId: null, active: false, isHost: false,
    
    init: function() {
        this.peer = new Peer(null, { debug: 1 });
        this.peer.on('open', (id) => { this.myId = id; this.checkForInvite(); });
        this.peer.on('connection', (c) => { this.handleConnection(c); });
        
        // GUEST: Receive Video Stream
        this.peer.on('call', (call) => {
            call.answer(); 
            call.on('stream', (remoteStream) => {
                // *** ZOOM FIX: Apply specific class for remote viewing ***
                videoElement.srcObject = remoteStream;
                videoElement.classList.add('remote-stream'); // Forces object-fit: contain
                videoElement.classList.remove('no-mirror');  // Don't mirror host video
                videoElement.play();
                
                loadingStatus.style.display = 'none';
                document.getElementById('live-badge').style.display = 'block';
                showToast("🔴 Watching Host Live");
            });
        });
    },

    checkForInvite: function() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        
        if (roomId) {
            // --- GUEST MODE ---
            this.isHost = false; 
            this.active = true;
            document.getElementById('main-controls').style.display = 'none'; // Hide controls
            document.getElementById('voting-ui').style.display = 'flex';     // Show reactions
            smartBtn.style.display = 'none';                                 // Hide Smart Button for Guest
            
            loadingStatus.innerText = "Connecting to Host...";
            loadingStatus.style.display = 'block';
            this.connectToHost(roomId);
        } else {
            // --- HOST MODE ---
            this.isHost = true; 
            this.active = true;
            smartBtn.innerText = "👥"; // Default: Invite
            
            // Start Camera immediately
            startCameraFast('user').then(() => {
                selectJewelryType('earrings');
                setTimeout(() => { loadingStatus.style.display = 'none'; }, 2000);
            });
        }
    },

    connectToHost: function(hostId) {
        let conn = this.peer.connect(hostId);
        this.handleConnection(conn);
    },

    handleConnection: function(c) {
        c.on('open', () => {
            this.conns.push(c); 
            
            // HOST: Guest Joined
            if (this.isHost) {
                showToast("Guest Joined!");
                updateSmartButton("end"); // Switch icon to X
                
                // Call Guest with Video
                if (videoElement.srcObject) {
                    const call = this.peer.call(c.peer, videoElement.srcObject);
                    this.calls.push(call);
                }
                // Sync Initial State
                setTimeout(() => this.sendUpdate(currentType, currentAssetIndex), 1500);
            }

            c.on('data', (data) => this.handleData(data, c));
            c.on('close', () => { 
                this.conns = this.conns.filter(p => p !== c); 
                // If all guests left, revert button to Invite
                if(this.conns.length === 0 && this.isHost) updateSmartButton("invite");
            });
        });
    },

    handleData: function(data, senderConn) {
        if (data.type === 'SYNC_ITEM') {
            // Guest updates internal state (even if watching video)
            selectJewelryType(data.cat, true).then(() => {
                applyAssetInstantly(JEWELRY_ASSETS[data.cat][data.idx], data.idx, false);
            });
            if (this.isHost) this.broadcast(data, senderConn);
            
        } else if (data.type === 'VOTE') {
            showReaction(data.val);
            if (this.isHost) this.broadcast(data, senderConn);

        } else if (data.type === 'SESSION_END') {
            // --- GUEST: HOST ENDED SESSION ---
            showToast("✨ Your Turn!");
            
            // 1. Cleanup Video Stream
            if(videoElement.srcObject) {
                videoElement.srcObject.getTracks().forEach(track => track.stop());
                videoElement.srcObject = null;
            }
            
            // 2. Remove Zoom Fix (Restore Local Camera Fit)
            videoElement.classList.remove('remote-stream');

            // 3. Reset UI
            document.getElementById('live-badge').style.display = 'none';
            document.getElementById('main-controls').style.display = 'flex'; 
            document.getElementById('voting-ui').style.display = 'none';
            
            // 4. Start Local Camera
            this.active = false; 
            startCameraFast('user'); 
        }
    },

    broadcast: function(data, excludeConn = null) {
        this.conns.forEach(c => { if (c.open && c !== excludeConn) c.send(data); });
    },
    sendUpdate: function(category, index) { this.broadcast({ type: 'SYNC_ITEM', cat: category, idx: index }); },
    sendVote: function(val) { this.broadcast({ type: 'VOTE', val: val }); showReaction(val); },
    
    stopSession: function() {
        this.broadcast({ type: 'SESSION_END' });
        this.calls.forEach(call => call.close());
        this.conns.forEach(conn => conn.close());
        this.conns = []; this.calls = [];
        this.active = false;
        
        updateSmartButton("invite"); // Reset button
        showToast("Session Ended");
    }
};

/* --- 4. SMART BUTTON LOGIC --- */
function handleSmartClick() {
    if (coShop.isHost && coShop.conns.length > 0) {
        // If guests are connected -> END SESSION
        coShop.stopSession();
    } else {
        // If no one is connected -> OPEN INVITE
        toggleCoShop();
    }
}

function updateSmartButton(state) {
    if (state === "end") {
        smartBtn.innerText = "❌";
        smartBtn.style.color = "#ff4444";
        smartBtn.style.borderColor = "#ff4444";
    } else {
        smartBtn.innerText = "👥";
        smartBtn.style.color = "white";
        smartBtn.style.borderColor = "rgba(255,255,255,0.3)";
    }
}

/* --- 5. INITIALIZATION --- */
window.onload = async () => {
    initBackgroundFetch();
    coShop.init(); 
};

/* --- 6. CORE APP LOGIC --- */
async function selectJewelryType(type, fromSync = false) {
  if (coShop.active && !coShop.isHost && !fromSync) return; 
  if (currentType === type) return;
  currentType = type;
  const targetMode = (type === 'rings' || type === 'bangles') ? 'environment' : 'user';
  
  // Only restart local camera if we are NOT watching a remote stream
  if (!coShop.active || coShop.isHost) {
      if(videoElement.srcObject && !videoElement.classList.contains('remote-stream')) {
          await startCameraFast(targetMode); 
      }
  }

  earringImg = null; necklaceImg = null; ringImg = null; bangleImg = null;
  const container = document.getElementById('jewelry-options'); container.innerHTML = ''; 
  let assets = JEWELRY_ASSETS[type];
  if (!assets) assets = await fetchCategoryData(type);
  if (!assets || assets.length === 0) return;

  container.style.display = 'flex';
  const fragment = document.createDocumentFragment();
  assets.forEach((asset, i) => {
    const btnImg = new Image(); btnImg.src = asset.thumbSrc; btnImg.crossOrigin = 'anonymous'; btnImg.className = "thumb-btn"; btnImg.loading = "lazy"; 
    btnImg.onclick = () => { applyAssetInstantly(asset, i, true); }; 
    fragment.appendChild(btnImg);
  });
  container.appendChild(fragment);
  applyAssetInstantly(assets[0], 0, false); 
}

async function applyAssetInstantly(asset, index, shouldBroadcast = true) {
    if (shouldBroadcast && coShop.active && !coShop.isHost) { showToast("🔒 Watching Host Stream"); return; }
    currentAssetIndex = index; currentAssetName = asset.name; highlightButtonByIndex(index);
    const thumbImg = new Image(); thumbImg.src = asset.thumbSrc; thumbImg.crossOrigin = 'anonymous'; setActiveARImage(thumbImg);
    if (shouldBroadcast && coShop.active && coShop.isHost) coShop.sendUpdate(currentType, index);
    const highResImg = await loadAsset(asset.fullSrc, asset.id);
    if (currentAssetName === asset.name && highResImg) setActiveARImage(highResImg);
}

function highlightButtonByIndex(index) {
    const children = document.getElementById('jewelry-options').children;
    for (let i = 0; i < children.length; i++) {
        if (i === index) { children[i].style.borderColor = "var(--accent)"; children[i].style.transform = "scale(1.05)"; children[i].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); } 
        else { children[i].style.borderColor = "rgba(255,255,255,0.2)"; children[i].style.transform = "scale(1)"; }
    }
}

/* --- 7. CAMERA & AI LOOP --- */
async function startCameraFast(mode = 'user') {
    // Safety check: Don't override remote stream unless explicitly stopped
    if (videoElement.classList.contains('remote-stream') && coShop.active && !coShop.isHost) return;

    if (videoElement.srcObject && currentCameraMode === mode && videoElement.readyState >= 2) return;
    currentCameraMode = mode;
    if (videoElement.srcObject) { videoElement.srcObject.getTracks().forEach(track => track.stop()); }
    if (mode === 'environment') { videoElement.classList.add('no-mirror'); } else { videoElement.classList.remove('no-mirror'); }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: mode } });
        videoElement.srcObject = stream;
        videoElement.onloadeddata = () => { videoElement.play(); detectLoop(); };
    } catch (err) { alert("Camera Error: " + err.message); }
}

async function detectLoop() {
    if (videoElement.readyState >= 2) {
        if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); isProcessingFace = false; }
        if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); isProcessingHand = false; }
    }
    requestAnimationFrame(detectLoop);
}

/* --- 8. FETCH & ASSETS --- */
function initBackgroundFetch() { Object.keys(DRIVE_FOLDERS).forEach(key => { fetchCategoryData(key); }); }
function fetchCategoryData(category) {
    if (CATALOG_PROMISES[category]) return CATALOG_PROMISES[category];
    const fetchPromise = new Promise(async (resolve, reject) => {
        try {
            const folderId = DRIVE_FOLDERS[category];
            const query = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
            const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=1000&fields=files(id,name,thumbnailLink)&key=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            JEWELRY_ASSETS[category] = data.files.map(file => {
                const baseLink = file.thumbnailLink;
                let thumbSrc, fullSrc;
                if (baseLink) { thumbSrc = baseLink.replace(/=s\d+$/, "=s400"); fullSrc = baseLink.replace(/=s\d+$/, "=s3000"); } 
                else { thumbSrc = `https://drive.google.com/thumbnail?id=${file.id}`; fullSrc = `https://drive.google.com/uc?export=view&id=${file.id}`; }
                return { id: file.id, name: file.name, thumbSrc: thumbSrc, fullSrc: fullSrc };
            });
            if (category === 'earrings') setTimeout(checkDailyDrop, 2000);
            resolve(JEWELRY_ASSETS[category]);
        } catch (err) { console.error(`Error loading ${category}:`, err); resolve([]); }
    });
    CATALOG_PROMISES[category] = fetchPromise; return fetchPromise;
}
function loadAsset(src, id) { return new Promise((resolve) => { if (!src) { resolve(null); return; } if (IMAGE_CACHE[id]) { resolve(IMAGE_CACHE[id]); return; } const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { IMAGE_CACHE[id] = img; resolve(img); }; img.onerror = () => { resolve(null); }; img.src = src; }); }
function setActiveARImage(img) { if (currentType === 'earrings') earringImg = img; else if (currentType === 'chains') necklaceImg = img; else if (currentType === 'rings') ringImg = img; else if (currentType === 'bangles') bangleImg = img; }

function updatePhysics(headTilt, headX, width) { const gravityTarget = -headTilt; physics.earringVelocity += (gravityTarget - physics.earringAngle) * 0.1; physics.earringVelocity *= 0.92; physics.earringAngle += physics.earringVelocity; const headSpeed = (headX - physics.lastHeadX); physics.lastHeadX = headX; physics.swayOffset += headSpeed * -1.5; physics.swayOffset *= 0.85; if (physics.swayOffset > 0.5) physics.swayOffset = 0.5; if (physics.swayOffset < -0.5) physics.swayOffset = -0.5; }
const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
faceMesh.onResults((results) => {
  if (currentType !== 'earrings' && currentType !== 'chains') return;
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  
  // *** RENDER LOGIC UPDATE: Handle Zoom Class ***
  // If remote view, do NOT mirror. If local user, DO mirror.
  if (currentCameraMode === 'environment' || (coShop.active && !coShop.isHost)) { 
      canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); 
  } else { 
      canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); 
  }

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0]; 
    const leftEar = { x: lm[132].x * w, y: lm[132].y * h }; const rightEar = { x: lm[361].x * w, y: lm[361].y * h };
    const neck = { x: lm[152].x * w, y: lm[152].y * h }; const nose = { x: lm[1].x * w, y: lm[1].y * h };
    const headTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
    updatePhysics(headTilt, lm[1].x, w);
    const earDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
    const distToLeft = Math.hypot(nose.x - leftEar.x, nose.y - leftEar.y);
    const distToRight = Math.hypot(nose.x - rightEar.x, nose.y - rightEar.y);
    const ratio = distToLeft / (distToLeft + distToRight);
    const showLeft = ratio > 0.25; const showRight = ratio < 0.75; 
    if (earringImg && earringImg.complete) {
      let ew = earDist * 0.25; let eh = (earringImg.height/earringImg.width) * ew;
      const xShift = ew * 0.05; const totalAngle = physics.earringAngle + (physics.swayOffset * 0.5);
      canvasCtx.shadowColor = "rgba(0,0,0,0.5)"; canvasCtx.shadowBlur = 15; canvasCtx.shadowOffsetX = 2; canvasCtx.shadowOffsetY = 5;
      if (showLeft) { canvasCtx.save(); canvasCtx.translate(leftEar.x, leftEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) - xShift, -eh * 0.20, ew, eh); canvasCtx.restore(); }
      if (showRight) { canvasCtx.save(); canvasCtx.translate(rightEar.x, rightEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) + xShift, -eh * 0.20, ew, eh); canvasCtx.restore(); }
      canvasCtx.shadowColor = "transparent";
    }
    if (necklaceImg && necklaceImg.complete) { const nw = earDist * 0.85; const nh = (necklaceImg.height/necklaceImg.width) * nw; canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (nw*0.1), nw, nh); }
  }
  canvasCtx.restore();
});
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
function calculateAngle(p1, p2) { return Math.atan2(p2.y - p1.y, p2.x - p1.x); }
hands.onResults((results) => {
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  if (currentType !== 'rings' && currentType !== 'bangles') return;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      const mcp = { x: lm[13].x * w, y: lm[13].y * h }; const pip = { x: lm[14].x * w, y: lm[14].y * h };
      const targetRingAngle = calculateAngle(mcp, pip) - (Math.PI / 2);
      const targetRingWidth = Math.hypot(pip.x - mcp.x, pip.y - mcp.y) * 0.6; 
      const wrist = { x: lm[0].x * w, y: lm[0].y * h }; 
      const targetArmAngle = calculateAngle(wrist, { x: lm[9].x * w, y: lm[9].y * h }) - (Math.PI / 2);
      const targetBangleWidth = Math.hypot((lm[17].x*w)-(lm[5].x*w), (lm[17].y*h)-(lm[5].y*h)) * 1.25; 
      if (!handSmoother.active) { handSmoother.ring = { x: mcp.x, y: mcp.y, angle: targetRingAngle, size: targetRingWidth }; handSmoother.bangle = { x: wrist.x, y: wrist.y, angle: targetArmAngle, size: targetBangleWidth }; handSmoother.active = true; } 
      else { handSmoother.ring.x = lerp(handSmoother.ring.x, mcp.x, SMOOTH_FACTOR); handSmoother.ring.y = lerp(handSmoother.ring.y, mcp.y, SMOOTH_FACTOR); handSmoother.ring.angle = lerp(handSmoother.ring.angle, targetRingAngle, SMOOTH_FACTOR); handSmoother.ring.size = lerp(handSmoother.ring.size, targetRingWidth, SMOOTH_FACTOR); handSmoother.bangle.x = lerp(handSmoother.bangle.x, wrist.x, SMOOTH_FACTOR); handSmoother.bangle.y = lerp(handSmoother.bangle.y, wrist.y, SMOOTH_FACTOR); handSmoother.bangle.angle = lerp(handSmoother.bangle.angle, targetArmAngle, SMOOTH_FACTOR); handSmoother.bangle.size = lerp(handSmoother.bangle.size, targetBangleWidth, SMOOTH_FACTOR); }
      canvasCtx.shadowColor = "rgba(0,0,0,0.4)"; canvasCtx.shadowBlur = 10; canvasCtx.shadowOffsetY = 5;
      if (ringImg && ringImg.complete) { const rHeight = (ringImg.height / ringImg.width) * handSmoother.ring.size; canvasCtx.save(); canvasCtx.translate(handSmoother.ring.x, handSmoother.ring.y); canvasCtx.rotate(handSmoother.ring.angle); canvasCtx.drawImage(ringImg, -handSmoother.ring.size/2, (handSmoother.ring.size/0.6)*0.15, handSmoother.ring.size, rHeight); canvasCtx.restore(); }
      if (bangleImg && bangleImg.complete) { const bHeight = (bangleImg.height / bangleImg.width) * handSmoother.bangle.size; canvasCtx.save(); canvasCtx.translate(handSmoother.bangle.x, handSmoother.bangle.y); canvasCtx.rotate(handSmoother.bangle.angle); canvasCtx.drawImage(bangleImg, -handSmoother.bangle.size/2, -bHeight/2, handSmoother.bangle.size, bHeight); canvasCtx.restore(); }
      canvasCtx.shadowColor = "transparent";
  }
  canvasCtx.restore();
});

window.toggleCoShop = toggleCoShop; window.closeCoShopModal = closeCoShopModal; window.copyInviteLink = copyInviteLink; window.sendVote = (val) => coShop.sendVote(val); window.handleSmartClick = handleSmartClick; window.takeSnapshot = takeSnapshot; window.downloadSingleSnapshot = downloadSingleSnapshot; window.shareSingleSnapshot = shareSingleSnapshot; window.toggleTryAll = toggleTryAll; window.changeLightboxImage = changeLightboxImage; window.closePreview = closePreview; window.closeGallery = closeGallery; window.closeLightbox = closeLightbox; window.tryDailyItem = tryDailyItem; window.closeDailyDrop = closeDailyDrop; window.downloadAllAsZip = downloadAllAsZip;

function toggleCoShop() { const modal = document.getElementById('coshop-modal'); if (coShop.myId) { document.getElementById('invite-link-box').innerText = window.location.origin + window.location.pathname + "?room=" + coShop.myId; modal.style.display = 'flex'; } else { showToast("Generating ID..."); } }
function closeCoShopModal() { document.getElementById('coshop-modal').style.display = 'none'; }
function copyInviteLink() { const text = document.getElementById('invite-link-box').innerText; navigator.clipboard.writeText(text).then(() => showToast("Link Copied!")); }
function triggerFlash() { if(!flashOverlay) return; flashOverlay.classList.remove('flash-active'); void flashOverlay.offsetWidth; flashOverlay.classList.add('flash-active'); setTimeout(() => { flashOverlay.classList.remove('flash-active'); }, 300); }
function toggleTryAll() { if (coShop.active && !coShop.isHost) { showToast("🔒 Watching Host Stream"); return; } if (!currentType) { alert("Select category!"); return; } if (autoTryRunning) stopAutoTry(); else startAutoTry(); }
function startAutoTry() { autoTryRunning = true; autoSnapshots = []; autoTryIndex = 0; document.getElementById('tryall-btn').textContent = "STOP"; runAutoStep(); }
function stopAutoTry() { autoTryRunning = false; clearTimeout(autoTryTimeout); document.getElementById('tryall-btn').textContent = "Try All"; if (autoSnapshots.length > 0) showGallery(); }
async function runAutoStep() { if (!autoTryRunning) return; const assets = JEWELRY_ASSETS[currentType]; if (!assets || autoTryIndex >= assets.length) { stopAutoTry(); return; } const asset = assets[autoTryIndex]; const highResImg = await loadAsset(asset.fullSrc, asset.id); setActiveARImage(highResImg); currentAssetName = asset.name; autoTryTimeout = setTimeout(() => { triggerFlash(); captureToGallery(); autoTryIndex++; runAutoStep(); }, 1500); }
function captureToGallery() { const tempCanvas = document.createElement('canvas'); tempCanvas.width = videoElement.videoWidth; tempCanvas.height = videoElement.videoHeight; const tempCtx = tempCanvas.getContext('2d'); if (currentCameraMode === 'environment') { tempCtx.translate(0, 0); tempCtx.scale(1, 1); } else { tempCtx.translate(tempCanvas.width, 0); tempCtx.scale(-1, 1); } tempCtx.drawImage(videoElement, 0, 0); tempCtx.setTransform(1, 0, 0, 1, 0, 0); try { tempCtx.drawImage(canvasElement, 0, 0); } catch(e) {} let cleanName = currentAssetName.replace(/\.(png|jpg|jpeg|webp)$/i, "").replace(/_/g, " "); cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1); const padding = tempCanvas.width * 0.04; const titleSize = tempCanvas.width * 0.045; const descSize = tempCanvas.width * 0.035; const contentHeight = (titleSize * 2) + descSize + padding; const gradient = tempCtx.createLinearGradient(0, tempCanvas.height - contentHeight - padding, 0, tempCanvas.height); gradient.addColorStop(0, "rgba(0,0,0,0)"); gradient.addColorStop(0.2, "rgba(0,0,0,0.8)"); gradient.addColorStop(1, "rgba(0,0,0,0.95)"); tempCtx.fillStyle = gradient; tempCtx.fillRect(0, tempCanvas.height - contentHeight - padding, tempCanvas.width, contentHeight + padding); tempCtx.font = `bold ${titleSize}px Playfair Display, serif`; tempCtx.fillStyle = "#d4af37"; tempCtx.textAlign = "left"; tempCtx.textBaseline = "top"; tempCtx.fillText("Product Description", padding, tempCanvas.height - contentHeight); tempCtx.font = `${descSize}px Montserrat, sans-serif`; tempCtx.fillStyle = "#ffffff"; tempCtx.fillText(cleanName, padding, tempCanvas.height - contentHeight + (titleSize * 1.5)); if (watermarkImg.complete) { const wWidth = tempCanvas.width * 0.25; const wHeight = (watermarkImg.height / watermarkImg.width) * wWidth; tempCtx.drawImage(watermarkImg, tempCanvas.width - wWidth - padding, padding, wWidth, wHeight); } const dataUrl = tempCanvas.toDataURL('image/png'); const safeName = "Jewels_Look"; autoSnapshots.push({ url: dataUrl, name: `${safeName}_${Date.now()}.png` }); return { url: dataUrl, name: `${safeName}_${Date.now()}.png` }; }
function takeSnapshot() { triggerFlash(); const shotData = captureToGallery(); currentPreviewData = shotData; document.getElementById('preview-image').src = shotData.url; document.getElementById('preview-modal').style.display = 'flex'; }
function downloadSingleSnapshot() { if(!currentPreviewData.url) return; saveAs(currentPreviewData.url, currentPreviewData.name); }
function downloadAllAsZip() { if (autoSnapshots.length === 0) return; const zip = new JSZip(); const folder = zip.folder("Jewels-Ai_Collection"); autoSnapshots.forEach(item => folder.file(item.name, item.url.replace(/^data:image\/(png|jpg);base64,/, ""), {base64:true})); zip.generateAsync({type:"blob"}).then(content => saveAs(content, "Jewels-Ai_Collection.zip")); }
function shareSingleSnapshot() { if(!currentPreviewData.url) return; fetch(currentPreviewData.url).then(res => res.blob()).then(blob => { const file = new File([blob], "look.png", { type: "image/png" }); if (navigator.share) navigator.share({ files: [file] }); }); }
function changeLightboxImage(dir) { if (autoSnapshots.length === 0) return; currentLightboxIndex = (currentLightboxIndex + dir + autoSnapshots.length) % autoSnapshots.length; document.getElementById('lightbox-image').src = autoSnapshots[currentLightboxIndex].url; }
function showGallery() { const grid = document.getElementById('gallery-grid'); grid.innerHTML = ''; autoSnapshots.forEach((item, index) => { const card = document.createElement('div'); card.className = "gallery-card"; const img = document.createElement('img'); img.src = item.url; img.className = "gallery-img"; const overlay = document.createElement('div'); overlay.className = "gallery-overlay"; let cleanName = item.name.replace("Jewels-Ai_", "").replace(".png", "").substring(0,12); overlay.innerHTML = `<span class="overlay-text">${cleanName}</span><div class="overlay-icon">👁️</div>`; card.onclick = () => { currentLightboxIndex = index; document.getElementById('lightbox-image').src = item.url; document.getElementById('lightbox-overlay').style.display = 'flex'; }; card.appendChild(img); card.appendChild(overlay); grid.appendChild(card); }); document.getElementById('gallery-modal').style.display = 'flex'; }
function closePreview() { document.getElementById('preview-modal').style.display = 'none'; }
function closeGallery() { document.getElementById('gallery-modal').style.display = 'none'; }
function closeLightbox() { document.getElementById('lightbox-overlay').style.display = 'none'; }
function showReaction(type) { const container = document.getElementById('reaction-container'); const el = document.createElement('div'); el.innerText = type === 'love' ? '❤️' : '👎'; el.className = 'floating-reaction'; el.style.left = Math.random() * 80 + 10 + '%'; container.appendChild(el); setTimeout(() => el.remove(), 2000); }
function checkDailyDrop() { const today = new Date().toDateString(); const lastSeen = localStorage.getItem('jewels_daily_date'); if (lastSeen !== today && JEWELRY_ASSETS['earrings'] && JEWELRY_ASSETS['earrings'].length > 0) { const list = JEWELRY_ASSETS['earrings']; const randomIdx = Math.floor(Math.random() * list.length); dailyItem = { item: list[randomIdx], index: randomIdx, type: 'earrings' }; document.getElementById('daily-img').src = dailyItem.item.thumbSrc; let cleanName = dailyItem.item.name.replace(/\.[^/.]+$/, "").replace(/_/g, " "); document.getElementById('daily-name').innerText = cleanName; document.getElementById('daily-drop-modal').style.display = 'flex'; localStorage.setItem('jewels_daily_date', today); } }
function closeDailyDrop() { document.getElementById('daily-drop-modal').style.display = 'none'; }
function tryDailyItem() { closeDailyDrop(); if (dailyItem) { selectJewelryType(dailyItem.type).then(() => { applyAssetInstantly(dailyItem.item, dailyItem.index, true); }); } }