// APP JAVASCRIPT

// const API_URL = "client-easyfood-anhrasg7d6a2azb9.indonesiacentral-01.azurewebsites.net";
const contentFeed = document.getElementById("contentFeed");
const searchInput = document.getElementById("searchInput");
const sidebarItems = document.querySelectorAll(".sidebar-nav-menu .nav-item");
const quickItems = document.querySelectorAll(".category-item");
const loginModal = document.getElementById("loginModal");
const loginBtn = document.getElementById("loginBtn");
const loginForm = document.getElementById("loginForm");
const ITEMS_PER_PAGE = 8;

let currentPage = 1;
let RESTAURANTS = [];
let currentList = [];
let currentKeyword = "";
let activeStore = null;
let cart = [];
let cartStoreId = null;
let currentUserId = null;


// OPEN MODAL
loginBtn.addEventListener("click", () => {
    loginModal.classList.remove("hidden");
});

// CLOSE MODAL
function closeLoginModal() {
    loginModal.classList.add("hidden");
}

// SUBMIT LOGIN
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
        alert("Email dan password wajib diisi");
        return;
    }

    try {
        const res = await fetch(`/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "include", // 🔥 WAJIB UNTUK SESSION
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message);
            return;
        }

        // UPDATE UI
        setLoggedInUI(data.user);

        closeLoginModal();
    } catch (err) {
        alert("Gagal login, server error");
        console.error(err);
    }
});

// CEK LOGIN SAAT REFRESH
async function checkLoginSession() {
    try {
        const res = await fetch(`/auth/me`, {
            credentials: "include"
        });
        const data = await res.json();

        if (data.logged_in) {
            setLoggedInUI(data.user);
        }
    } catch (err) {
        console.error("Session check failed", err);
    }
}

// UPDATE UI JIKA LOGIN
function setLoggedInUI(user) {
    currentUserId = user.id; // 🔥 INI PENTING

    document.getElementById("userNameGreeting").innerText =
        `Halo, ${user.name}!`;

    document.querySelector(".profile-name").innerText = user.name;
    document.querySelector(".profile-email").innerText = user.email;

    loginBtn.innerHTML = `<i class="fas fa-sign-out-alt"></i><span>Logout</span>`;
    loginBtn.onclick = logout;
}


// LOGOUT
async function logout() {
    await fetch(`/auth/logout`, {
        method: "POST",
        credentials: "include"
    });
    location.reload();
}

// REGSITER
function openRegister() {
    closeLoginModal();
    document.getElementById("registerModal").classList.remove("hidden");
}

function closeRegister() {
    document.getElementById("registerModal").classList.add("hidden");
}

function registerUser() {
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;

  if (!name || !email || !password) {
    alert("Semua field wajib diisi");
    return;
  }

  fetch(`/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert("Registrasi berhasil! Silakan login");
        closeRegister();
        loginModal.classList.remove("hidden");
      } else {
        alert(data.message);
      }
    })
    .catch(() => alert("Gagal register"));
}

async function initApp() {
    
    const locationText = document.getElementById("userLocationText");
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude, longitude } = pos.coords;
                locationText.innerText = "Lokasi terdeteksi (Godean, Sleman)";
                await loadRestaurants(latitude, longitude);
            },
            async () => {
                locationText.innerText = "Lokasi tidak aktif";
                await loadRestaurants(0, 0);
            }
        );
    }
    if (currentUserId){
        initRecommendationSystem();
    }
}

// Load recommendations
async function loadRecommendations() {
    try {
        if (!currentUserId) {
            console.log("User not logged in, skipping recommendations");
            return;
        }
        
        // Ambil lokasi default (Godean, Sleman)
        const lat = -7.7956;
        const lon = 110.3695;
        
        console.log("Loading recommendations for user:", currentUserId);
        
        const response = await fetch(`/api/recommendations?lat=${lat}&lon=${lon}`, {
            credentials: "include"
        });
        
        const data = await response.json();
        console.log("Recommendations API response:", data);
        
        if (data.success && data.recommendations.length > 0) {
            renderRecommendations(data.recommendations);
            
            // Tambahkan insight jika ada riwayat
            if (data.has_history) {
                await showRecommendationInsights(data.total_orders);
            }
        } else {
            renderFallbackRecommendations();
        }
        
    } catch (error) {
        console.error("Failed to load recommendations:", error);
        renderFallbackRecommendations();
    }
}

