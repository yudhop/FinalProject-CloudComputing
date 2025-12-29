// PAYMENT JAVASCRIPT REVISED
// const API_URL = "client-easyfood-anhrasg7d6a2azb9.indonesiacentral-01.azurewebsites.net";

document.addEventListener("DOMContentLoaded", () => {
  const amountText = document.getElementById("amountText");
  const subtotalText = document.getElementById("subtotalText");
  const deliveryFeeText = document.getElementById("deliveryFeeText");
  const nightFeeText = document.getElementById("nightFeeText");
  const nightFeeRow = document.getElementById("nightFeeRow");

  const splitBillSection = document.getElementById("splitBillSection");
  const splitPeopleContainer = document.getElementById("splitPeopleContainer");
  const paymentBox = document.getElementById("paymentBox");
  const payNowBtn = document.getElementById("payNowBtn");

  const container = document.querySelector("main.container");
  const orderId = container.dataset.orderId;

  let baseSubtotal = 0, baseDelivery = 0, baseNight = 0;
  let selectedPayer = null, payableAmount = 0;
  let isSplit = false, people = [];

  // ================= FUNGSI REDIRECT KE ARIVE =================
  function redirectToArive() {
    console.log("🚀 All paid! Redirecting to arive page...");
    localStorage.setItem("currentOrderId", orderId);
    
    setTimeout(() => {
      window.location.href = `/arive?order_id=${encodeURIComponent(orderId)}`;
    }, 1500); 
  }

  // ================= FETCH DATA =================
  function fetchOrderSummary() {
      fetch(`/orders/${orderId}/summary`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (!data.success) return;
          baseSubtotal = data.subtotal;
          baseDelivery = data.delivery_fee;
          baseNight = data.night_delivery_fee;

          subtotalText.textContent = "Rp " + baseSubtotal.toLocaleString("id-ID");
          deliveryFeeText.textContent = "Rp " + baseDelivery.toLocaleString("id-ID");

          if (baseNight > 0) {
            nightFeeRow.style.display = "flex";
            nightFeeText.textContent = "Rp " + baseNight.toLocaleString("id-ID");
          } else {
            nightFeeRow.style.display = "none";
          }
          
          if (!isSplit) {
             amountText.textContent = "Rp " + (baseSubtotal + baseDelivery + baseNight).toLocaleString("id-ID");
          }
        })
        .catch(err => console.error("Error fetching summary:", err));
  }

  function fetchPaymentInfo() {
      fetch(`/orders/${orderId}/payment-info`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (!data.success) return;
          isSplit = data.is_split;

          if (isSplit) {
            people = data.split;
            renderSplitBill();
            if (people.every(p => p.is_paid)) redirectToArive();
          } else {
            payableAmount = data.total_price;
            amountText.textContent = "Rp " + payableAmount.toLocaleString("id-ID");
            paymentBox.classList.add("show");
          }
        })
        .catch(err => console.error("Error fetching payment info:", err));
  }

  fetchOrderSummary();
  fetchPaymentInfo();

  // ================= RENDER SPLIT BILL =================
  function renderSplitBill() {
    splitPeopleContainer.innerHTML = "";
    
    // Auto deselect jika user yg dipilih ternyata sudah bayar
    if (selectedPayer) {
        const current = people.find(p => p.name === selectedPayer);
        if (current && current.is_paid) selectedPayer = null;
    }

    let firstUnpaidDiv = null;
    let validPeopleCount = people.length > 0 ? people.length : 1;
    const nightPerPerson = Math.round(baseNight / validPeopleCount);

    people.forEach((p) => {
        const amount = Number(p.amount || 0);
        const div = document.createElement("div");
        div.className = "split-person"; 

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span class="name">${p.name}</span>
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span class="amount">Rp ${amount.toLocaleString("id-ID")}</span>
        `;
        
        if (baseNight > 0) {
            html += `<small style="font-size: 11px; color: #764ba2;">(+Rp ${nightPerPerson.toLocaleString("id-ID")} night)</small>`;
        }
        html += `</div></div>`;

        if (p.is_paid) {
            div.classList.add("paid");
            html += '<span class="paid-badge">✓ Paid</span>';
        } else {
            div.style.cursor = "pointer";
            if (!selectedPayer && !firstUnpaidDiv) {
                firstUnpaidDiv = div;
                selectedPayer = p.name;
                div.classList.add("active");
                updateAmountSummary(amount);
            } else if (selectedPayer === p.name) {
                div.classList.add("active");
                updateAmountSummary(amount);
            }

            div.onclick = () => {
                if(payNowBtn.disabled) return; // Cegah ganti user saat loading
                document.querySelectorAll(".split-person").forEach(el => el.classList.remove("active"));
                div.classList.add("active");
                selectedPayer = p.name;
                updateAmountSummary(amount);
            };
        }
        div.innerHTML = html;
        splitPeopleContainer.appendChild(div);
    });

    splitBillSection.classList.remove("hidden");
    
    const allPaid = people.every(p => p.is_paid);
    if (allPaid) {
        paymentBox.style.display = "none";
        const title = document.querySelector(".section-title");
        if(title) title.textContent = "All Paid! Redirecting...";
    } else {
        paymentBox.style.display = "block";
        paymentBox.classList.add("show");
    }
  }

  function updateAmountSummary(splitAmount) {
    let validPeopleCount = people.length > 0 ? people.length : 1;
    let perPersonDelivery = isSplit ? Math.round(baseDelivery / validPeopleCount) : baseDelivery;
    let perPersonNight = isSplit ? Math.round(baseNight / validPeopleCount) : baseNight;
    
    payableAmount = splitAmount + perPersonDelivery + perPersonNight;
    
    subtotalText.textContent = "Rp " + splitAmount.toLocaleString("id-ID");
    deliveryFeeText.textContent = "Rp " + perPersonDelivery.toLocaleString("id-ID");
    if(baseNight > 0) nightFeeText.textContent = "Rp " + perPersonNight.toLocaleString("id-ID");
    amountText.textContent = "Rp " + payableAmount.toLocaleString("id-ID");
  }

  // ================= PAY NOW LOGIC =================
  payNowBtn.addEventListener("click", async () => {
    if (isSplit && !selectedPayer) {
      alert("Pilih dulu siapa yang membayar");
      return;
    }

    payNowBtn.disabled = true;
    payNowBtn.textContent = "Processing...";

    try {
      const res = await fetch(`/payments/midtrans-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ order_id: orderId, payer: selectedPayer || null })
      });
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || "Gagal ambil token");
      }

      // --- SNAP POPUP ---
      snap.pay(data.token, {
        onSuccess: function(result) {
          console.log("✅ Payment success raw:", result);

          // PENTING: Gunakan setTimeout agar error internal Midtrans 
          // tidak menghentikan logic kita.
          setTimeout(async () => {
             try {
                // 1. Konfirmasi ke Backend
                await fetch(`/payments/confirm`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    order_id: orderId,
                    payer: selectedPayer,
                    method: "midtrans",
                    bank: "midtrans"
                  })
                });

                // 2. Logic Update UI
                if (isSplit) {
                    // Ambil status terbaru
                    const statusRes = await fetch(`/orders/${orderId}/split`, { credentials: "include" });
                    const statusData = await statusRes.json();
                    
                    if (statusData.success) {
                        people = statusData.split;
                        renderSplitBill(); // Hijaukan user yang baru bayar
                        
                        const allPaid = people.every(s => s.is_paid);
                        if (allPaid) {
                            alert("✅ Lunas Semua! Redirecting...");
                            redirectToArive();
                        } else {
                            alert(`✅ Berhasil dibayar oleh ${selectedPayer}!`);
                            payNowBtn.disabled = false;
                            payNowBtn.textContent = "Pay Now";
                        }
                    }
                } else {
                    redirectToArive();
                }

             } catch (err) {
                console.error("Logic Error:", err);
                alert("Pembayaran berhasil, refresh halaman untuk update status.");
                location.reload();
             }
          }, 500); // Delay 0.5 detik untuk memisahkan context
        },
        onPending: function(result) {
          alert("⏳ Menunggu pembayaran...");
          payNowBtn.disabled = false;
          payNowBtn.textContent = "Pay Now";
        },
        onError: function(result) {
          alert("❌ Pembayaran gagal.");
          payNowBtn.disabled = false;
          payNowBtn.textContent = "Pay Now";
        },
        onClose: function() {
          payNowBtn.disabled = false;
          payNowBtn.textContent = "Pay Now";
        }
      });

    } catch (error) {
      console.error("System Error:", error);
      alert(error.message);
      payNowBtn.disabled = false;
      payNowBtn.textContent = "Pay Now";
    }
  });

  // ================= AUTO CHECK =================
  if (isSplit) {
    setInterval(async () => {
      try {
        const res = await fetch(`/orders/${orderId}/split`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            let needsRender = false;
            data.split.forEach((serverPerson, index) => {
                if (people[index] && people[index].is_paid !== serverPerson.is_paid) {
                    people[index].is_paid = serverPerson.is_paid;
                    needsRender = true;
                }
            });
            if (needsRender) {
                renderSplitBill();
                if (people.every(p => p.is_paid)) redirectToArive();
            }
          }
        }
      } catch (e) { }
    }, 5000); 
  }

});

