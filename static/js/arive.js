/* ================= CONFIG ================= */
// const API_URL = "client-easyfood-anhrasg7d6a2azb9.indonesiacentral-01.azurewebsites.net";
const orderId = ORDER_ID;
const POLL_INTERVAL = 4000;
const SPEED_KMH = 1000;

let STORE_POS = null;
let storeData = null;
let driverData = null;
let hasStarted = false;
let currentPhase = "order_confirmed";
let aiEngine = null;

/* ================= PROGRESS BAR STATE ================= */
let progressTimer = null;
let progressStartTime = null;
let estimatedDuration = null;

/* ================= MAP ================= */
const map = L.map("map").setView([-6.21, 106.845], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap",
}).addTo(map);

/* ================= DRIVER ICON ================= */
const driverIcon = L.divIcon({
  html: `
    <div style="
      width: 40px;
      height: 40px;
      background-color: #4CAF50;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 20px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      border: 3px solid white;
    ">
      🛵
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  className: "driver-icon"
});

let driverMarker = null;
let storeMarker = null;
let destinationMarker = null;
let routeLine = null;
let routePointsToStore = [];
let routePointsToCustomer = [];

/* ================= UI ELEMENTS ================= */
const driverEl = document.querySelector(".driver-card strong");
const etaEl = document.getElementById("eta");
const progressBar = document.querySelector(".progress-bar");
const statusItems = document.querySelectorAll(".status-item");

/* ================= DESTINATION ================= */
let destination = null;

/* ================= GET USER LOCATION ================= */
function getUserLocation() {
  return new Promise((resolve, reject) => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          destination = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          };
          
          console.log("User location obtained:", destination);
          
          if (destinationMarker) {
            destinationMarker.setLatLng([destination.lat, destination.lon]);
          } else {
            destinationMarker = L.marker([destination.lat, destination.lon])
              .addTo(map)
              .bindPopup("Lokasi Anda")
              .openPopup();
          }
          
          resolve(destination);
        },
        error => {
          console.error("Error getting location:", error);
          destination = {
            lat: -6.20,
            lon: 106.85
          };
          
          console.warn("Using default location:", destination);
          
          if (!destinationMarker) {
            destinationMarker = L.marker([destination.lat, destination.lon])
              .addTo(map)
              .bindPopup("Lokasi Anda (Default)")
              .openPopup();
          }
          
          resolve(destination);
        },
        { timeout: 10000 }
      );
    } else {
      console.warn("Geolocation not supported, using default location");
      destination = {
        lat: -6.20,
        lon: 106.85
      };
      
      if (!destinationMarker) {
        destinationMarker = L.marker([destination.lat, destination.lon])
          .addTo(map)
          .bindPopup("Lokasi Anda (Default)")
          .openPopup();
      }
      
      resolve(destination);
    }
  });
}

/* ================= UPDATE DB STATUS ================= */
async function updateOrderStatusInDb(newStatus) {
  if (!orderId) return;

  console.log(`Mengupdate status database ke: ${newStatus}`);

  try {
    // Sesuaikan endpoint ini dengan rute backend Anda
    const res = await fetch(`/orders/${orderId}/update-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: newStatus })
    });

    const data = await res.json();
    if (data.success) {
      console.log("Status database berhasil diupdate");
    } else {
      console.error("Gagal update status DB:", data.error);
    }
  } catch (error) {
    console.error("Error updating status:", error);
  }
}

/* ================= UPDATE DRIVER AVATARS ================= */
function updateDriverAvatars(driverData) {
  const defaultAvatar = "https://cdn-icons-png.flaticon.com/512/3135/3135715.png";
  const avatarUrl = driverData.avatar || defaultAvatar;
  
  console.log("Updating driver avatars with:", driverData);
  
  const driverCardImg = document.querySelector(".driver-card img");
  if (driverCardImg) {
    driverCardImg.src = avatarUrl;
    driverCardImg.alt = `Driver ${driverData.name}`;
  }
  
  const chatHeaderImg = document.querySelector(".chat-header img");
  if (chatHeaderImg) {
    chatHeaderImg.src = avatarUrl;
    chatHeaderImg.alt = `Driver ${driverData.name}`;
  }
  
  const driverNameElements = document.querySelectorAll(".driver-card strong, .chat-user strong");
  driverNameElements.forEach(el => {
    el.textContent = driverData.name;
  });
}