function renderRecommendations(recommendations) {
    const section = document.getElementById("recommendationSection");
    if (!section) return;
    
    section.innerHTML = `
        <div class="section-header">
            <h2><i class="fas fa-star"></i> Rekomendasi untuk Anda</h2>
            <div class="recommendation-filters">
                <button class="filter-btn active" data-filter="all">Semua</button>
                <button class="filter-btn" data-filter="personal">Untuk Kamu</button>
                <button class="filter-btn" data-filter="popular">Populer</button>
                <button class="filter-btn" data-filter="nearby">Terdekat</button>
            </div>
        </div>
        <div class="recommendation-grid" id="recommendationGrid">
            ${recommendations.map(item => createRecommendationCard(item)).join('')}
        </div>
    `;
    
    // Setup filter buttons
    setupRecommendationFilters(recommendations);
}

function createRecommendationCard(item) {
    const reasonIcons = {
        "⭐ Sering Anda pesan": "fas fa-heart",
        "🔥 Populer di Easy Food": "fas fa-fire",
        "🏷️ Serupa dengan toko favorit Anda": "fas fa-tag",
        "📍 Terdekat dari lokasi Anda": "fas fa-map-marker-alt"
    };
    
    const iconClass = reasonIcons[item.reason] || "fas fa-star";
    
    // Determine badge color based on type
    let badgeClass = "match-badge";
    if (item.type === "favorite") badgeClass += " favorite";
    else if (item.type === "popular") badgeClass += " popular";
    else if (item.type === "similar") badgeClass += " similar";
    else badgeClass += " nearby";
    
    return `
        <div class="recommendation-card" onclick="openStore(${item.id})">
            <div class="recommendation-badge">
                <span class="${badgeClass}">${item.match_score}% Match</span>
            </div>
            <div class="rec-image-wrapper">
                <img src="${item.image}" alt="${item.name}" 
                     onerror="this.onerror=null; this.src='/static/assets/images/noimg.png'">
            </div>
            <div class="rec-details">
                <h3>${item.name}</h3>
                <div class="rec-meta">
                    <span><i class="fas fa-star" style="color:#ffd700"></i> ${item.rating.toFixed(1)}</span>
                    <span><i class="fas fa-road"></i> ${item.distance}</span>
                    <span class="rec-category">${item.category}</span>
                </div>
                <div class="rec-reason">
                    <i class="${iconClass}"></i> ${item.reason}
                </div>
                ${item.order_count > 0 ? `
                <div class="rec-stats">
                    <small><i class="fas fa-shopping-bag"></i> ${item.order_count} order</small>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Fallback recommendations
function renderFallbackRecommendations() {
    const grid = document.getElementById("recommendationGrid");
    if (!grid) return;
    
    grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 20px;">
            <h3>Mari coba rekomendasi populer!</h3>
            <p>Berdasarkan data order pengguna lain</p>
        </div>
    `;
    
    // Ambil 6 toko pertama dari RESTAURANTS
    const popularStores = RESTAURANTS.slice(0, 6);
    popularStores.forEach(store => {
        grid.innerHTML += createRecommendationCard({
            ...store,
            reason: "🔥 Populer di Easy Food",
            match_score: 75,
            type: "popular"
        });
    });
}

// Show recommendation insights
async function showRecommendationInsights() {
    try {
        const response = await fetch(`/api/recommendations/insights`, {
            credentials: "include"
        });
        
        const data = await response.json();
        
        if (data.success && data.insights.total_orders > 0) {
            // Tambahkan insight section
            const section = document.getElementById("recommendationSection");
            if (section) {
                const insightHTML = createInsightHTML(data.insights);
                section.innerHTML += insightHTML;
            }
        }
    } catch (error) {
        console.error("Failed to load insights:", error);
    }
}

function createInsightHTML(insights) {
    return `
        <div class="insight-section">
            <h3><i class="fas fa-chart-bar"></i> Berdasarkan riwayat Anda:</h3>
            <div class="insight-grid">
                <div class="insight-card">
                    <i class="fas fa-shopping-bag"></i>
                    <div>
                        <h4>${insights.total_orders} Order</h4>
                        <p>Total pesanan Anda</p>
                    </div>
                </div>
                <div class="insight-card">
                    <i class="fas fa-store"></i>
                    <div>
                        <h4>${insights.favorite_stores.length} Toko Favorit</h4>
                        <p>Toko yang sering Anda kunjungi</p>
                    </div>
                </div>
                <div class="insight-card">
                    <i class="fas fa-users"></i>
                    <div>
                        <h4>${insights.similar_users_count} Pengguna Serupa</h4>
                        <p>Memiliki selera yang sama dengan Anda</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function initRecommendationSystem() {
    if (!currentUserId) return;
    
    // Tunggu 1 detik agar konten lain load dulu
    setTimeout(async () => {
        await loadRecommendations();
        setupRecommendationFilters();
    }, 1000);
}

function setupRecommendationFilters(allRecommendations) {
    const filterBtns = document.querySelectorAll(".filter-btn");
    const grid = document.getElementById("recommendationGrid");
    
    if (!grid || !filterBtns.length) return;
    
    filterBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            // Update active button
            filterBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            const filter = btn.dataset.filter;
            filterRecommendations(allRecommendations, filter);
        });
    });
}

