/* script.js - Jewels-Ai Atelier: v5.1 (Group Party Mode) */

/* --- CONFIGURATION --- */
const API_KEY = "AIzaSyAXG3iG2oQjUA_BpnO8dK8y-MHJ7HLrhyE"; 

const DRIVE_FOLDERS = {
  earrings: "1eftKhpOHbCj8hzO11-KioFv03g0Yn61n",
  chains: "1G136WEiA9QBSLtRk0LW1fRb3HDZb4VBD",
  rings: "1iB1qgTE-Yl7w-CVsegecniD_DzklQk90",
  bangles: "1d2b7I8XlhIEb8S_eXnRFBEaNYSwngnba"
};

/* --- ASSETS & STATE --- */
const JEWELRY_ASSETS = {}; 
const CATALOG_PROMISES = {}; 
const IMAGE_CACHE = {}; 
let dailyItem = null; 

const watermarkImg = new Image(); watermarkImg.src = 'logo_watermark.png'; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');
const flashOverlay = document.getElementById('flash-overlay'); 

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     

/* Tracking Variables */
let currentAssetName = "Select a Design"; 
let currentAssetIndex = 0; 

/* Physics State */
let physics = { 
    earringAngle: 0, earringVelocity: 0, swayOffset: 0, lastHeadX: 0      
};

/* Camera State */
let currentCameraMode = 'user'; 

/* Auto Try State */
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 

/* Stabilizer Variables */
const SMOOTH_FACTOR = 0.8; 
let handSmoother = {
    active: false,
    ring: { x: 0, y: 0, angle: 0, size: 0 },
    bangle: { x: 0, y: 0, angle: 0, size: 0 }
};

/* --- CO-SHOPPING ENGINE (GROUP PARTY VERSION) --- */
const coShop = {
    peer: null,
    conns: [], // Stores connections to ALL friends
    myId: null,
    active: false,
    
    init: function() {
        // Initialize PeerJS
        this.peer = new Peer(null, { debug: 2 });
        
        // When I get my ID
        this.peer.on('open', (id) => {
            this.myId = id;
            console.log("My Peer ID: " + id);
            this.checkForInvite();
        });

        // When a friend joins ME
        this.peer.on('connection', (c) => {
            this.handleConnection(c);
            showToast("New Friend Joined!");
            this.activateUI();
        });

        this.peer.on('error', (err) => console.error("PeerJS Error:", err));
    },

    checkForInvite: function() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        if (roomId) {
            console.log("Joining Party: " + roomId);
            this.connectToHost(roomId);
        }
    },

    // Guests connect to the Host
    connectToHost: function(hostId) {
        let conn = this.peer.connect(hostId);
        this.handleConnection(conn);
    },

    handleConnection: function(c) {
        c.on('open', () => {
            // Add this new friend to our list
            this.conns.push(c); 
            console.log("Connected to: " + c.peer);
            
            this.activateUI();
            
            // Listen for data from this specific friend
            c.on('data', (data) => this.handleData(data, c));
            
            // If they leave, remove them from the list
            c.on('close', () => {
                this.conns = this.conns.filter(p => p !== c);
                showToast("Friend Left");
            });
        });
    },

    handleData: function(data, senderConn) {
        console.log("Received:", data);
        
        if (data.type === 'SYNC_ITEM') {
            // 1. Update MY screen locally (without broadcasting back)
            selectJewelryType(data.cat).then(() => {
                applyAssetInstantly(JEWELRY_ASSETS[data.cat][data.idx], data.idx, false);
            });
            
            // 2. (Relay) If I am the Host, send this update to everyone else!
            this.broadcast(data, senderConn);
            
        } else if (data.type === 'VOTE') {
            showReaction(data.val);
            // Relay votes to everyone else too
            this.broadcast(data, senderConn);
        }
    },

    // Send data to EVERYONE connected (except the sender)
    broadcast: function(data, excludeConn = null) {
        this.conns.forEach(c => {
            if (c.open && c !== excludeConn) {
                c.send(data);
            }
        });
    },

    // When YOU change jewelry, tell everyone
    sendUpdate: function(category, index) {
        this.broadcast({ type: 'SYNC_ITEM', cat: category, idx: index });
    },

    // When YOU vote, tell everyone
    sendVote: function(val) {
        this.broadcast({ type: 'VOTE', val: val });
        showReaction(val); // Show on my screen too
    },
    
    activateUI: function() {
        this.active = true;
        document.getElementById('voting-ui').style.display = 'flex';
        document.getElementById('coshop-btn').style.color = '#00ff00';
    }
};

/* --- HELPER: LERP --- */
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }

/* --- 1. DAILY DROP FEATURE --- */
function checkDailyDrop() {
    const today = new Date().toDateString();
    const lastSeen = localStorage.getItem('jewels_daily_date');

    if (lastSeen !== today && JEWELRY_ASSETS['earrings'] && JEWELRY_ASSETS['earrings'].length > 0) {
        const list = JEWELRY_ASSETS['earrings'];
        const randomIdx = Math.floor(Math.random() * list.length);
        dailyItem = { item: list[randomIdx], index: randomIdx, type: 'earrings' };
        
        document.getElementById('daily-img').src = dailyItem.item.thumbSrc;
        let cleanName = dailyItem.item.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
        document.getElementById('daily-name').innerText = cleanName;
        document.getElementById('daily-drop-modal').style.display = 'flex';
        localStorage.setItem('jewels_daily_date', today);
    }
}

