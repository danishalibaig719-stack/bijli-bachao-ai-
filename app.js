// ---------------------------------------------------------
// Language Selector
// ---------------------------------------------------------
const languageSelect = document.getElementById("languageSelect");

function getSelectedLanguage() {
    return languageSelect.value;
}

// ---------------------------------------------------------
// Tabs
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
// Chart rendering
// ---------------------------------------------------------
let billChartInstance = null;
let manualChartInstance = null;

function renderChart(canvasId, breakdown, existingInstance) {
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
// Summary rendering with language support
// ---------------------------------------------------------
function renderSummary(container, data) {
  let html = "";
  
  if (data.total_units !== undefined) {
    html += `<div><b>Total Units:</b> ${data.total_units}</div>`;
  }
  if (data.rate_per_unit !== undefined) {
    html += `<div><b>Rate per Unit:</b> Rs ${data.rate_per_unit}</div>`;
  }
  if (data.bill_type) {
    html += `<div><b>Bill Type:</b> ${data.bill_type}</div>`;
  }
  if (data.consumer_category) {
    html += `<div><b>Consumer Category:</b> ${data.consumer_category}</div>`;
  }
  
  html += `<div class="risk-badge">Risk: ${data.risk_level || "-"}</div>`;
  html += `<div class="saving-line">Estimated Monthly Saving: ${data.estimated_monthly_saving_units || "-"} Units (~Rs ${data.estimated_monthly_saving_rs || "-"})</div>`;
  html += `<p>${data.overall_summary || ""}</p>`;
  html += `<h3>Appliance-Wise Steps</h3>`;
  
  (data.appliance_insights || []).forEach(item => {
    html += `<div class="appliance-tip">
      <b>${item.appliance}</b>: ${item.current_monthly_units} units/month
      → ${item.suggested_daily_hours} hours/day
      → <b>${item.monthly_unit_saving} units saved</b>.<br>
      ${item.tip || ""}
    </div>`;
  });
  
  container.innerHTML = html;
}

// ---------------------------------------------------------
// Image compression
// ---------------------------------------------------------
function compressImage(file, maxWidth = 1400, quality = 0.75) {
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
// Option 1: Bill upload submit
// ---------------------------------------------------------
document.getElementById("submitBillBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("billImageInput");
  const loading = document.getElementById("billLoading");
  const errorBox = document.getElementById("billError");
  const resultArea = document.getElementById("billResultArea");
  const rateDisplay = document.getElementById("billRateDisplay");

  errorBox.classList.add("hidden");
  resultArea.classList.add("hidden");

  if (!fileInput.files.length) {
    errorBox.textContent = "Pehle bill ki image upload karein.";
    errorBox.classList.remove("hidden");
    return;
  }

  loading.classList.remove("hidden");

  try {
    const compressedFile = await compressImage(fileInput.files[0]);
    const formData = new FormData();
    formData.append("file", compressedFile);
    formData.append("language", getSelectedLanguage());

    const res = await fetch(`${window.API_BASE_URL}/api/analyze-bill`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      let message = `Server error (status ${res.status}).`;
      try {
        const err = await res.json();
        message = err.detail || message;
      } catch (_) {}
      throw new Error(message);
    }

    const data = await res.json();
    
    // Show rate info
    if (data.rate_per_unit) {
      rateDisplay.textContent = `💰 Rate: Rs ${data.rate_per_unit}/unit | Bill: ${data.bill_type || "Auto"} | Category: ${data.consumer_category || "N/A"}`;
      rateDisplay.style.display = "block";
    }
    
    billChartInstance = renderChart("billChart", data.breakdown, billChartInstance);
    renderSummary(document.getElementById("billSummary"), data);
    resultArea.classList.remove("hidden");
  } catch (e) {
    errorBox.textContent = e.message;
    errorBox.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
});

// ---------------------------------------------------------
// Option 2: Manual submit
// ---------------------------------------------------------
document.getElementById("submitManualBtn").addEventListener("click", async () => {
  const loading = document.getElementById("manualLoading");
  const errorBox = document.getElementById("manualError");
  const resultArea = document.getElementById("manualResultArea");
  const rateDisplay = document.getElementById("manualRateDisplay");

  errorBox.classList.add("hidden");
  resultArea.classList.add("hidden");

  const appliances = collectAppliances();
  if (!appliances.length) {
    errorBox.textContent = "Kam az kam ek appliance ki tadad aur ghante bharein.";
    errorBox.classList.remove("hidden");
    return;
  }

  loading.classList.remove("hidden");

  try {
    const res = await fetch(`${window.API_BASE_URL}/api/analyze-manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rate_per_unit: 35,
        appliances: appliances,
        language: getSelectedLanguage()
      })
    });

    if (!res.ok) {
      let message = `Server error (status ${res.status}).`;
      try {
        const err = await res.json();
        message = err.detail || message;
      } catch (_) {}
      throw new Error(message);
    }

    const data = await res.json();
    
    if (data.rate_per_unit) {
      rateDisplay.textContent = `💰 Rate: Rs ${data.rate_per_unit}/unit`;
      rateDisplay.style.display = "block";
    }
    
    manualChartInstance = renderChart("manualChart", data.breakdown, manualChartInstance);
    renderSummary(document.getElementById("manualSummary"), data);
    resultArea.classList.remove("hidden");
  } catch (e) {
    errorBox.textContent = e.message;
    errorBox.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
});
