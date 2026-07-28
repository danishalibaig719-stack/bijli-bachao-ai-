// ============================================================
// FIREBASE AUTH STATE
// ============================================================
let currentUser = null;

// Listen for auth state changes
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        showUserUI(user);
        loadUserHistory(user.uid);
    } else {
        currentUser = null;
        showGuestUI();
        document.getElementById('historyList').innerHTML = 
            '<p style="color:#8a9aaa;text-align:center;padding:20px;">Please login to see your history.</p>';
    }
});

// ============================================================
// UI HELPERS
// ============================================================
function showUserUI(user) {
    document.getElementById('userInfo').classList.add('active');
    document.getElementById('userEmail').textContent = user.email;
    document.getElementById('loginBtn').style.display = 'none';
    document.getElementById('signupBtn').style.display = 'none';
}

function showGuestUI() {
    document.getElementById('userInfo').classList.remove('active');
    document.getElementById('loginBtn').style.display = 'inline-block';
    document.getElementById('signupBtn').style.display = 'inline-block';
}

// ============================================================
// AUTH MODAL
// ============================================================
const authModal = document.getElementById('authModal');
const authModalTitle = document.getElementById('authModalTitle');
const authModalSub = document.getElementById('authModalSub');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authToggleLink = document.getElementById('authToggleLink');
const authToggleText = document.getElementById('authToggleText');
const authError = document.getElementById('authError');

let isLoginMode = true;

function openAuthModal(mode = 'login') {
    isLoginMode = mode === 'login';
    authModal.classList.add('active');
    authError.classList.remove('active');
    authEmail.value = '';
    authPassword.value = '';
    
    if (isLoginMode) {
        authModalTitle.textContent = 'Login';
        authModalSub.textContent = 'Sign in to save your reports';
        authSubmit.textContent = 'Login';
        authToggleText.textContent = "Don't have an account?";
        authToggleLink.textContent = 'Sign Up';
    } else {
        authModalTitle.textContent = 'Sign Up';
        authModalSub.textContent = 'Create your free account';
        authSubmit.textContent = 'Sign Up';
        authToggleText.textContent = 'Already have an account?';
        authToggleLink.textContent = 'Login';
    }
}

function closeAuthModal() {
    authModal.classList.remove('active');
}

// Open modal on login/signup click
document.getElementById('loginBtn').addEventListener('click', () => openAuthModal('login'));
document.getElementById('signupBtn').addEventListener('click', () => openAuthModal('signup'));
document.getElementById('closeModal').addEventListener('click', closeAuthModal);
authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
});

// Toggle between login/signup
authToggleLink.addEventListener('click', () => {
    openAuthModal(isLoginMode ? 'signup' : 'login');
});

// Enter key support for auth
authEmail.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') authPassword.focus();
});
authPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') authSubmit.click();
});

// ============================================================
// AUTH SUBMIT
// ============================================================
authSubmit.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const password = authPassword.value.trim();
    
    authError.classList.remove('active');
    
    if (!email || !password) {
        authError.textContent = 'Please enter email and password.';
        authError.classList.add('active');
        return;
    }
    
    if (password.length < 6) {
        authError.textContent = 'Password must be at least 6 characters.';
        authError.classList.add('active');
        return;
    }
    
    authSubmit.disabled = true;
    authSubmit.textContent = 'Please wait...';
    
    try {
        if (isLoginMode) {
            await auth.signInWithEmailAndPassword(email, password);
        } else {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            // Save user profile to Firestore
            await db.collection('users').doc(userCredential.user.uid).set({
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                totalReports: 0
            });
        }
        closeAuthModal();
    } catch (error) {
        authError.textContent = error.message;
        authError.classList.add('active');
    } finally {
        authSubmit.disabled = false;
        authSubmit.textContent = isLoginMode ? 'Login' : 'Sign Up';
    }
});

// ============================================================
// LOGOUT
// ============================================================
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await auth.signOut();
});

// ============================================================
// SAVE REPORT TO FIRESTORE
// ============================================================
async function saveReportToFirestore(reportData) {
    if (!currentUser) {
        console.log('User not logged in. Report not saved.');
        return;
    }
    
    try {
        const reportRef = db.collection('reports').doc();
        await reportRef.set({
            userId: currentUser.uid,
            ...reportData,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            reportId: reportRef.id
        });
        
        // Update user's report count
        await db.collection('users').doc(currentUser.uid).update({
            totalReports: firebase.firestore.FieldValue.increment(1)
        });
        
        console.log('✅ Report saved successfully!');
        // Reload history if user is on history tab
        if (document.getElementById('tab-history').classList.contains('active')) {
            loadUserHistory(currentUser.uid);
        }
    } catch (error) {
        console.error('❌ Error saving report:', error);
    }
}