/* ================= LOAD DRIVER AND STORE DATA ================= */
async function loadDriverAndStoreFromOrder() {
  if (!orderId) {
    console.error("No order ID");
    return;
  }

  try {
    const res = await fetch(
      `/orders/${orderId}/arive-driver`,
      { credentials: "include" }
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log("API Response:", data);
    
    if (!data.success) {
      console.error("Failed to load driver and store:", data.error);
      return;
    }

    driverData = data.driver;
    storeData = data.store;
    
    if (storeData && storeData.lat && storeData.lon) {
      STORE_POS = [storeData.lat, storeData.lon];
    } else {
      STORE_POS = [-6.21, 106.845];
    }
    
    if (STORE_POS) {
      storeMarker = L.marker(STORE_POS)
        .addTo(map)
        .bindPopup(`<strong>${storeData ? storeData.name : 'Restoran'}</strong>`)
        .openPopup();
    }
    
    updateDriverAvatars(driverData);
    
    const initialPos = driverData && driverData.lat && driverData.lon 
      ? [driverData.lat, driverData.lon] 
      : STORE_POS;
    
    driverMarker = L.marker(initialPos, { icon: driverIcon }).addTo(map);

    if (window.AIChatEngine) {
      console.log("Initializing AI Engine...");
      aiEngine = new AIChatEngine();
      
      // Feed initial data to AI
      aiEngine.updateContext({
        driverName: driverData.name || "Driver",
        storeName: storeData.name || "Restoran",
        phase: currentPhase,
        eta: "15" // Default starting ETA
      });
    }
    
    return { storeData, driverData };

    
  } catch (error) {
    console.error("Error loading driver and store:", error);
    STORE_POS = [-6.21, 106.845];
    return {
      storeData: { name: "Restoran", lat: -6.21, lon: 106.845 },
      driverData: { 
        name: "Driver", 
        avatar: "https://cdn-icons-png.flaticon.com/512/3135/3135715.png" 
      }
    };
  }
}

/* ================= STATE MANAGEMENT ================= */
function updateStatusUI() {
  statusItems.forEach(item => {
    item.classList.remove("active", "done");
  });
  
  statusItems[0].classList.add("done");
  
  switch (currentPhase) {
    case "order_confirmed":
      break;
      
    case "to_store":
      statusItems[1].classList.add("active");
      break;
      
    case "preparing_done":
      statusItems[1].classList.add("done");
      statusItems[2].classList.add("active");
      break;
      
    case "to_customer":
      statusItems[1].classList.add("done");
      statusItems[2].classList.add("active");
      break;
      
    case "delivered":
      statusItems[0].classList.add("done");
      statusItems[1].classList.add("done");
      statusItems[2].classList.add("done");
      statusItems[3].classList.add("active");
      break;
  }
}

/* ================= GET REAL ROUTE FROM OSRM ================= */
async function getRouteFromOSRM(startPos, endPos) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/` +
                `${startPos.lon},${startPos.lat};${endPos.lon},${endPos.lat}` +
                `?overview=full&geometries=geojson`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const distance = route.distance / 1000; // Convert to km
      const duration = route.duration / 60; // Convert to minutes
      
      // Convert coordinates to lat/lon array
      const points = route.geometry.coordinates.map(coord => ({
        lat: coord[1],
        lon: coord[0]
      }));
      
      return {
        success: true,
        distance: distance,
        duration: duration,
        points: points
      };
    } else {
      return {
        success: false,
        error: "No route found"
      };
    }
  } catch (error) {
    console.error("Error getting route from OSRM:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/* ================= DRAW ROUTE ON MAP ================= */
function drawRoute(points, color = "#4CAF50", dashArray = null) {
  if (routeLine && map.hasLayer(routeLine)) {
    map.removeLayer(routeLine);
  }
  
  const latLngPoints = points.map(p => [p.lat, p.lon]);
  
  routeLine = L.polyline(latLngPoints, {
    color: color,
    weight: 5,
    opacity: 0.7,
    dashArray: dashArray
  }).addTo(map);
  
  // Fit map to show entire route
  const bounds = L.latLngBounds(latLngPoints);
  map.fitBounds(bounds, { padding: [50, 50] });
}

/* ================= ANIMATE DRIVER ALONG ROUTE ================= */
function animateDriverAlongRoute(routePoints, durationMinutes, onComplete) {
  let currentIndex = 0;
  const totalPoints = routePoints.length;
  const totalTime = durationMinutes * 60 * 1000; // Convert to milliseconds
  const intervalTime = totalTime / totalPoints;
  
  // Position driver at start
  if (routePoints.length > 0) {
    driverMarker.setLatLng([routePoints[0].lat, routePoints[0].lon]);
  }
  
  const interval = setInterval(() => {
    if (currentIndex < totalPoints) {
      const point = routePoints[currentIndex];
      driverMarker.setLatLng([point.lat, point.lon]);
      currentIndex++;
    } else {
      clearInterval(interval);
      if (onComplete) onComplete();
    }
  }, intervalTime);
  
  // Return interval ID for cleanup
  return interval;
}

/* ================= START JOURNEY TO STORE ================= */
async function startJourneyToStore(startPos) {
  console.log("Driver menuju ke toko...");
  currentPhase = "to_store";
  updateStatusUI();
  
  if(aiEngine) aiEngine.updateContext({ phase: "to_store" });
  // Get real route from OSRM
  const routeResult = await getRouteFromOSRM(startPos, { lat: STORE_POS[0], lon: STORE_POS[1] });
  
  if (routeResult.success) {
    routePointsToStore = routeResult.points;
    const etaToStore = Math.ceil(routeResult.duration);
    
    console.log(`Jarak ke toko: ${routeResult.distance.toFixed(2)} km, ETA: ${etaToStore} menit`);
    etaEl.textContent = `Ke toko: ${etaToStore} min`;
    
    // Draw route to store (orange dashed line)
    drawRoute(routePointsToStore, "#ff0000ff", "10, 10");
    
    // Animate driver along route
    const animationInterval = animateDriverAlongRoute(routePointsToStore, etaToStore, () => {
      console.log("Driver tiba di toko!");
      currentPhase = "preparing_done";
      updateStatusUI();
      updateOrderStatusInDb("Preparing");
      updateChatWithStoreArrival();
      
      // Wait 3 seconds (simulate picking up order)
      setTimeout(() => {
        console.log("Driver mulai menuju ke lokasi pembeli...");
        currentPhase = "to_customer";
        updateStatusUI();
        startJourneyToCustomer();
      }, 3000);
    });
    
    // Update ETA countdown
    const startTime = Date.now();
    const etaTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingTime = totalTime - elapsed;
      const remainingMinutes = Math.ceil(remainingTime / 60000);
      
      if (remainingMinutes <= 0) {
        clearInterval(etaTimer);
      } else {
        etaEl.textContent = `Ke toko: ${remainingMinutes} min`;
      }
    }, 60000); // Update every minute
    
  } else {
    // Fallback: use straight line if OSRM fails
    console.warn("Using fallback route to store:", routeResult.error);
    const distanceToStore = haversine(startPos.lat, startPos.lon, STORE_POS[0], STORE_POS[1]);
    const etaToStore = calculateETA(distanceToStore);
    
    console.log(`Jarak ke toko (fallback): ${distanceToStore.toFixed(2)} km, ETA: ${etaToStore} menit`);
    etaEl.textContent = `Ke toko: ${etaToStore} min`;
    
    // Fallback route (straight line)
    routePointsToStore = [
      { lat: startPos.lat, lon: startPos.lon },
      { lat: STORE_POS[0], lon: STORE_POS[1] }
    ];
    
    drawRoute(routePointsToStore, "#FF9800", "10, 10");
    
    simulateJourney(startPos, STORE_POS, etaToStore, "to_store", () => {
      console.log("Driver tiba di toko!");
      currentPhase = "preparing_done";
      updateStatusUI();
      
      updateChatWithStoreArrival();
      
      setTimeout(() => {
        console.log("Driver mulai menuju ke lokasi pembeli...");
        currentPhase = "to_customer";
        updateStatusUI();
        startJourneyToCustomer();
      }, 3000);
    });
  }
}

/* ================= START JOURNEY TO CUSTOMER ================= */
async function startJourneyToCustomer() {
  console.log("Driver mulai menuju lokasi pembeli...");
  
  if (!destination) {
    console.error("Destination not available");
    return;
  }
  
  // Get real route from OSRM
  const routeResult = await getRouteFromOSRM(
    { lat: STORE_POS[0], lon: STORE_POS[1] },
    destination
  );
  
  if (routeResult.success) {
    routePointsToCustomer = routeResult.points;
    const etaToCustomer = Math.ceil(routeResult.duration);
    
    console.log(`Jarak ke pembeli: ${routeResult.distance.toFixed(2)} km, ETA: ${etaToCustomer} menit`);
    etaEl.textContent = `${etaToCustomer} min`;
    updateOrderStatusInDb("Out for Delivery");
    if(aiEngine) {
        aiEngine.updateContext({ 
            phase: "to_customer",
            eta: etaToCustomer
        });
    }

    // Draw route to customer (green solid line)
    drawRoute(routePointsToCustomer, "#4CAF50");
    
    // Start progress animation
    startProgressAnimationToCustomer(routePointsToCustomer, etaToCustomer);
    
  } else {
    // Fallback: use straight line if OSRM fails
    console.warn("Using fallback route to customer:", routeResult.error);
    const distanceToCustomer = haversine(STORE_POS[0], STORE_POS[1], destination.lat, destination.lon);
    const etaToCustomer = calculateETA(distanceToCustomer);
    
    console.log(`Jarak ke pembeli (fallback): ${distanceToCustomer.toFixed(2)} km, ETA: ${etaToCustomer} menit`);
    etaEl.textContent = `${etaToCustomer} min`;
    updateOrderStatusInDb("Out for Delivery");
    // Fallback route (straight line)
    routePointsToCustomer = [
      { lat: STORE_POS[0], lon: STORE_POS[1] },
      { lat: destination.lat, lon: destination.lon }
    ];
    
    drawRoute(routePointsToCustomer, "#4CAF50");
    startProgressAnimationToCustomer(routePointsToCustomer, etaToCustomer);
  }
}

/* ================= SIMULATE JOURNEY (FALLBACK) ================= */
function simulateJourney(startPos, endPos, etaMinutes, journeyType, onArrival) {
  const startTime = Date.now();
  const duration = etaMinutes * 60 * 1000;
  
  driverMarker.setLatLng([startPos.lat, startPos.lon]);
  
  const interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const lat = startPos.lat + (endPos[0] - startPos.lat) * progress;
    const lon = startPos.lon + (endPos[1] - startPos.lon) * progress;
    
    driverMarker.setLatLng([lat, lon]);
    
    const remainingTime = Math.max(0, duration - elapsed);
    const remainingMinutes = Math.ceil(remainingTime / 60000);
    
    if (remainingMinutes <= 0) {
      etaEl.textContent = journeyType === "to_store" ? "Tiba di toko" : "Tiba segera";
      clearInterval(interval);
      
      driverMarker.setLatLng(endPos);
      
      if (onArrival) onArrival();
    } else {
      etaEl.textContent = journeyType === "to_store" 
        ? `Ke toko: ${remainingMinutes} min`
        : `${remainingMinutes} min`;
    }
  }, 1000);
}

/* ================= PROGRESS ANIMATION TO CUSTOMER ================= */
function startProgressAnimationToCustomer(routePoints, etaMinutes) {
  if (progressTimer) clearInterval(progressTimer);
  
  progressBar.style.width = "0%";
  estimatedDuration = etaMinutes * 60;
  progressStartTime = Date.now();
  
  let currentRouteIndex = 0;
  const totalRoutePoints = routePoints.length;
  
  progressTimer = setInterval(() => {
    const elapsed = (Date.now() - progressStartTime) / 1000;
    let progress = Math.min((elapsed / estimatedDuration) * 100, 100);
    
    progressBar.style.width = `${progress}%`;
    
    // Calculate which route point based on progress
    const targetIndex = Math.floor((progress / 100) * totalRoutePoints);
    
    if (targetIndex > currentRouteIndex && targetIndex < totalRoutePoints) {
      currentRouteIndex = targetIndex;
      const point = routePoints[currentRouteIndex];
      
      if (driverMarker) {
        driverMarker.setLatLng([point.lat, point.lon]);
      }
    }
    
    const remainingSeconds = Math.max(0, estimatedDuration - elapsed);
    const remainingMinutes = Math.ceil(remainingSeconds / 60);
    
    if (remainingMinutes <= 0) {
      etaEl.textContent = "Tiba segera";
      if (progress >= 100) {
        clearInterval(progressTimer);
        currentPhase = "delivered";
        updateStatusUI();
        updateOrderStatusInDb("Delivered");
        etaEl.textContent = "Sudah Tiba";
        updateChatWithArrival();
      }
    } else {
      etaEl.textContent = `${remainingMinutes} min`;
    }
  }, 1000);
}

/* ================= CHAT FUNCTIONS ================= */
function updateChatWithStoreArrival() {
  const chatBody = document.querySelector('.chat-body');
  if (chatBody) {
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const message = `
      <div class="bubble left">
        Sudah sampai di restoran, mengambil pesanan Anda...
        <span>${time}</span>
      </div>
    `;
    chatBody.innerHTML += message;
    chatBody.scrollTop = chatBody.scrollHeight;
  }
}

function updateChatWithArrival() {
  const chatBody = document.querySelector('.chat-body');
  if (chatBody) {
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const message = `
      <div class="bubble left">
        Saya sudah sampai di lokasi Anda!
        <span>${time}</span>
      </div>
    `;
    chatBody.innerHTML += message;
    chatBody.scrollTop = chatBody.scrollHeight;
  }
}

/* ================= UTILITY FUNCTIONS ================= */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calculateETA(distanceKm) {
  return Math.max(1, Math.ceil((distanceKm / SPEED_KMH) * 60));
}

/* ================= REALTIME LOCATION ================= */
async function fetchDriverRealtime() {
  if (!orderId || !destination || hasStarted) return;
  
  try {
    const res = await fetch(
      `/orders/${orderId}/driver-pos`,
      { credentials: "include" }
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) {
      console.error("Failed to get driver position:", data.error);
      return;
    }

    const startPos = {
      lat: data.lat,
      lon: data.lon
    };

    console.log("Driver starting position:", startPos);
    hasStarted = true;
    
    currentPhase = "order_confirmed";
    updateStatusUI();
    updateOrderStatusInDb("Order_Confirmed");
    startJourneyToStore(startPos);

  } catch (error) {
    console.error("Error fetching driver realtime:", error);
    const startPos = {
      lat: driverData ? driverData.lat : -6.21,
      lon: driverData ? driverData.lon : 106.845
    };
    hasStarted = true;
    currentPhase = "order_confirmed";
    updateStatusUI();
    startJourneyToStore(startPos);
  }
}

/* ================= CHAT FUNCTIONALITY ================= */
function setupChat() {
  const chatInput = document.querySelector('.chat-input input');
  const chatButton = document.querySelector('.chat-input button');
  const chatBody = document.querySelector('.chat-body');
  const callButton = document.querySelector('.call');
  
  if (chatButton && chatInput) {
    chatButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }
  
  if (callButton) {
    callButton.addEventListener('click', () => {
      alert('Memanggil driver... (simulasi)');
    });
  }
  
  async function sendMessage() {
    const userMessage = chatInput.value.trim();
    if (!userMessage) return;
    
    // 1. Render User Message
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const userBubble = `
      <div class="bubble right">
        ${userMessage}
        <span>${time}</span>
      </div>
    `;
    
    chatBody.innerHTML += userBubble;
    chatInput.value = '';
    chatBody.scrollTop = chatBody.scrollHeight;
    
    // 2. Show "Typing..." Indicator (Optional UI polish)
    const typingId = 'typing-' + Date.now();
    const typingBubble = `
      <div class="bubble left typing" id="${typingId}">
        <em>Sedang mengetik...</em>
      </div>
    `;
    chatBody.innerHTML += typingBubble;
    chatBody.scrollTop = chatBody.scrollHeight;

    // 3. Get AI Response
    try {
      let responseText = "Maaf, koneksi buruk.";
      
      if (aiEngine) {
        // Ensure AI has latest ETA before answering
        aiEngine.updateContext({ 
          phase: currentPhase,
          eta: etaEl.textContent.replace(/\D/g,'') || "5" 
        });

        // Call Gemini
        responseText = await aiEngine.generateResponse(userMessage);
      } else {
        responseText = "Sistem chat sedang offline.";
      }

      // 4. Remove typing indicator and show Real Response
      const typingEl = document.getElementById(typingId);
      if (typingEl) typingEl.remove();

      const replyTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const replyBubble = `
        <div class="bubble left">
          ${responseText}
          <span>${replyTime}</span>
        </div>
      `;
      chatBody.innerHTML += replyBubble;
      chatBody.scrollTop = chatBody.scrollHeight;

    } catch (err) {
      console.error("AI Chat Error:", err);
    }
  }

  // function sendMessage() {
  //   if (!chatInput.value.trim()) return;
    
  //   const message = chatInput.value;
  //   const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
  //   const messageElement = `
  //     <div class="bubble right">
  //       ${message}
  //       <span>${time}</span>
  //     </div>
  //   `;
    
  //   chatBody.innerHTML += messageElement;
  //   chatInput.value = '';
  //   chatBody.scrollTop = chatBody.scrollHeight;
    
  //   setTimeout(() => {
  //     const replyTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  //     const replyElement = `
  //       <div class="bubble left">
  //         Terima kasih pesannya!
  //         <span>${replyTime}</span>
  //       </div>
  //     `;
  //     chatBody.innerHTML += replyElement;
  //     chatBody.scrollTop = chatBody.scrollHeight;
  //   }, 2000);
  // }
}

