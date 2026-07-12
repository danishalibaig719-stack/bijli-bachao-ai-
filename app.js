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
// Chart rendering helper
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
// Option 1: Bill upload submit
// ---------------------------------------------------------
document.getElementById("submitBillBtn").addEventListener("click", async () => {
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

  try {
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("rate_per_unit", rate);

    const res = await fetch(`${window.API_BASE_URL}/api/analyze-bill`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Kuch masla ho gaya.");
    }

    const data = await res.json();
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

  try {
    const res = await fetch(`${window.API_BASE_URL}/api/analyze-manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate_per_unit: parseFloat(rate), appliances })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Kuch masla ho gaya.");
    }

    const data = await res.json();
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