// ============================================================
// LOAD USER HISTORY
// ============================================================
async function loadUserHistory(userId) {
    try {
        const snapshot = await db.collection('reports')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        
        const reports = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            reports.push({ 
                id: doc.id, 
                ...data,
                // Convert Firestore timestamp to Date
                createdAt: data.createdAt ? data.createdAt.toDate() : null
            });
        });
        
        renderHistory(reports);
    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('historyList').innerHTML = 
            '<p style="color:#d32f2f;text-align:center;padding:20px;">Error loading history. Please try again.</p>';
    }
}

function renderHistory(reports) {
    const historyContainer = document.getElementById('historyList');
    
    if (reports.length === 0) {
        historyContainer.innerHTML = 
            '<p style="color:#8a9aaa;text-align:center;padding:20px;">📭 No reports yet. Generate your first report!</p>';
        return;
    }
    
    let html = '';
    reports.forEach((report, index) => {
        const date = report.createdAt ? report.createdAt.toLocaleDateString('en-PK', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }) : 'N/A';
        
        const units = report.total_units || '?';
        const savings = report.estimated_monthly_saving_units || '?';
        const source = report.source || 'unknown';
        const sourceEmoji = source === 'bill_upload' ? '📄' : 
                           source === 'scan' ? '📷' : 
                           source === 'manual' ? '🏠' : '📊';
        
        html += `
            <div class="history-item" onclick="viewReport('${report.id}')">
                <div class="history-left">
                    <span class="history-index">#${index + 1}</span>
                    <span class="history-date">${date}</span>
                    <span style="font-size:13px;color:#8a9aaa;">${sourceEmoji}</span>
                </div>
                <div class="history-right">
                    <span class="history-units">⚡ ${units} units</span>
                    <span class="history-savings">Save ${savings} units</span>
                </div>
            </div>
        `;
    });
    historyContainer.innerHTML = html;
}

// ============================================================
// VIEW REPORT (History Click)
// ============================================================
window.viewReport = function(reportId) {
    // Load full report from Firestore
    db.collection('reports').doc(reportId).get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();
                // Show report in a modal or alert
                let summary = data.overall_summary || 'No summary available';
                let units = data.total_units || 'N/A';
                let savings = data.estimated_monthly_saving_units || 'N/A';
                let insights = data.appliance_insights || [];
                
                let msg = `📊 Report Details\n`;
                msg += `━━━━━━━━━━━━━━━━━━━━\n`;
                msg += `⚡ Total Units: ${units}\n`;
                msg += `💰 Savings: ${savings} units/month\n`;
                msg += `📝 Summary: ${summary}\n\n`;
                
                if (insights.length > 0) {
                    msg += `🔧 Appliance Tips:\n`;
                    insights.slice(0, 3).forEach((item, i) => {
                        msg += `  ${i+1}. ${item.appliance}: ${item.tip || ''}\n`;
                    });
                }
                
                alert(msg);
            } else {
                alert('Report not found.');
            }
        })
        .catch(err => {
            console.error('Error loading report:', err);
            alert('Error loading report. Please try again.');
        });
};

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
        
        // Reload history when history tab is clicked
        if (btn.dataset.tab === "tab-history" && currentUser) {
            loadUserHistory(currentUser.uid);
        }
        
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
// UPLOAD STATUS
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
                label: "Units / Month",
                data: values,
                backgroundColor: values.map(v => v === maxVal ? "#1a7a4c" : "#4caf84"),
                borderRadius: 6,
                barPercentage: 0.7,
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.parsed.x + ' units/month';
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: '#d4edda' }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ============================================================
// SUMMARY RENDERER
// ============================================================
function renderSummary(container, data) {
    let html = "";

    if (data.total_units !== undefined || data.rate_per_unit !== undefined) {
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">`;
        if (data.total_units !== undefined) {
            html += `<div style="background:#e8f5e9;padding:10px 14px;border-radius:10px;"><b>📊 Total Units:</b> ${data.total_units}</div>`;
        }
        if (data.rate_per_unit !== undefined) {
            html += `<div style="background:#e8f5e9;padding:10px 14px;border-radius:10px;"><b>💰 Rate:</b> Rs ${data.rate_per_unit}/unit</div>`;
        }
        if (data.bill_type) {
            html += `<div style="background:#fff3cd;padding:10px 14px;border-radius:10px;"><b>🏷️ Bill Type:</b> ${data.bill_type}</div>`;
        }
        if (data.consumer_category) {
            html += `<div style="background:#f3e5f5;padding:10px 14px;border-radius:10px;"><b>👤 Category:</b> ${data.consumer_category}</div>`;
        }
        html += `</div>`;
    }

    const risk = data.risk_level || "-";
    const riskClass = risk.toLowerCase().includes("kam") ? "Kam" : 
                     risk.toLowerCase().includes("zyada") ? "Zyada" : "Darmiyana";
    html += `<div class="risk-badge" data-risk="${riskClass}">⚠️ Risk Level: ${risk}</div>`;

    if (data.estimated_monthly_saving_units) {
        html += `<div class="saving-line">💰 Estimated Monthly Saving: ${data.estimated_monthly_saving_units} Units (~Rs ${data.estimated_monthly_saving_rs || 'N/A'})</div>`;
    }

    if (data.overall_summary) {
        html += `<p style="margin:12px 0 6px 0;font-size:16px;">${data.overall_summary}</p>`;
    }

    const insights = data.appliance_insights || [];
    if (insights.length > 0) {
        html += `<h3>🔧 Appliance-Wise Recommendations</h3>`;
        insights.forEach(item => {
            html += `<div class="appliance-tip">
                <b>${item.appliance}</b><br>
                Current: ${item.current_monthly_units} units/month → 
                Suggested: ${item.suggested_daily_hours} hrs/day → 
                <b>Save ${item.monthly_unit_saving} units/month</b><br>
                <span style="color:#5a6a7a;font-size:14px;">💡 ${item.tip || ''}</span>
            </div>`;
        });
    }

    container.innerHTML = html;
}

