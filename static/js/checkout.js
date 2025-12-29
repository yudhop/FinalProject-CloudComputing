const API_URL = "client-easyfood-anhrasg7d6a2azb9.indonesiacentral-01.azurewebsites.net;

/* DATA */
const DELIVERY = 3.5;

let drivers = [];
let people = [
  {
    id: 1,
    name: "You",
    items: {} // contoh: { menuId: qty }
  }
];
let selectedDriver = null;

/* ELEMENTS */
const cart = JSON.parse(localStorage.getItem("checkout_cart")) || [];
const storeId = localStorage.getItem("checkout_store_id");
const orderItemsDiv = document.getElementById("orderItems");
const totalBox = document.getElementById("totalBox");
const splitToggle = document.getElementById("splitToggle");
const splitSection = document.getElementById("splitSection");
const peopleList = document.getElementById("peopleList");
const driverList = document.getElementById("driverList");

body: JSON.stringify({
  store_id: storeId,
  driver_id: selectedDriver,
  items: cart,
  is_split: splitToggle.checked,
  split_people: splitToggle.checked
    ? people.map(p => ({
        name: p.name,
        amount: personTotal(p)
      }))
    : null,
  total_price: cart.reduce((s, i) => s + i.price * i.qty, 0)
})


function formatETA(minutes) {
  if (!minutes || minutes <= 0) {
    return "Estimasi belum tersedia";
  }

  if (minutes < 60) {
    return `${minutes} menit`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} jam`;
  }

  return `${hours} jam ${remainingMinutes} menit`;
}


/* ORDER */
function renderItems() {
  if (cart.length === 0) {
    orderItemsDiv.innerHTML = "<p>Keranjang kosong</p>";
    return;
  }

  orderItemsDiv.innerHTML = cart.map(i => `
    <div class="item">
      <span>${i.menuName} x ${i.qty}</span>
      <span>Rp ${(i.price * i.qty).toLocaleString()}</span>
    </div>
  `).join("");
}

function renderTotal() {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  totalBox.innerHTML = `
    <span>Total</span>
    <span>Rp ${subtotal.toLocaleString()}</span>
  `;
}

/* SPLIT */
splitToggle.addEventListener("change", () => {
  splitSection.classList.toggle("active", splitToggle.checked);
});


document.getElementById("addPersonBtn").onclick = () => {
  const input = document.getElementById("personName");
  if (!input.value.trim()) return;

  people.push({
    id: Date.now(),
    name: input.value.trim(),
    items: {}
  });

  input.value = "";
  renderPeople();
};

function usedQty(menuId) {
  return people.reduce((sum, p) => sum + (p.items[menuId] || 0), 0);
}


function setQty(personId, menuId, value) {
  const person = people.find(p => p.id === personId);
  if (!person) return;

  const qty = Math.max(0, parseInt(value) || 0);
  person.items[menuId] = qty;

  renderPeople();
}

function addQty(personId, menuIndex) {
  const person = people.find(p => p.id === personId);
  const item = cart[menuIndex];
  if (!person || !item) return;

  const alreadyUsed = usedQty(menuIndex);
  if (alreadyUsed >= item.qty) return;

  person.items[menuIndex] = (person.items[menuIndex] || 0) + 1;
  renderPeople();
}

function removeQty(personId, menuIndex) {
  const person = people.find(p => p.id === personId);
  if (!person || !person.items[menuIndex]) return;

  person.items[menuIndex]--;

  if (person.items[menuIndex] <= 0) {
    delete person.items[menuIndex];
  }

  renderPeople();
}

function toggleItem(pid,iid){
  const person = people.find(p=>p.id===pid);
  if(!person) return;

  person.items.includes(iid)
    ? person.items = person.items.filter(i=>i!==iid)
    : person.items.push(iid);

  renderPeople();
}
function getItemById(menuId) {
  return cart.find(i => i.id === menuId);
}

function personTotal(person) {
  return Object.entries(person.items).reduce((sum, [index, qty]) => {
    const item = cart[index];
    if (!item) return sum;
    return sum + item.price * qty;
  }, 0);
}




function renderPeople() {
  peopleList.innerHTML = people.map(p => `
    <div class="person">
      <div class="person-header">
        <span>${p.name}</span>
        <span>Rp ${personTotal(p).toLocaleString("id-ID")}</span>
      </div>

      ${cart.map((item, index) => {
        const taken = usedQty(index);
        const left = item.qty - taken;
        const qty = p.items[index] || 0;

        return `
          <div class="qty-row">
            <span>${item.menuName}</span>

            <div class="split-control">
              <button onclick="removeQty(${p.id}, ${index})">−</button>
              <span>${qty}</span>
              <button onclick="addQty(${p.id}, ${index})"
                ${left === 0 ? "disabled" : ""}>
                +
              </button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `).join("");
}






/* DRIVER */

function renderDrivers() {
  if (drivers.length === 0) {
    driverList.innerHTML = "<p>Tidak ada driver tersedia</p>";
    return;
  }

  driverList.innerHTML = drivers.map(d => `
    <div class="driver ${selectedDriver === d.id ? "active" : ""}"
         onclick="selectDriver(${d.id})">

      <strong>${d.name}</strong><br>
      ⭐ ${d.rating} · ${d.vehicle}<br>
      <small class="${d.eta_minutes <= 30 ? 'fast' : ''}">
        ETA: ${formatETA(d.eta_minutes)}
      </small>

    </div>
  `).join("");
}



function selectDriver(id){
  selectedDriver=id;
  renderDrivers();
}

/* DRIVER */
async function fetchDrivers() {
  try {
    const res = await fetch(
      `${API_URL}/drivers?store_id=${storeId}`
    );
    drivers = await res.json();
    renderDrivers();
  } catch (err) {
    driverList.innerHTML = "<p>Gagal memuat driver</p>";
  }
}

async function submitCheckout(orderPayload) {
  const res = await fetch("/orders/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(orderPayload)
  });

  const data = await res.json();
  if (!data.success) throw new Error("Checkout failed");

  return data.order_id;
}

/* CHECKOUT */
document.getElementById("confirmBtn").onclick = async () => {
  if (!cart.length) return;
  if (!selectedDriver) return;

  const totalPrice = cart.reduce(
    (sum, i) => sum + i.price * i.qty,
    0
  );

  const payload = {
    store_id: storeId,                 // 🔥 WAJIB
    driver_id: selectedDriver,
    items: cart,                       // [{menuName, qty, price}]
    total_price: totalPrice,
    is_split: splitToggle.checked,
    split_people: splitToggle.checked
      ? people.map(p => ({
          name: p.name,
          amount: personTotal(p)
        }))
      : null
  };

  const res = await fetch(`${API_URL}/orders/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!data.success) return;

  // localStorage.setItem("checkout_people", JSON.stringify(people))
  if (splitToggle.checked) {
  const splitPeople = people.map(p => ({
    name: p.name,
    amount: personTotal(p)
  }));

  localStorage.setItem(
    "checkout_people",
    JSON.stringify(splitPeople)
  );
}

  localStorage.setItem("order_id", data.order_id);

  localStorage.removeItem("checkout_cart");
  localStorage.removeItem("checkout_store_id");

  window.location.href = `/payment?order_id=${data.order_id}`;
};



/* INIT */
renderItems();
renderTotal();
renderPeople();

fetchDrivers();
