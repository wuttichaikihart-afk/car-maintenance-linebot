const carDatabase = {
    "Toyota": ["Yaris", "Vios", "Corolla Altis", "Camry", "Hilux Revo", "Fortuner", "Corolla Cross", "C-HR", "Veloz", "Alphard"],
    "Honda": ["City", "Civic", "Accord", "HR-V", "CR-V", "BR-V", "WR-V", "Brio"],
    "Isuzu": ["D-Max", "MU-X"],
    "Mitsubishi": ["Mirage", "Attrage", "Xpander", "Triton", "Pajero Sport", "Outlander"],
    "Nissan": ["Almera", "Kicks e-POWER", "Terra", "Navara", "Leaf"],
    "Mazda": ["Mazda2", "Mazda3", "CX-3", "CX-30", "CX-5", "CX-8", "BT-50"],
    "Ford": ["Ranger", "Everest", "Mustang"],
    "MG": ["MG3", "MG5", "MG ZS", "MG HS", "MG EP", "MG4", "MG Maxus 9"],
    "Suzuki": ["Swift", "Celerio", "Ciaz", "Ertiga", "XL7"],
    "BYD": ["Dolphin", "Atto 3", "Seal"],
    "GWM": ["Haval H6", "Haval Jolion", "ORA Good Cat"]
};

// LIFF ID will be injected or set manually
// For local testing, we skip LIFF init if not provided
const LIFF_ID = "YOUR_LIFF_ID"; // User will need to replace this or we inject it

document.addEventListener("DOMContentLoaded", () => {
    const brandSelect = document.getElementById("brand");
    const modelSelect = document.getElementById("model");
    
    // Populate Brands
    Object.keys(carDatabase).sort().forEach(brand => {
        const option = document.createElement("option");
        option.value = brand;
        option.textContent = brand;
        brandSelect.appendChild(option);
    });

    // Handle Brand Change
    brandSelect.addEventListener("change", (e) => {
        const selectedBrand = e.target.value;
        const models = carDatabase[selectedBrand] || [];
        
        // Reset Model Select
        modelSelect.innerHTML = '<option value="" disabled selected>เลือกรุ่นรถยนต์</option>';
        
        if (models.length > 0) {
            modelSelect.disabled = false;
            models.sort().forEach(model => {
                const option = document.createElement("option");
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
        } else {
            modelSelect.disabled = true;
        }
    });

    // Initialize LIFF
    initializeLiff();
});

let userLineId = "";

async function initializeLiff() {
    try {
        if (!LIFF_ID || LIFF_ID === "YOUR_LIFF_ID") {
            // For development without LIFF ID
            console.warn("No LIFF ID provided. Running in standalone mode.");
            showApp("Dev User", "U1234567890abcdef");
            return;
        }

        await liff.init({ liffId: LIFF_ID });
        
        if (!liff.isLoggedIn()) {
            liff.login();
            return;
        }

        const profile = await liff.getProfile();
        userLineId = profile.userId;
        
        if (profile.pictureUrl) {
            document.getElementById('profile-pic').style.backgroundImage = `url(${profile.pictureUrl})`;
        }
        
        showApp(profile.displayName, userLineId);

    } catch (err) {
        console.error('LIFF Initialization failed', err);
        showApp("Guest", "UNKNOWN");
    }
}

function showApp(userName, lineId) {
    userLineId = lineId;
    document.getElementById("user-name").textContent = userName;
    document.getElementById("loading-screen").style.display = "none";
    document.getElementById("app-container").style.display = "block";
}

// Handle Form Submission
document.getElementById('registration-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const brand = document.getElementById('brand').value;
    const model = document.getElementById('model').value;
    const licensePlate = document.getElementById('licensePlate').value;
    const currentMileage = document.getElementById('currentMileage').value;
    
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        // Prepare data
        const payload = {
            lineId: userLineId,
            brand,
            model,
            licensePlate,
            currentMileage: parseInt(currentMileage, 10)
        };

        // Call Netlify Function API
        const response = await fetch('/.netlify/functions/api-register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        // Success - Close LIFF window
        if (liff.isInClient()) {
            liff.closeWindow();
        } else {
            alert('ลงทะเบียนสำเร็จ! คุณสามารถปิดหน้านี้และกลับไปที่แอป LINE ได้เลยครับ');
        }

    } catch (error) {
        console.error('Registration failed:', error);
        alert('เกิดข้อผิดพลาดในการลงทะเบียน โปรดลองใหม่อีกครั้ง');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});
