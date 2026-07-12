# ⚡ Bijli Bachao AI — Deployment Guide (v2, Vercel-only)

**Kya badla:** Ab backend aur frontend **dono ek hi Vercel project** mein hain — koi
alag Render/HF backend nahi chahiye. Vercel ka free "Hobby" plan bilkul card-free hai
aur Python serverless functions support karta hai.

---

## STEP 1: GitHub Repository

1. https://github.com par account banao (agar nahi hai).
2. Naya repo banao: `bijli-bachao-ai`
3. Is poori `bijli-bachao-v2` folder ka content us repo mein push karo.

---

## STEP 2: Vercel Par Deploy Karo (Free, No Card)

1. https://vercel.com par "Sign up with GitHub" se account banao.
2. Dashboard → **"Add New" → "Project"** → apna `bijli-bachao-ai` repo select karo.
3. Framework Preset: **"Other"** rakho (Vercel `api/` folder ko khud detect kar lega
   Python function ke tor par).
4. **Environment Variables** section mein add karo:
   - Key: `GEMINI_API_KEY`
   - Value: apni Gemini API key
5. "Deploy" dabao. 1-2 minute mein live ho jayega.
6. URL milega jaisa: `https://bijli-bachao-ai.vercel.app`

Bas! Backend (`api/index.py`) aur frontend (`index.html` etc.) dono isi ek URL par
live ho jayenge — koi CORS masla nahi, koi alag URL yaad rakhne ki zaroorat nahi.

**Test karo:** `https://bijli-bachao-ai.vercel.app/api` kholo — `{"status":"ok"}`
dikhna chahiye. Phir main URL kholo aur dono tabs try karo.

---

## STEP 3: Android "App" — PWA Install (100% Free)

1. Apna Vercel URL Android Chrome mein kholo.
2. 3-dot menu → **"Add to Home Screen"**.
3. App icon phone par aa jayega, bina Play Store ke.

⚠️ Icon files (`icon-192.png`, `icon-512.png`) khud add karna mat bhoolna repo mein
(koi bhi free logo maker se bana lo), warna PWA install prompt sahi se kaam nahi karega.

---

## STEP 4: Firebase — Login + History (Optional, Free)

Agar user login aur bill history chahiye:

1. Firebase Console mein project banao, Authentication (Email/Password) aur
   Firestore enable karo.
2. `firebase/firestore.rules` file ko Firebase Console → Firestore → Rules mein paste
   karo — **yeh zaroori hai**, warna data publicly exposed rahega.
3. Apne `index.html` mein Firebase SDK aur config add karo (Firebase Console se
   "Add app → Web" karke config milega).

---

## Vercel Free Tier Ki Limits (Honest Note)

- Serverless function ka default execution timeout ~10 second hai Hobby plan par.
  Gemini Flash usually 2-4 second mein respond karta hai, isliye normal use mein
  masla nahi hoga — lekin bohot badi image ya slow network par kabhi kabhi timeout
  ho sakta hai.
- Koi "sleep" wala masla nahi hai (Render jaisa) — Vercel serverless functions
  on-demand chalte hain, cold start bhi bohot chhota hota hai.

---

## Troubleshooting

- **404 on /api calls:** `vercel.json` file root mein honi chahiye, aur `api/index.py`
  mein routes `/api/...` se start hone chahiye (jaisa code mein hai).
- **500 error:** Environment variable `GEMINI_API_KEY` Vercel dashboard mein set hai,
  confirm karo (Settings → Environment Variables), phir redeploy karo.
- **PWA install nahi ho raha:** Chrome use karo, aur icon files add karna na bhoolo.