function closeDailyDrop() { document.getElementById('daily-drop-modal').style.display = 'none'; }

function tryDailyItem() {
    closeDailyDrop();
    if (dailyItem) {
        selectJewelryType(dailyItem.type).then(() => {
            applyAssetInstantly(dailyItem.item, dailyItem.index, true);
        });
    }
}

/* --- 2. PHYSICS ENGINE --- */
function updatePhysics(headTilt, headX, width) {
    const gravityTarget = -headTilt; 
    physics.earringVelocity += (gravityTarget - physics.earringAngle) * 0.1; 
    physics.earringVelocity *= 0.92; 
    physics.earringAngle += physics.earringVelocity;

    const headSpeed = (headX - physics.lastHeadX); 
    physics.lastHeadX = headX;
    physics.swayOffset += headSpeed * -1.5; 
    physics.swayOffset *= 0.85; 
    if (physics.swayOffset > 0.5) physics.swayOffset = 0.5;
    if (physics.swayOffset < -0.5) physics.swayOffset = -0.5;
}

/* --- 3. BACKGROUND FETCHING --- */
function initBackgroundFetch() {
    Object.keys(DRIVE_FOLDERS).forEach(key => { fetchCategoryData(key); });
}

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
                if (baseLink) {
                    thumbSrc = baseLink.replace(/=s\d+$/, "=s400");
                    fullSrc = baseLink.replace(/=s\d+$/, "=s3000");
                } else {
                    thumbSrc = `https://drive.google.com/thumbnail?id=${file.id}`;
                    fullSrc = `https://drive.google.com/uc?export=view&id=${file.id}`;
                }
                return { id: file.id, name: file.name, thumbSrc: thumbSrc, fullSrc: fullSrc };
            });
            if (category === 'earrings') setTimeout(checkDailyDrop, 2000);
            resolve(JEWELRY_ASSETS[category]);
        } catch (err) { console.error(`Error loading ${category}:`, err); resolve([]); }
    });
    CATALOG_PROMISES[category] = fetchPromise;
    return fetchPromise;
}

/* --- 4. ASSET LOADING --- */
function loadAsset(src, id) {
    return new Promise((resolve) => {
        if (!src) { resolve(null); return; }
        if (IMAGE_CACHE[id]) { resolve(IMAGE_CACHE[id]); return; }
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { IMAGE_CACHE[id] = img; resolve(img); };
        img.onerror = () => { resolve(null); };
        img.src = src;
    });
}
function setActiveARImage(img) {
    if (currentType === 'earrings') earringImg = img;
    else if (currentType === 'chains') necklaceImg = img;
    else if (currentType === 'rings') ringImg = img;
    else if (currentType === 'bangles') bangleImg = img;
}

/* --- 5. INITIALIZATION --- */
window.onload = async () => {
    initBackgroundFetch();
    coShop.init(); // Initialize Multiplayer Group
    await startCameraFast('user');
    setTimeout(() => { loadingStatus.style.display = 'none'; }, 2000);
    await selectJewelryType('earrings');
};

/* --- 6. CORE APP LOGIC --- */
async function selectJewelryType(type) {
  if (currentType === type) return;
  currentType = type;
  
  const targetMode = (type === 'rings' || type === 'bangles') ? 'environment' : 'user';
  startCameraFast(targetMode); 

  earringImg = null; necklaceImg = null; ringImg = null; bangleImg = null;
  const container = document.getElementById('jewelry-options'); 
  container.innerHTML = ''; 
  
  let assets = JEWELRY_ASSETS[type];
  if (!assets) assets = await fetchCategoryData(type);
  if (!assets || assets.length === 0) return;

  container.style.display = 'flex';
  const fragment = document.createDocumentFragment();
  
  assets.forEach((asset, i) => {
    const btnImg = new Image(); btnImg.src = asset.thumbSrc; btnImg.crossOrigin = 'anonymous'; btnImg.className = "thumb-btn"; btnImg.loading = "lazy"; 
    btnImg.onclick = () => { applyAssetInstantly(asset, i, true); }; // Pass TRUE to broadcast
    fragment.appendChild(btnImg);
  });
  container.appendChild(fragment);
  applyAssetInstantly(assets[0], 0, false); // Don't broadcast initial load
}

async function applyAssetInstantly(asset, index, shouldBroadcast = true) {
    currentAssetIndex = index; currentAssetName = asset.name; highlightButtonByIndex(index);
    const thumbImg = new Image(); thumbImg.src = asset.thumbSrc; thumbImg.crossOrigin = 'anonymous'; setActiveARImage(thumbImg);
    
    // Broadcast to ALL friends
    if (shouldBroadcast && coShop.active) {
        coShop.sendUpdate(currentType, index);
    }

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