function filterRecommendations(filter) {
    let filtered = [...currentRecommendations];
    
    switch(filter) {
        case "popular":
            filtered.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
            break;
        case "nearby":
            filtered.sort((a, b) => {
                const distA = parseFloat(a.distance.split(" ")[0]);
                const distB = parseFloat(b.distance.split(" ")[0]);
                return distA - distB;
            });
            break;
        case "trending":
            // Random shuffle untuk efek trending
            filtered.sort(() => Math.random() - 0.5);
            break;
        // "personal" sudah diurutkan oleh backend
    }
    
    renderRecommendations(filtered.slice(0, 8));
}

function getRandomOrderCount() {
    const counts = [3, 5, 8, 12, 15];
    return counts[Math.floor(Math.random() * counts.length)];
}

function trackUserAction(action, data) {
    // Simpan action user untuk analisis
    // Bisa diimplementasikan dengan localStorage atau API
    const actions = JSON.parse(localStorage.getItem("user_actions") || "[]");
    actions.push({
        action,
        data,
        timestamp: new Date().toISOString()
    });
    
    localStorage.setItem("user_actions", JSON.stringify(actions.slice(-50))); // Simpan 50 terakhir
}

function onOrderSuccess(orderId) {
    trackUserAction("order_completed", { orderId });
    
    // Refresh recommendations setelah beberapa detik
    setTimeout(() => {
        if (window.location.pathname === "/") {
            loadRecommendations();
        }
    }, 3000);
}

function initRecommendationSystem() {
    loadRecommendations();
    setupRecommendationFilters();
    
    // Refresh setiap 5 menit jika user masih aktif
    setInterval(() => {
        if (document.visibilityState === "visible") {
            loadRecommendations();
        }
    }, 5 * 60 * 1000);
}


async function loadRestaurants(lat, lon) {
    try {
        const res = await fetch(`/orders/stores?lat=${lat}&lon=${lon}`);
        const data = await res.json();
        RESTAURANTS = data.map(s => ({
            ...s,
            image: s.image.startsWith('/static') ? s.image : `/static/${s.image}`,
        }));
        currentList = [...RESTAURANTS];
        renderHomeContent();
    } catch (err) {
        console.error(err);
        contentFeed.innerHTML = "<h2>Gagal memuat data dari database.</h2>";
    }
}

function renderRestaurantCard(item) {
    return `
    <article class="restaurant-card small" onclick="openStore(${item.id})">
      <div class="image-wrapper">
        ${item.promo ? `<span class="promo-badge"><i class="fas fa-tags"></i> Promo</span>` : ""}
        <img src="${item.image}" class="card-image" onerror="this.onerror=null; this.src='https://via.placeholder.com/300x200/cccccc/969696?text=Restoran'">
      </div>
      <div class="card-details">
        <h4>${item.name}</h4>
        <p>${item.distance} | ⭐ ${item.rating}</p>
      </div>
    </article>`;
}

function renderHomeContent() {
    contentFeed.innerHTML = `<h2>Pilihan Eksklusif untuk Anda</h2><div class="restaurant-grid" id="resultGrid"></div>`;
    const grid = document.getElementById("resultGrid");
    currentList.forEach(item => grid.innerHTML += renderRestaurantCard(item));
    renderList(currentList, "Pilihan Eksklusif untuk Anda");
}

