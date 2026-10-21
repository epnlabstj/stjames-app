let CIRCUIT_HISTORIQUE = [];
let CIRCUIT_EVENEMENTIEL = [];
let activeCircuit = 'evenementiel';
let activeStopId = 201;
let map = null;
let markers = {};
let userLocationMarker = null;
let userLocationCircle = null;
let html5QrCode = null;
let unlockedBadges = JSON.parse(localStorage.getItem('stjames_badges_v10') || '[]');
let currentAudioElement = null;
let deferredPrompt = null;

// Enregistrement PWA Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker OK'))
            .catch(err => console.warn('Service Worker non actif:', err));
    });
}

// Prompt Installation
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBanner = document.getElementById('installBanner');
    if (installBanner) installBanner.classList.remove('hidden');
});

function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            deferredPrompt = null;
            const installBanner = document.getElementById('installBanner');
            if (installBanner) installBanner.classList.add('hidden');
        });
    }
}

window.onload = function() {
    fetch('./data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error("Erreur HTTP " + response.status);
            }
            return response.json();
        })
        .then(data => {
            CIRCUIT_HISTORIQUE = data.circuit_principal || [];
            CIRCUIT_EVENEMENTIEL = data.circuit_evenementiel || [];
            initMap();
            if (CIRCUIT_EVENEMENTIEL.length > 0) {
                activeStopId = CIRCUIT_EVENEMENTIEL[0].id;
            }
            renderActiveStop(activeStopId);
            updateBadgeCount();
            startLiveGeolocation();
        })
        .catch(err => {
            console.error("Erreur de chargement de data.json:", err);
            const container = document.getElementById('stopDetailView');
            if (container) {
                container.innerHTML = `
                    <div class="p-6 bg-red-900/40 border border-red-500/50 rounded-2xl text-center space-y-3">
                        <i class="fa-solid fa-triangle-exclamation text-3xl text-red-400"></i>
                        <h3 class="text-base font-bold text-red-200">Erreur de chargement des données</h3>
                        <p class="text-xs text-slate-300">Impossible d'accéder à <code>data.json</code>.</p>
                        <p class="text-[11px] text-slate-400">Vérifiez que le fichier data.json est présent dans le même dossier.</p>
                    </div>
                `;
            }
        });
};

function getActiveList() {
    return activeCircuit === 'historique' ? CIRCUIT_HISTORIQUE : CIRCUIT_EVENEMENTIEL;
}