// ============================================================
// IMAGE COMPRESSION
// ============================================================
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
                        if (!blob) return reject(new Error("Compression failed"));
                        resolve(new File([blob], "bill.jpg", { type: "image/jpeg" }));
                    },
                    "image/jpeg",
                    quality
                );
            };
            img.onerror = () => reject(new Error("Image load failed"));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
    });
}

// ============================================================
// CAMERA FUNCTIONALITY
// ============================================================
let stream = null;
let capturedFile = null;

const video = document.getElementById('video');
const cameraContainer = document.getElementById('cameraContainer');
const capturedPreview = document.getElementById('capturedPreview');
const capturedImage = document.getElementById('capturedImage');
const startCameraBtn = document.getElementById('startCameraBtn');
const captureBtn = document.getElementById('captureBtn');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const retakeBtn = document.getElementById('retakeBtn');

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
        });
        video.srcObject = stream;
        cameraContainer.classList.add('active');
        capturedPreview.classList.remove('active');
        capturedFile = null;
        startCameraBtn.textContent = '📷 Camera Open';
        startCameraBtn.style.opacity = '0.6';
    } catch (err) {
        alert('❌ Camera open nahi ho paai. Please allow camera permission.');
        console.error('Camera error:', err);
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    video.srcObject = null;
    cameraContainer.classList.remove('active');
    startCameraBtn.textContent = '📷 Open Camera';
    startCameraBtn.style.opacity = '1';
}

function captureImage() {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    canvas.toBlob((blob) => {
        if (blob) {
            capturedFile = new File([blob], "scanned_bill.jpg", { type: "image/jpeg" });
            const url = URL.createObjectURL(blob);
            capturedImage.src = url;
            capturedPreview.classList.add('active');
            cameraContainer.classList.remove('active');
            stopCamera();
        }
    }, 'image/jpeg', 0.9);
}

startCameraBtn.addEventListener('click', startCamera);
captureBtn.addEventListener('click', captureImage);
closeCameraBtn.addEventListener('click', () => {
    stopCamera();
    cameraContainer.classList.remove('active');
});
retakeBtn.addEventListener('click', () => {
    capturedPreview.classList.remove('active');
    capturedFile = null;
    startCamera();
});

// ============================================================
// OPTION 1: BILL UPLOAD
// ============================================================
const uploadBtn = document.getElementById('uploadBtn');
const billImageInput = document.getElementById('billImageInput');

