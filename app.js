// ============================================================
// LANGUAGE SELECTOR
// ============================================================
const languageSelect = document.getElementById("languageSelect");

function getSelectedLanguage() {
    return languageSelect.value;
}

// ============================================================
// TABS
// ============================================================
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active");
        
        if (btn.dataset.tab !== "tab-scan") {
            stopCamera();
        }
    });
});

// ============================================================
// APPLIANCE TABLE
// ============================================================
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
        <td><input type="text" class="ap-name" value="${name}" placeholder="Name"></td>
        <td><input type="number" class="ap-watt" value="${watt}" placeholder="W"></td>
        <td><input type="number" class="ap-qty" value="${qty}" placeholder="Qty"></td>
        <td><input type="number" step="0.5" class="ap-hours" value="${hours}" placeholder="Hrs"></td>
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

// ============================================================
// UPLOAD STATUS INDICATOR
// ============================================================
const uploadStatus = document.getElementById("uploadStatus");
const uploadStatusText = document.getElementById("uploadStatusText");

function showUploadStatus(fileName) {
    uploadStatus.className = "upload-status active success";
    uploadStatusText.textContent = `File selected: ${fileName}`;
}

function hideUploadStatus() {
    uploadStatus.className = "upload-status";
}

// ============================================================
// CHARTS
// ============================================================
let billChartInstance = null;
let scanChartInstance = null;
let manualChartInstance = null;

function renderChart(canvasId, breakdown, existingInstance) {
    if (existingInstance) existingInstance.destroy();

    const sorted = [...breakdown].sort((a, b) => b.current_month