function initMap() {
    const center = [48.5235, -1.3210];
    map = L.map('map', { zoomControl: false }).setView(center, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    redrawMapMarkers();
}

function redrawMapMarkers() {
    for (let id in markers) {
        map.removeLayer(markers[id]);
    }
    markers = {};

    const list = getActiveList();
    const routeCoords = list.map(s => [s.lat, s.lng]);
    
    if (activeCircuit === 'historique' && routeCoords.length > 0) {
        L.polyline(routeCoords, { color: '#D4AF37', weight: 4, dashArray: '6, 8', opacity: 0.85 }).addTo(map);
    } else if (activeCircuit === 'evenementiel' && routeCoords.length > 0) {
        L.polyline(routeCoords, { color: '#3b82f6', weight: 4, dashArray: '6, 8', opacity: 0.85 }).addTo(map);
    }

    list.forEach((stop, index) => {
        const isEvent = (activeCircuit === 'evenementiel');
        const displayLabel = isEvent ? (index + 1) : stop.id;
        const bgColor = isEvent ? (stop.id === activeStopId ? 'bg-blue-500 text-white border-blue-300 ring-4 ring-blue-500/40 scale-110' : 'bg-slate-900 text-blue-400 border-blue-500/50')
                                : (stop.id === activeStopId ? 'bg-amber-400 text-slate-950 border-amber-300 ring-4 ring-amber-500/40 scale-110' : 'bg-slate-900 text-amber-400 border-amber-500/50');
        
        const markerIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div id="map-marker-${stop.id}" onclick="selectStop(${stop.id})" class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 cursor-pointer shadow-xl transition-all transform hover:scale-110 ${bgColor}">${displayLabel}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        const marker = L.marker([stop.lat, stop.lng], { icon: markerIcon }).addTo(map);
        marker.bindTooltip(stop.title, { direction: 'top', offset: [0, -8] });
        markers[stop.id] = marker;
    });
}

function switchCircuit(circuitType) {
    activeCircuit = circuitType;
    const list = getActiveList();
    if (list.length > 0) {
        activeStopId = list[0].id;
    }
    
    const btnHist = document.getElementById('btnCircuitHist');
    const btnEvent = document.getElementById('btnCircuitEvent');
    if (activeCircuit === 'historique') {
        btnHist.className = "px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs transition shadow-md flex items-center gap-1.5";
        btnEvent.className = "px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition flex items-center gap-1.5";
    } else {
        btnEvent.className = "px-3 py-1.5 rounded-lg bg-blue-500 text-white font-bold text-xs transition shadow-md flex items-center gap-1.5";
        btnHist.className = "px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition flex items-center gap-1.5";
    }

    redrawMapMarkers();
    renderActiveStop(activeStopId);
}

function resetMapView() { 
    if (map) {
        const list = getActiveList();
        if (list.length > 0) {
            map.setView([list[0].lat, list[0].lng], 15);
        }
    } 
}

function updateUserPositionOnMap(lat, lng, accuracy) {
    const googleMapsDotIcon = L.divIcon({
        className: 'google-maps-user-dot',
        html: `<div style="position:relative; width:24px; height:24px;">
                 <div style="position:absolute; top:-4px; left:-4px; width:32px; height:32px; background:rgba(56,189,248,0.4); border-radius:50%; animation: pulse-ring 1.5s infinite;"></div>
                 <div style="position:absolute; top:0; left:0; width:24px; height:24px; background:#0284c7; border:3px solid #ffffff; border-radius:50%; box-shadow:0 0 8px rgba(0,0,0,0.5);"></div>
               </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    if (userLocationMarker) {
        userLocationMarker.setLatLng([lat, lng]);
        userLocationMarker.setIcon(googleMapsDotIcon);
        if (userLocationCircle) {
            userLocationCircle.setLatLng([lat, lng]);
            userLocationCircle.setRadius(accuracy || 25);
        }
    } else {
        userLocationMarker = L.marker([lat, lng], { icon: googleMapsDotIcon, zIndexOffset: 9999 }).addTo(map).bindPopup("<b class='text-xs'>Vous êtes ici (Position GPS)</b>");
        userLocationCircle = L.circle([lat, lng], { radius: accuracy || 25, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.2, weight: 1.5 }).addTo(map);
    }
    
    const statusText = document.getElementById('gpsStatusText');
    if (statusText) {
        statusText.innerHTML = "<span class='text-sky-400 font-bold'><i class='fa-solid fa-location-dot mr-1.5'></i>GPS Actif :</span> " + lat.toFixed(5) + ", " + lng.toFixed(5);
    }
}

function startLiveGeolocation() {
    if ("geolocation" in navigator) {
        const geoOptions = {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 5000
        };

        navigator.geolocation.watchPosition(
            position => {
                updateUserPositionOnMap(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
            },
            error => {
                console.warn("Erreur GPS (watchPosition):", error.code, error.message);
                const statusText = document.getElementById('gpsStatusText');
                if (statusText) {
                    statusText.innerHTML = "<span class='text-amber-300'><i class='fa-solid fa-triangle-exclamation mr-1'></i>GPS : En attente de signal...</span>";
                }
            },
            geoOptions
        );
    }
}

function locateUser() {
    if ("geolocation" in navigator) {
        const geoOptions = {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                updateUserPositionOnMap(lat, lng, position.coords.accuracy);
                map.setView([lat, lng], 17);
                if (userLocationMarker) userLocationMarker.openPopup();
            },
            error => {
                console.warn("Erreur GPS (getCurrentPosition):", error.code, error.message);
                let errorMsg = "Impossible de récupérer votre position.";
                if (error.code === error.PERMISSION_DENIED) {
                    errorMsg = "L'accès à la géolocalisation a été refusé. Vérifiez les réglages de votre navigateur.";
                } else if (error.code === error.TIMEOUT) {
                    errorMsg = "Délai dépassé : signal GPS trop faible (êtes-vous à l'intérieur ?).";
                }
                alert(errorMsg);
            },
            geoOptions
        );
    } else {
        alert("La géolocalisation n'est pas disponible sur votre appareil.");
    }
}

function simulateUserGPS() {
    const simLat = 48.523437;
    const simLng = -1.321588;
    updateUserPositionOnMap(simLat, simLng, 15);
    map.setView([simLat, simLng], 17);
    if (userLocationMarker) userLocationMarker.openPopup();
    alert("Position GPS simulée sur la Place Calvaire !");
}

function selectStop(stopId) {
    activeStopId = stopId;
    if (currentAudioElement) {
        currentAudioElement.pause();
        currentAudioElement = null;
    }
    renderActiveStop(stopId);
    
    const list = getActiveList();
    list.forEach(s => {
        const el = document.getElementById(`map-marker-${s.id}`);
        if (el) {
            const isEvent = (activeCircuit === 'evenementiel');
            if (s.id === stopId) {
                el.className = isEvent 
                    ? "w-8 h-8 rounded-full flex items-center justify-center font-bold font-medieval text-xs border-2 cursor-pointer shadow-xl transition-all transform scale-110 bg-blue-500 text-white border-blue-300 ring-4 ring-blue-500/40"
                    : "w-8 h-8 rounded-full flex items-center justify-center font-bold font-medieval text-xs border-2 cursor-pointer shadow-xl transition-all transform scale-110 bg-amber-400 text-slate-950 border-amber-300 ring-4 ring-amber-500/40";
            } else {
                el.className = isEvent
                    ? "w-8 h-8 rounded-full flex items-center justify-center font-bold font-medieval text-xs border-2 cursor-pointer shadow-xl transition-all transform bg-slate-900 text-blue-400 border-blue-500/50"
                    : "w-8 h-8 rounded-full flex items-center justify-center font-bold font-medieval text-xs border-2 cursor-pointer shadow-xl transition-all transform bg-slate-900 text-amber-400 border-amber-500/50";
            }
        }
    });
    const targetStop = list.find(s => s.id === stopId);
    if (targetStop && map) map.panTo([targetStop.lat, targetStop.lng]);
}

function renderActiveStop(stopId) {
    const list = getActiveList();
    const stop = list.find(s => s.id === stopId) || list[0];
    if (!stop) return;
    const isBadgeEarned = unlockedBadges.includes(stop.id);
    const container = document.getElementById('stopDetailView');
    const isEvent = (activeCircuit === 'evenementiel');
    
    let orgSection = '';
    if (stop.organisateur) {
        orgSection = `
            <div class="bg-slate-900/90 border border-blue-500/30 rounded-xl p-3 flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-bold"><i class="fa-solid fa-users"></i></div>
                <div>
                    <span class="text-[10px] uppercase font-bold text-blue-400 tracking-wider">Organisation</span>
                    <p class="text-xs font-semibold text-slate-200">${stop.organisateur}</p>
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="flex items-center justify-between bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            <button onclick="navigateStop(-1)" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1"><i class="fa-solid fa-chevron-left"></i> Précédent</button>
            <span class="text-xs font-semibold ${isEvent ? 'text-blue-400' : 'text-amber-400'} uppercase tracking-widest font-medieval">${isEvent ? 'Événement' : 'Étape'} (${list.indexOf(stop) + 1} / ${list.length})</span>
            <button onclick="navigateStop(1)" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1">Suivant <i class="fa-solid fa-chevron-right"></i></button>
        </div>

        <!-- CARTE CARTE DETAIL CORRIGEE -->
        <div class="relative rounded-2xl overflow-hidden border ${isEvent ? 'border-blue-500/30' : 'border-amber-500/30'} bg-slate-900 shadow-2xl min-h-[14rem] flex flex-col justify-between p-4">
            <img src="${stop.image}" alt="${stop.title}" class="absolute inset-0 w-full h-full object-cover z-0" onerror="this.style.display='none';"/>
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/30 z-10 pointer-events-none"></div>

            <div class="relative z-20 self-start">
                <span class="inline-flex items-center gap-1.5 bg-slate-900/90 backdrop-blur px-3 py-1.5 rounded-full border ${isEvent ? 'border-blue-500/40 text-blue-300' : 'border-amber-500/40 text-amber-300'} text-xs font-bold shadow-md">
                    <i class="fa-solid fa-calendar-days"></i> ${stop.subtitle}
                </span>
            </div>

            <div class="relative z-20 mt-8 pointer-events-none">
                <span class="${isEvent ? 'text-blue-400' : 'text-amber-400'} font-bold text-xs uppercase tracking-wider block mb-1">${stop.subtitle}</span>
                <h2 class="font-medieval text-lg sm:text-2xl font-bold text-white leading-snug">${stop.title}</h2>
            </div>
        </div>

        ${orgSection}

        <div class="bg-slate-900/90 rounded-2xl border ${isEvent ? 'border-blue-500/30' : 'border-amber-500/30'} p-4 shadow-xl space-y-3">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                    <div class="w-8 h-8 rounded-lg ${isEvent ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'} flex items-center justify-center"><i class="fa-solid fa-headphones"></i></div>
                    <div>
                        <h4 class="text-xs font-bold text-slate-200">Guide Audio Personnel</h4>
                        <p class="text-[10px] text-slate-400" id="audioStatusText">Fichier : <strong class="text-slate-200">${stop.audioFile}</strong></p>
                    </div>
                </div>
            </div>
            
            <audio id="nativeAudio" src="${stop.audioFile}" preload="metadata"></audio>

            <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden cursor-pointer" onclick="seekAudioNative(event)">
                <div id="audioProgressBar" class="bg-gradient-to-r ${isEvent ? 'from-blue-600 to-sky-400' : 'from-amber-600 to-yellow-400'} h-full w-0 transition-all"></div>
            </div>

            <button onclick="toggleNativeAudio()" id="playAudioBtn" class="w-full py-2.5 bg-gradient-to-r ${isEvent ? 'from-blue-500 to-sky-400 hover:from-blue-600 hover:to-sky-500 text-white' : 'from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-slate-950'} font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition">
                <i class="fa-solid fa-play text-sm" id="playAudioIcon"></i>
                <span id="playAudioLabel">Écouter l'enregistrement audio</span>
            </button>
        </div>

        <div class="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 text-slate-300 text-xs sm:text-sm leading-relaxed space-y-2">
            <div class="flex items-center justify-between ${isEvent ? 'text-blue-400' : 'text-amber-400'} font-semibold text-xs border-b border-slate-800 pb-2">
                <span class="flex items-center gap-1.5"><i class="fa-solid fa-circle-info"></i> Programme Détaillé</span>
            </div>
            <p class="pt-1">${stop.audioText}</p>
        </div>

        <div class="bg-gradient-to-br from-slate-900 via-slate-900 ${isEvent ? 'to-blue-950/30 border-blue-500/30' : 'to-amber-950/30 border-amber-500/30'} rounded-2xl border p-4 space-y-3">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-2xl">${stop.quiz.badgeIcon}</span>
                    <div>
                        <h3 class="font-medieval text-sm font-bold ${isEvent ? 'text-blue-300' : 'text-amber-300'}">Quiz de Validation</h3>
                        <p class="text-[11px] text-slate-400">Blason : <strong class="${isEvent ? 'text-blue-200' : 'text-amber-200'}">${stop.quiz.badgeName}</strong></p>
                    </div>
                </div>
                ${isBadgeEarned ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold"><i class="fa-solid fa-check mr-1"></i>Débloqué</span>` : ''}
            </div>
            <p class="text-xs font-medium text-slate-200 pt-1">${stop.quiz.question}</p>
            <div class="space-y-2">
                ${stop.quiz.options.map((opt) => `
                    <button onclick="checkQuizAnswer(${stop.id},${opt.correct})" class="w-full p-2.5 text-left rounded-xl bg-slate-800/80 ${isEvent ? 'hover:bg-blue-500/20 hover:border-blue-500/50' : 'hover:bg-amber-500/20 hover:border-amber-500/50'} border border-slate-700/60 text-xs text-slate-200 transition flex items-center justify-between">
                        <span>${opt.text}</span>
                        <i class="fa-regular fa-circle text-slate-500"></i>
                    </button>
                `).join('')}
            </div>
        </div>
    `;

    setTimeout(() => {
        currentAudioElement = document.getElementById('nativeAudio');
        if (currentAudioElement) {
            currentAudioElement.ontimeupdate = function() {
                if (currentAudioElement.duration) {
                    const percentage = (currentAudioElement.currentTime / currentAudioElement.duration) * 100;
                    const bar = document.getElementById('audioProgressBar');
                    if (bar) bar.style.width = `${percentage}%`;
                }
            };
            currentAudioElement.onended = function() {
                updateAudioUI(false);
            };
        }
    }, 100);
}

function navigateStop(direction) {
    const list = getActiveList();
    const currentIndex = list.findIndex(s => s.id === activeStopId);
    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = list.length - 1;
    if (newIndex >= list.length) newIndex = 0;
    selectStop(list[newIndex].id);
}

function toggleNativeAudio() {
    if (!currentAudioElement) return;
    if (currentAudioElement.paused) {
        currentAudioElement.play().then(() => {
            updateAudioUI(true);
        }).catch(err => {
            alert("Fichier audio non trouvé dans le dossier 'audio/'.\n\nDéposez le fichier MP3 correspondant pour l'écouter !");
        });
    } else {
        currentAudioElement.pause();
        updateAudioUI(false);
    }
}

function updateAudioUI(playing) {
    const btnLabel = document.getElementById('playAudioLabel');
    const btnIcon = document.getElementById('playAudioIcon');
    const statusText = document.getElementById('audioStatusText');
    if (playing) {
        if (btnLabel) btnLabel.innerText = "Mettre en Pause";
        if (btnIcon) btnIcon.className = "fa-solid fa-pause text-sm";
        if (statusText) statusText.innerText = "Lecture en cours...";
    } else {
        if (btnLabel) btnLabel.innerText = "Écouter l'enregistrement audio";
        if (btnIcon) btnIcon.className = "fa-solid fa-play text-sm";
        if (statusText) statusText.innerText = "Prêt pour l'écoute";
    }
}

function seekAudioNative(e) {
    if (!currentAudioElement || !currentAudioElement.duration) return;
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    currentAudioElement.currentTime = percentage * currentAudioElement.duration;
}

function openQRModal() {
    document.getElementById('qrModal').classList.remove('hidden');
    try {
        if (!html5QrCode) { html5QrCode = new Html5Qrcode("qr-reader"); }
        html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 200, height: 200 } },
            (decodedText) => { handleQRScannedCode(decodedText); closeQRModal(); },
            () => {}
        ).catch(() => {});
    } catch (e) {}
}

function closeQRModal() {
    if (html5QrCode) { html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {}); }
    document.getElementById('qrModal').classList.add('hidden');
}

function simulateQRScan(qrCodeString) { handleQRScannedCode(qrCodeString); closeQRModal(); }

function handleQRScannedCode(code) {
    let stop = CIRCUIT_HISTORIQUE.find(s => s.qrCode === code || code.includes(`STOP-${s.id}`));
    if (stop) {
        if (activeCircuit !== 'historique') switchCircuit('historique');
        selectStop(stop.id);
        switchView('stops');
        return;
    }
    stop = CIRCUIT_EVENEMENTIEL.find(s => s.qrCode === code || code.includes(`EVENT-${s.id}`));
    if (stop) {
        if (activeCircuit !== 'evenementiel') switchCircuit('evenementiel');
        selectStop(stop.id);
        switchView('stops');
        return;
    }
    alert("QR Code non reconnu.");
}

function checkQuizAnswer(stopId, isCorrect) {
    if (isCorrect) {
        if (!unlockedBadges.includes(stopId)) {
            unlockedBadges.push(stopId);
            localStorage.setItem('stjames_badges_v10', JSON.stringify(unlockedBadges));
            updateBadgeCount();
        }
        alert("✨ Bravo ! Bonne réponse. Le blason a été débloqué dans votre Pass.");
        renderActiveStop(stopId);
    } else { alert("Oups ! Réponse incorrecte. Réessayez !"); }
}

function updateBadgeCount() {
    const badgeCountEl = document.getElementById('badgeCountBadge');
    if (badgeCountEl) badgeCountEl.innerText = unlockedBadges.length;
}

function togglePassModal() {
    const modal = document.getElementById('passModal');
    const grid = document.getElementById('badgesGrid');
    if (modal.classList.contains('hidden')) {
        const allStops = [...CIRCUIT_HISTORIQUE, ...CIRCUIT_EVENEMENTIEL];
        grid.innerHTML = allStops.map(stop => {
            const isUnlocked = unlockedBadges.includes(stop.id);
            return `
                <div class="p-3 rounded-xl border ${isUnlocked ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-800/40 border-slate-800'} flex items-center space-x-3">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl ${isUnlocked ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-600'}">${stop.quiz.badgeIcon}</div>
                    <div>
                        <h4 class="font-medieval text-xs font-bold ${isUnlocked ? 'text-amber-300' : 'text-slate-500'}">${stop.quiz.badgeName}</h4>
                        <p class="text-[10px] text-slate-400">${isUnlocked ? 'Blason Débloqué' : 'Verrouillé'}</p>
                    </div>
                </div>
            `;
        }).join('');
        modal.classList.remove('hidden');
    } else { modal.classList.add('hidden'); }
}

function switchView(view) {
    const mapSec = document.getElementById('mapSection');
    if (view === 'map') { mapSec.scrollIntoView({ behavior: 'smooth' }); }
    else if (view === 'stops') { document.getElementById('stopDetailView').scrollIntoView({ behavior: 'smooth' }); }
}