function renderList(list, title) {
    // 1. Siapkan wadah HTML
    contentFeed.innerHTML = `<h2>${title}</h2><div class="restaurant-grid" id="resultGrid"></div><div id="paginationContainer" class="pagination-container"></div>`;
    
    const grid = document.getElementById("resultGrid");
    const paginationContainer = document.getElementById("paginationContainer");

    // 2. Cek jika data kosong
    if (!list || list.length === 0) { 
        grid.innerHTML = `<div class="no-result"><p>Tidak ada hasil.</p></div>`; 
        return; 
    }

    // 3. Logika Pagination (Potong data sesuai halaman)
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedItems = list.slice(startIndex, endIndex);
    
    // 4. Render item yang sudah dipotong
    paginatedItems.forEach(item => {
        grid.innerHTML += renderRestaurantCard(item);
    });

    // 5. Render tombol halaman
    renderPaginationControls(list.length, paginationContainer);
}


async function openStore(id) {
    activeStore = RESTAURANTS.find(r => r.id === id);
    if (!activeStore) return;
    switchContent(async () => {
        contentFeed.innerHTML = "<h2 style='text-align:center;'>Memuat Menu...</h2>";
        try {
            const res = await fetch(`/orders/stores/${id}/menu`);
            const menuData = await res.json();
            activeStore.menus = menuData.map(m => ({
                ...m,
                image: m.image.startsWith('/static') ? m.image : `/static/${m.image}`
            }));
            renderStorePage();
        } catch (err) { console.error(err); }
    });
}

function renderPaginationControls(totalItems, container) {
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    if (totalPages <= 1) return; // Tidak perlu tombol jika cuma 1 halaman

    let buttonsHTML = '';

    // Tombol Previous
    buttonsHTML += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})"><i class="fas fa-chevron-left"></i></button>`;

    // Loop nomer halaman
    for (let i = 1; i <= totalPages; i++) {
        // Tampilkan halaman jika: Halaman 1, Halaman Terakhir, atau di sekitar Current Page
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            buttonsHTML += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            buttonsHTML += `<span class="page-dots">...</span>`;
        }
    }

    // Tombol Next
    buttonsHTML += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})"><i class="fas fa-chevron-right"></i></button>`;

    container.innerHTML = buttonsHTML;
}

function changePage(newPage) {
    currentPage = newPage;
    // Render ulang list dengan halaman baru (tetap menggunakan currentList yang sudah difilter)
    // Judulnya kita cek apakah sedang search atau tidak
    const title = currentKeyword ? `Hasil untuk "${currentKeyword}"` : "Pilihan untuk Anda";
    renderList(currentList, title);
    
    // Scroll otomatis ke atas grid agar user nyaman
    document.querySelector('.app-main-content').scrollIntoView({ behavior: 'smooth' });
}

function renderStorePage() {
    contentFeed.innerHTML = `
        <button class="back-btn" onclick="goBack()">← Kembali</button>
        <div class="store-header">
            <img src="${activeStore.image}" class="store-logo">
            <div class="store-info">
                <h2>${activeStore.name}</h2>
                <p>${activeStore.distance} | ⭐ ${activeStore.rating}</p>
            </div>
        </div>
        <div class="restaurant-grid" id="menuGrid"></div>
    `;
    const grid = document.getElementById("menuGrid");
    activeStore.menus.forEach(menu => {
        const finalPrice = activeStore.promo ? Math.round(menu.price * 0.9) : menu.price;
        grid.innerHTML += `
            <article class="menu-card">
                <img src="${menu.image}" class="menu-image" onerror="this.src='/static/assets/images/noimg.png'">
                <div class="menu-info">
                    <h4>${menu.name}</h4>
                    <p class="menu-price">Rp ${finalPrice.toLocaleString()}</p>
                    <button class="add-btn" onclick='addToCart(${JSON.stringify(menu).replace(/'/g, "&quot;")})'>+ Tambah</button>
                </div>
            </article>`;
    });
}

function applyFilters() {
    currentPage = 1;
    let filtered = [...RESTAURANTS];
    if (currentKeyword) {
        filtered = filtered.filter(item =>
            item.name.toLowerCase().includes(currentKeyword) ||
            (item.category && item.category.toLowerCase().includes(currentKeyword))
        );
    }

    const activeBtn = document.querySelector(".category-item.active");
    if (activeBtn) {
        const action = activeBtn.dataset.action;
        const categoryText = activeBtn.innerText.trim().toLowerCase();

        if (action === "promo") filtered = filtered.filter(i => i.promo);
        else if (action === "fast") filtered.sort((a,b) => b.rating - a.rating);
        else if (action === "near") filtered.sort((a,b) => parseFloat(a.distance) - parseFloat(b.distance));
        else filtered = filtered.filter(i => i.category && i.category.toLowerCase().includes(categoryText));
    }

    currentList = filtered;
    renderList(currentList, currentKeyword ? `Hasil untuk "${currentKeyword}"` : "Pilihan untuk Anda");
}