uploadBtn.addEventListener('click', () => {
    billImageInput.click();
});

billImageInput.addEventListener('change', function() {
    if (this.files.length > 0) {
        showUploadStatus(this.files[0].name);
    } else {
        hideUploadStatus();
    }
});

document.getElementById("submitBillBtn").addEventListener("click", async () => {
    const fileInput = document.getElementById("billImageInput");
    const billType = document.getElementById("billTypeSelect").value;
    const loading = document.getElementById("billLoading");
    const errorBox = document.getElementById("billError");
    const resultArea = document.getElementById("billResultArea");
    const rateDisplay = document.getElementById("billRateDisplay");

    errorBox.classList.add("hidden");
    resultArea.classList.add("hidden");
    rateDisplay.classList.remove("active");

    if (!fileInput.files.length) {
        errorBox.textContent = "❌ Please select a bill image first.";
        errorBox.classList.remove("hidden");
        return;
    }

    loading.classList.remove("hidden");

    try {
        const compressedFile = await compressImage(fileInput.files[0]);
        const formData = new FormData();
        formData.append("file", compressedFile);
        formData.append("language", getSelectedLanguage());
        formData.append("bill_type", billType);

        const res = await fetch(`${window.API_BASE_URL}/api/analyze-bill`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            let message = `Server error (${res.status})`;
            try {
                const err = await res.json();
                message = err.detail || message;
            } catch (_) {}
            
            if (res.status === 400) {
                errorBox.textContent = message.includes("units") 
                    ? "❌ Bill se units nahi nikal paaye. Clear photo upload karein."
                    : "❌ Invalid bill image. Please upload a clear photo.";
            } else if (res.status === 429 || res.status === 503) {
                errorBox.textContent = "⏳ AI service busy hai. 1-2 minute baad dobara try karein.";
            } else if (res.status === 500) {
                errorBox.textContent = "❌ AI service mein masla aaya. Please try again.";
            } else {
                errorBox.textContent = `❌ ${message}`;
            }
            errorBox.classList.remove("hidden");
            return;
        }

        const data = await res.json();

        // Save to Firestore if user is logged in
        if (currentUser) {
            await saveReportToFirestore({
                total_units: data.total_units,
                rate_per_unit: data.rate_per_unit,
                bill_type: data.bill_type,
                consumer_category: data.consumer_category,
                risk_level: data.risk_level,
                estimated_monthly_saving_units: data.estimated_monthly_saving_units,
                estimated_monthly_saving_rs: data.estimated_monthly_saving_rs,
                overall_summary: data.overall_summary,
                appliance_insights: data.appliance_insights,
                source: 'bill_upload'
            });
        }

        if (data.rate_per_unit) {
            rateDisplay.textContent = `💰 Rate: Rs ${data.rate_per_unit}/unit | ${data.bill_type || 'Auto'} | ${data.consumer_category || 'N/A'}`;
            rateDisplay.classList.add("active");
        }

        billChartInstance = renderChart("billChart", data.breakdown, billChartInstance);
        renderSummary(document.getElementById("billSummary"), data);
        resultArea.classList.remove("hidden");

    } catch (e) {
        errorBox.textContent = `❌ ${e.message}`;
        errorBox.classList.remove("hidden");
    } finally {
        loading.classList.add("hidden");
    }
});