/* ================= INITIALIZATION ================= */
async function initializeApp() {
  console.log("Initializing app with order ID:", orderId);
  
  if (!orderId) {
    alert("No order ID found. Please go back and try again.");
    return;
  }
  
  try {
    statusItems[0].classList.add("done");
    
    await loadDriverAndStoreFromOrder();
    
    await getUserLocation();
    
    await fetchDriverRealtime();
    
    setInterval(async () => {
      if (!hasStarted) {
        await fetchDriverRealtime();
      }
    }, POLL_INTERVAL);
    
  } catch (error) {
    console.error("Initialization error:", error);
    alert("Error initializing tracking. Please refresh the page.");
  }
}

/* ================= START APP ================= */
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupChat();
  
  const style = document.createElement('style');
  style.textContent = `
    .progress {
      width: 100%;
      height: 8px;
      background-color: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      margin: 20px 0;
    }
    
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #4CAF50, #8BC34A);
      width: 0%;
      transition: width 1s linear;
      border-radius: 4px;
    }
    
    .status-item .icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #e0e0e0;
      color: #666;
      font-size: 18px;
    }
    
    .status-item.done .icon {
      background-color: #4CAF50 !important;
      color: white !important;
    }
    
    .status-item.active .icon {
      background-color: #FF9800 !important;
      color: white !important;
    }
    
    .status-item.done .text {
      color: #4CAF50 !important;
    }
    
    .status-item.active .text {
      color: #FF9800 !important;
    }
    
    .driver-card img,
    .chat-header img {
      border-radius: 50%;
      border: 3px solid #4CAF50;
      object-fit: cover;
    }
    
    .driver-card img {
      width: 80px !important;
      height: 80px !important;
    }
    
    .chat-header img {
      width: 60px !important;
      height: 60px !important;
    }
    
    .driver-card {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 20px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      margin-top: 20px;
    }
    
    .driver-info {
      flex: 1;
    }
    
    .driver-info strong {
      display: block;
      font-size: 18px;
      color: #333;
      margin-bottom: 5px;
    }
    
    .driver-info span {
      color: #666;
      font-size: 14px;
    }
    
    .eta {
      font-size: 24px;
      font-weight: bold;
      color: #4CAF50;
    }
    
    .driver-icon {
      background: transparent !important;
      border: none !important;
    }
  `;
  document.head.appendChild(style);
  
  setTimeout(() => {
    map.invalidateSize();
  }, 100);

});