function setActiveSidebar(page) {
    sidebarItems.forEach(i => {
        if (i.dataset.page === page) {
            i.style.transition = "all 0.4s ease";
            i.classList.add("active");
        } else {
            i.classList.remove("active");
        }
    });
}

// Event search realtime
searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
        currentKeyword = searchInput.value.toLowerCase();
        applyFilters();

        // highlight sidebar "Cari"
        setActiveSidebar("search");
    }
});


// Klik kategori
quickItems.forEach(btn => {
    btn.addEventListener("click", () => {
        quickItems.forEach(i => i.classList.remove("active"));
        btn.classList.add("active");
        currentKeyword = ""; searchInput.value = "";
        applyFilters();
    });
});

function addToCart(menu) {
    if (cart.length === 0) cartStoreId = activeStore.id;
    if (cartStoreId !== activeStore.id) {
        if (!confirm("Kosongkan keranjang dari toko sebelumnya?")) return;
        cart = []; cartStoreId = activeStore.id;
    }
    const existing = cart.find(i => i.menuName === menu.name);
    if (existing) existing.qty++;
    else cart.push({storeName: activeStore.name, menuName: menu.name, price: menu.price, qty: 1});
    renderCart();
}

function renderCart() {
    const list = document.getElementById("cartItems");
    const totalEl = document.getElementById("cartTotal");
    list.innerHTML = cart.map((item,i)=>`
        <div class="cart-item">
            <div><strong>${item.menuName}</strong></div>
            <div class="cart-actions">
                <button onclick="updateQty(${i},-1)">−</button>
                <span>${item.qty}</span>
                <button onclick="updateQty(${i},1)">+</button>
            </div>
            <div>Rp ${(item.price*item.qty).toLocaleString()}</div>
        </div>`).join("");
    const total = cart.reduce((sum,item)=>sum+item.price*item.qty,0);
    totalEl.textContent = `Rp ${total.toLocaleString()}`;
}

function updateQty(i,delta) {
    cart[i].qty += delta;
    if(cart[i].qty<=0) cart.splice(i,1);
    renderCart();
}

function processCheckout() {
    if (cart.length === 0) {
        alert("Keranjang kosong!");
        return;
    }

    if (!currentUserId) {
        alert("Silakan login terlebih dahulu");
        loginModal.classList.remove("hidden");
        return;
    }

    const orderData = {
        items: cart
    };

    fetch(`/orders/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // 🔥 WAJIB (SESSION)
        body: JSON.stringify(orderData)
    })
    .then(res => res.json())
    .then(result => {
        if (!result.success) {
            alert(result.error || "Checkout gagal");
            return;
        }

        // 🔥 SIMPAN ORDER ID
        localStorage.setItem("order_id", result.order_id);

        // bersihkan cart UI
        cart = [];
        renderCart();

        // 🔥 PINDAH KE PAYMENT
        window.location.href = `/payment?order_id=${result.order_id}`;
    })
    .catch(() => alert("Server error!"));
}

function goToCheckout() {
    if (cart.length === 0) {
        alert("Keranjang kosong!");
        return;
    }

    // simpan cart ke localStorage sementara
    localStorage.setItem("checkout_cart", JSON.stringify(cart));
    localStorage.setItem("checkout_store_id", cartStoreId);

    // pindah halaman
    window.location.href = "/checkout";
}


function goBack(){ renderHomeContent(); }

function switchContent(fn){
    contentFeed.classList.add("content-exit");
    setTimeout(async()=>{
        await fn();
        window.scrollTo({top:0,behavior:"smooth"});
        requestAnimationFrame(()=>setTimeout(()=>contentFeed.classList.remove("content-exit"),50));
    },250);
}

sidebarItems.forEach(item=>{
    item.addEventListener("click",e=>{
        e.preventDefault();
        const page=item.dataset.page;
        sidebarItems.forEach(i=>i.classList.remove("active"));
        item.classList.add("active");
        if(page==="home"){currentKeyword="";searchInput.value="";initApp();}
    });
});

// START
checkLoginSession();
initApp();