// ============================================================
// OPTION 2: SCAN BILL
// ============================================================
document.getElementById("submitScanBtn").addEventListener("click", async () => {
    const billType = document.getElementById("billTypeSelectScan").value;
    const loading = document.getElementById("scanLoading");
    const errorBox = document.getElementById("scanError");
    const resultArea = document.getElementById("scanResultArea");
    const rateDisplay = document.getElementById("scanRateDisplay");

    errorBox.classList.add("hidden");
    resultArea.classList.add("hidden");
    rateDisplay.classList.remove("active");

    if (!capturedFile) {
        errorBox.textContent = "❌ Pehle camera se bill scan karein.";
        errorBox.classList.remove("hidden");
        return;
    }

    loading.classList.remove("hidden");

    try {
        const compressedFile = await compressImage(capturedFile);
        const formData = new FormData();
        formData.append("file", compressedFile);
        formData.append("language", getSelectedLanguage());
        formData.append("bill_type", billType);

        const res = await fetch(`${window.API_BASE_URL}/api/analyze-bill`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            let message = `Server error (${res.status})`;
            try {
                const err = await res.json();
                message = err.detail || message;
            } catch (_) {}
            
            if (res.status === 400) {
                errorBox.textContent = message.includes("units") 
                    ? "❌ Bill se units nahi nikal paaye. Clear photo upload karein."
                    : "❌ Invalid bill image. Please upload a clear photo.";
            } else if (res.status === 429 || res.status === 503) {
                errorBox.textContent = "⏳ AI service busy hai. 1-2 minute baad dobara try karein.";
            } else if (res.status === 500) {
                errorBox.textContent = "❌ AI service mein masla aaya. Please try again.";
            } else {
                errorBox.textContent = `❌ ${message}`;
            }
            errorBox.classList.remove("hidden");
            return;
        }

        const data = await res.json();

        if (currentUser) {
            await saveReportToFirestore({
                total_units: data.total_units,
                rate_per_unit: data.rate_per_unit,
                bill_type: data.bill_type,
                consumer_category: data.consumer_category,
                risk_level: data.risk_level,
                estimated_monthly_saving_units: data.estimated_monthly_saving_units,
                estimated_monthly_saving_rs: data.estimated_monthly_saving_rs,
                overall_summary: data.overall_summary,
                appliance_insights: data.appliance_insights,
                source: 'scan'
            });
        }

        if (data.rate_per_unit) {
            rateDisplay.textContent = `💰 Rate: Rs ${data.rate_per_unit}/unit | ${data.bill_type || 'Auto'} | ${data.consumer_category || 'N/A'}`;
            rateDisplay.classList.add("active");
        }

        scanChartInstance = renderChart("scanChart", data.breakdown, scanChartInstance);
        renderSummary(document.getElementById("scanSummary"), data);
        resultArea.classList.remove("hidden");

    } catch (e) {
        errorBox.textContent = `❌ ${e.message}`;
        errorBox.classList.remove("hidden");
    } finally {
        loading.classList.add("hidden");
    }
});

// ============================================================
// OPTION 3: MANUAL ENTRY
// ============================================================
document.getElementById("submitManualBtn").addEventListener("click", async () => {
    const loading = document.getElementById("manualLoading");
    const errorBox = document.getElementById("manualError");
    const resultArea = document.getElementById("manualResultArea");
    const rateDisplay = document.getElementById("manualRateDisplay");

    errorBox.classList.add("hidden");
    resultArea.classList.add("hidden");
    rateDisplay.classList.remove("active");

    const appliances = collectAppliances();
    if (!appliances.length) {
        errorBox.textContent = "❌ Kam az kam ek appliance ki tadad aur ghante bharein.";
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
            let message = `Server error (${res.status})`;
            try {
                const err = await res.json();
                message = err.detail || message;
            } catch (_) {}
            
            if (res.status === 400) {
                errorBox.textContent = "❌ Invalid appliance data. Please check watt, qty and hours.";
            } else if (res.status === 429 || res.status === 503) {
                errorBox.textContent = "⏳ AI service busy hai. 1-2 minute baad dobara try karein.";
            } else if (res.status === 500) {
                errorBox.textContent = "❌ AI service mein masla aaya. Please try again.";
            } else {
                errorBox.textContent = `❌ ${message}`;
            }
            errorBox.classList.remove("hidden");
            return;
        }

        const data = await res.json();

        if (currentUser) {
            await saveReportToFirestore({
                total_units: data.total_units,
                rate_per_unit: data.rate_per_unit,
                risk_level: data.risk_level,
                estimated_monthly_saving_units: data.estimated_monthly_saving_units,
                estimated_monthly_saving_rs: data.estimated_monthly_saving_rs,
                overall_summary: data.overall_summary,
                appliance_insights: data.appliance_insights,
                source: 'manual'
            });
        }

        if (data.rate_per_unit) {
            rateDisplay.textContent = `💰 Rate: Rs ${data.rate_per_unit}/unit`;
            rateDisplay.classList.add("active");
        }

        manualChartInstance = renderChart("manualChart", data.breakdown, manualChartInstance);
        renderSummary(document.getElementById("manualSummary"), data);
        resultArea.classList.remove("hidden");

    } catch (e) {
        errorBox.textContent = `❌ ${e.message}`;
        errorBox.classList.remove("hidden");
    } finally {
        loading.classList.add("hidden");
    }
});

// ============================================================
// CLEANUP
// ============================================================
window.addEventListener('beforeunload', () => {
    stopCamera();
});
