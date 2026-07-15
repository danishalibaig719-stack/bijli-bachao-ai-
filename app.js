// ---------------------------------------------------------
// Tabs Logic
// ---------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ---------------------------------------------------------
// Appliance table (Option 2)
// ---------------------------------------------------------
const DEFAULT_APPLIANCES = [
  ["AC (1.5 Ton Split)", 1500, 0, 0],
  ["Fridge", 150, 1, 24],
  ["Ceiling Fan", 75, 3, 10],
  ["LED Bulb/Tubelight", 15, 6, 8],
  ["Water Motor/Pump", 750, 1, 1],
  ["Washing Machine", 500, 1, 1],
  ["Electric Iron", 1000, 1, 0.5],
  ["Electric Geyser", 2000, 1, 0],
  ["LED TV", 100, 1, 4],
];

const tableBody = document.getElementById("applianceTableBody");

function addRow(name = "", watt = "", qty = "", hours = "") {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="ap-name" value="${name}"></td>
    <td><input type="number" class="ap-watt" value="${watt}"></td>
    <td><input type="number" class="ap-qty" value="${qty}"></td>
    <td><input type="number" step="0.5" class="ap-hours" value="${hours}"></td>
  `;
  tableBody.appendChild(tr);
}

DEFAULT_APPLIANCES.forEach(row => addRow(...row));

document.getElementById("addRowBtn").addEventListener("click", () => addRow());

function collectAppliances() {
  const rows = tableBody.querySelectorAll("tr");
  const appliances = [];
  rows.forEach(row => {
    const name = row.querySelector(".ap-name").value.trim();
    const watt = parseFloat(row.querySelector(".ap-watt").value) || 0;
    const qty = parseFloat(row.querySelector(".ap-qty").value) || 0;
    const hours = parseFloat(row.querySelector(".ap-hours").value) || 0;
    if (name && watt > 0 && qty > 0 && hours > 0) {
      appliances.push({ name, watt, qty, hours });
    }
  });
  return appliances;
}

// ---------------------------------------------------------
// Helper: Fetch with retry (specifically handling 429 and 503 errors)
// ---------------------------------------------------------
async function fetchWithRetry(url, options, retries = 3, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      // If hit 429 (Rate Limit) or 503 (Busy)
      if (response.status === 429 || response.status === 503) {
        throw new Error(response.status === 429 ? "429_RATE_LIMIT" : "503_SERVICE_UNAVAILABLE");
      }
      return response;
    } catch (err) {
      // Retry if it's rate limit or temporary server error
      if ((err.message === "429_RATE_LIMIT" || err.message === "503_SERVICE_UNAVAILABLE") && i < retries - 1) {
        console.warn(`Gemini API busy/rate-limited (${err.message}). Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})`);
        await new Promise(res => setTimeout(res, delay));
        // Double the delay for exponential backoff
        delay *= 1.5; 
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------
// Chart rendering helper
// ---------------------------------------------------------
let billChartInstance = null;
let manualChartInstance = null;

function renderChart(canvasId, breakdown, existingInstance) {
  if (typeof Chart === "undefined") {
    console.error("Chart library loaded nahi ho saki.");
    return null;
  }
  if (existingInstance) existingInstance.destroy();
  
  const sorted = [...breakdown].sort((a, b) => b.current_monthly_units - a.current_monthly_units);
  const labels = sorted.map(i => i.appliance);
  const values = sorted.map(i => i.current_monthly_units);
  const maxVal = Math.max(...values, 1);
  const ctx = document.getElementById(canvasId).getContext("2d");
  
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Units / Mahina",
        data: values,
        backgroundColor: values.map(v => v === maxVal ? "#e74c3c" : "#2980b9"),
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } }
    }
  });
}

// ---------------------------------------------------------
// Summary rendering helper
// ---------------------------------------------------------
function renderSummary(container, data) {
  let html = "";
  if (data.extracted_bill_units !== undefined) {
    html += `<div><b>Bill Se Nikale Gaye Units:</b> ${data.extracted_bill_units}</div>`;
  }
  html += `<div class="risk-badge">Risk: ${data.risk_level || "-"}</div>`;
  html += `<div class="saving-line">Andazan Mahana Bachat: ${data.estimated_monthly_saving_units || "-"} Units (~Rs ${data.estimated_monthly_saving_rs || "-"})</div>`;
  html += `<p>${data.overall_summary_roman_urdu || ""}</p>`;
  html += `<h3>Appliance-Wise Specific Steps</h3>`;
  (data.appliance_insights || []).forEach(item => {
    html += `<div class="appliance-tip">
      <b>${item.appliance}</b>: abhi ${item.current_monthly_units} units/mahina
      → ${item.suggested_daily_hours} ghante/din karein
      → <b>${item.monthly_unit_saving} units bachenge</b>.<br>
      ${item.tip_roman_urdu}
    </div>`;
  });
  container.innerHTML = html;
}

// ---------------------------------------------------------
// Image compression helper
// ---------------------------------------------------------
function compressImage(file, maxWidth = 1000, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Image compress nahi ho saki."));
            resolve(new File([blob], "bill.jpg", { type: "image/jpeg" }));
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => reject(new Error("Image load nahi ho saki."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("File read nahi ho saka."));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------
// Cooldown Button Helper (Blocks double-taps for 12 seconds)
// ---------------------------------------------------------
function setButtonCooldown(button, duration = 12000) {
  const originalText = button.textContent;
  button.disabled = true;
  let secondsLeft = Math.ceil(duration / 1000);
  
  const interval = setInterval(() => {
    secondsLeft--;
    button.textContent = `Rukiye... (${secondsLeft}s)`;
    if (secondsLeft <= 0) {
      clearInterval(interval);
      button.disabled = false;
      button.textContent = originalText;
    }
  }, 1000);
}

// ---------------------------------------------------------
// Option 1: Bill upload submit
// ---------------------------------------------------------
document.getElementById("submitBillBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  const fileInput = document.getElementById("billImageInput");
  const rate = document.getElementById("rateBill").value || 35;
  const loading = document.getElementById("billLoading");
  const errorBox = document.getElementById("billError");
  const resultArea = document.getElementById("billResultArea");
  
  errorBox.classList.add("hidden");
  resultArea.classList.add("hidden");
  
  if (!fileInput.files.length) {
    errorBox.textContent = "Pehle bill ki image upload karein.";
    errorBox.classList.remove("hidden");
    return;
  }
  
  loading.classList.remove("hidden");
  setButtonCooldown(btn, 12000); // 12 seconds break
  
  try {
    const compressedFile = await compressImage(fileInput.files[0]);
    const formData = new FormData();
    formData.append("file", compressedFile);
    formData.append("rate_per_unit", rate);
    
    const res = await fetchWithRetry(`${window.API_BASE_URL}/api/analyze-bill`, {
      method: "POST",
      body: formData
    });
    
    if (!res) {
      throw new Error("AI models par load ki wajah se timeout ho gaya.");
    }
    
    if (res.status === 504) {
      throw new Error("504_TIMEOUT");
    }
    
    if (res.status === 429) {
      throw new Error("429_RATE_LIMIT");
    }
    
    if (!res.ok) {
      let message = `Server error (status ${res.status}).`;
      try {
        const err = await res.json();
        message = err.detail || message;
      } catch (_) {}
      throw new Error(message);
    }
    
    const data = await res.json();
    billChartInstance = renderChart("billChart", data.breakdown, billChartInstance);
    renderSummary(document.getElementById("billSummary"), data);
    resultArea.classList.remove("hidden");
  } catch (err) {
    if (err.message.includes("429") || err.message === "429_RATE_LIMIT") {
      errorBox.innerHTML = "⚠️ <b>Hamaray Free AI server ki limit khatam ho chuki hai!</b><br>Apne Google Console par limits check karein ya 1 minute ke baad dobara submit karein (Google 1 minute mein sirf 5 requests allow karta hai).";
    } else if (err.message.includes("504") || err.message === "504_TIMEOUT") {
      errorBox.textContent = "Server Timeout (504): Report analysis bohot slow chal rahi hai. Koshish karein ke direct manual tools use karein ya dobara submit dabaein.";
    } else {
      errorBox.textContent = err.message;
    }
    errorBox.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
});

// ---------------------------------------------------------
// Option 2: Manual submit
// ---------------------------------------------------------
document.getElementById("submitManualBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  const rate = document.getElementById("rateManual").value || 35;
  const loading = document.getElementById("manualLoading");
  const errorBox = document.getElementById("manualError");
  const resultArea = document.getElementById("manualResultArea");
  
  errorBox.classList.add("hidden");
  resultArea.classList.add("hidden");
  
  const appliances = collectAppliances();
  if (!appliances.length) {
    errorBox.textContent = "Kam az kam ek appliance ki tadad aur ghante bharein.";
    errorBox.classList.remove("hidden");
    return;
  }
  
  loading.classList.remove("hidden");
  setButtonCooldown(btn, 12000); // 12 seconds break
  
  try {
    const res = await fetchWithRetry(`${window.API_BASE_URL}/api/analyze-manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate_per_unit: parseFloat(rate), appliances })
    });
    
    if (!res) {
      throw new Error("AI models par load ki wajah se timeout ho gaya.");
    }
    
    if (res.status === 504) {
      throw new Error("504_TIMEOUT");
    }
    
    if (res.status === 429) {
      throw new Error("429_RATE_LIMIT");
    }
    
    if (!res.ok) {
      let message = `Server error (status ${res.status}).`;
      try {
        const err = await res.json();
        message = err.detail || message;
      } catch (_) {}
      throw new Error(message);
    }
    
    const data = await res.json();
    manualChartInstance = renderChart("manualChart", data.breakdown, manualChartInstance);
    renderSummary(document.getElementById("manualSummary"), data);
    resultArea.classList.remove("hidden");
  } catch (err) {
    if (err.message.includes("429") || err.message === "429_RATE_LIMIT") {
      errorBox.innerHTML = "⚠️ <b>Free API Limit Exhausted (429 Error):</b><br>Google Gemini 1 minute mein 5 requests se zyada allow nahi karta. Bara-e-meherbani 30 se 60 seconds intezar kar ke dobara try karein.";
    } else if (err.message.includes("504") || err.message === "504_TIMEOUT") {
      errorBox.textContent = "Server Timeout (504): AI response ready nahi kar paya. Thoda sa waqt le kar dubara try karein.";
    } else {
      errorBox.textContent = err.message;
    }
    errorBox.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
});
