import os
import json
import asyncio
import re
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from PIL import Image
import io

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None

if not client:
    print("WARNING: GEMINI_API_KEY not found in environment variables!")

# --- NEPRA Tariff Slabs 2026 (Domestic) ---
def get_rate_per_unit(total_units: float, consumer_type: str = "protected") -> float:
    if consumer_type.lower() in ["protected", "lifeline"]:
        if total_units <= 50:
            return 3.95
        elif total_units <= 100:
            return 7.74
        elif total_units <= 200:
            return 13.01
    if total_units <= 100:
        return 22.44
    elif total_units <= 200:
        return 28.91
    elif total_units <= 300:
        return 33.10
    elif total_units <= 400:
        return 37.99
    elif total_units <= 500:
        return 40.22
    elif total_units <= 600:
        return 41.62
    elif total_units <= 700:
        return 42.76
    else:
        return 47.69

# --- IMPROVED: Robust JSON parser ---
def parse_ai_json(response):
    raw_text = response.text.strip()
    
    # Remove markdown code fences if present
    raw_text = re.sub(r'^```(?:json)?\s*', '', raw_text)
    raw_text = re.sub(r'\s*```$', '', raw_text)
    
    # Find the first { and last } to extract only JSON
    start = raw_text.find('{')
    end = raw_text.rfind('}')
    
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found in response. Raw: {raw_text[:200]}")
    
    json_str = raw_text[start:end+1]
    
    # Remove any trailing commas before closing braces (common Gemini issue)
    json_str = re.sub(r',\s*}', '}', json_str)
    json_str = re.sub(r',\s*]', ']', json_str)
    
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        # If still failing, try to fix by removing extra spaces and newlines
        cleaned = re.sub(r'\s+', ' ', json_str)
        try:
            return json.loads(cleaned)
        except:
            raise ValueError(f"JSON parse error: {e}\nCleaned: {json_str[:300]}")

# --- Retry Logic ---
async def call_gemini_with_retry(contents, max_retries=3):
    retry_count = 0
    delay = 1
    while retry_count < max_retries:
        try:
            response = client.models.generate_content(
                model='gemini-flash-latest',
                contents=contents
            )
            return response
        except Exception as e:
            error_str = str(e).lower()
            is_retryable = "503" in error_str or "429" in error_str or "unavailable" in error_str or "rate limit" in error_str
            if is_retryable:
                retry_count += 1
                if retry_count < max_retries:
                    print(f"Retry {retry_count}/{max_retries}: {e}")
                    await asyncio.sleep(delay * retry_count)
                else:
                    raise Exception("AI service abhi busy hai. 1-2 minute baad dobara try karein.") from e
            else:
                raise Exception(f"AI service mein masla aaya: {e}") from e

# --- Prompts ---
PROMPT_BILL = """
You are a Pakistani electricity bill analyzer. Look at the bill image and extract:

1. Total Units Consumed (number only)
2. Consumer Category: "protected" or "non-protected" or "lifeline" — determine from bill text if mentioned, otherwise default to "non-protected"
3. Bill Type: "WAPDA" or "K-Electric" or "Other"

Return STRICT JSON ONLY, no extra text, no markdown:

{
  "total_units": 200,
  "consumer_category": "non-protected",
  "bill_type": "WAPDA"
}
"""

PROMPT_MANUAL = """
You are a friendly Pakistani electrical energy auditor. Respond STRICTLY in Roman Urdu.

You are given the user's ACTUAL per-appliance monthly consumption breakdown.
Appliance data (JSON): {appliance_data}
Rate per unit (Rs): {rate}

Return STRICT JSON ONLY, no markdown, no extra text:

{
  "risk_level": "Darmiyana",
  "estimated_monthly_saving_units": 45,
  "estimated_monthly_saving_rs": 1500,
  "overall_summary_roman_urdu": "Aap ka sab se zyada bijli AC aur fridge use kar rahay hain...",
  "appliance_insights": [
    {
      "appliance": "AC (1.5 Ton Split)",
      "current_monthly_units": 150,
      "suggested_daily_hours": 6,
      "monthly_unit_saving": 30,
      "tip_roman_urdu": "AC ko 24°C par set karein aur timer use karein"
    }
  ]
}
"""

# --- Endpoints ---

@app.get("/api")
async def health_check():
    return {"status": "ok", "message": "Bijli Bachao AI backend is running"}

@app.post("/api/analyze-bill")
async def analyze_bill(file: UploadFile = File(...)):
    if not client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY missing.")

    try:
        image_data = await file.read()
        img = Image.open(io.BytesIO(image_data))

        # Step 1: Extract bill info
        response = await call_gemini_with_retry([PROMPT_BILL, img])
        bill_data = parse_ai_json(response)

        total_units = bill_data.get("total_units", 0)
        consumer_category = bill_data.get("consumer_category", "non-protected")
        bill_type = bill_data.get("bill_type", "Other")

        if total_units <= 0:
            raise Exception("Bill se units nahi nikal paaye. Dobara try karein.")

        # Step 2: Calculate actual rate
        rate_per_unit = get_rate_per_unit(total_units, consumer_category)

        # Step 3: Estimate appliance breakdown
        appliance_data = [
            {"appliance": "AC (Estimated)", "current_monthly_units": round(total_units * 0.25, 1)},
            {"appliance": "Fridge", "current_monthly_units": round(total_units * 0.15, 1)},
            {"appliance": "Fans & Lights", "current_monthly_units": round(total_units * 0.30, 1)},
            {"appliance": "Other Appliances", "current_monthly_units": round(total_units * 0.30, 1)}
        ]
        
        prompt = PROMPT_MANUAL.format(
            appliance_data=json.dumps(appliance_data),
            rate=rate_per_unit
        )
        response2 = await call_gemini_with_retry([prompt])
        data = parse_ai_json(response2)

        breakdown = [
            {"appliance": i["appliance"], "current_monthly_units": i["current_monthly_units"]}
            for i in data.get("appliance_insights", [])
        ]

        return {
            "breakdown": breakdown,
            "total_units": total_units,
            "consumer_category": consumer_category,
            "bill_type": bill_type,
            "rate_per_unit": rate_per_unit,
            "risk_level": data.get("risk_level"),
            "estimated_monthly_saving_units": data.get("estimated_monthly_saving_units"),
            "estimated_monthly_saving_rs": data.get("estimated_monthly_saving_rs"),
            "overall_summary_roman_urdu": data.get("overall_summary_roman_urdu"),
            "appliance_insights": data.get("appliance_insights", [])
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze-manual")
async def analyze_manual(request: dict):
    if not client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY missing.")

    try:
        rate = request.get("rate_per_unit", 35)
        appliances = request.get("appliances", [])

        if not appliances:
            raise HTTPException(status_code=400, detail="No appliances provided.")

        # Deterministic calculation
        breakdown = []
        total_units = 0
        for app in appliances:
            watt = app.get("watt", 0)
            qty = app.get("qty", 0)
            hours = app.get("hours", 0)
            if watt > 0 and qty > 0 and hours > 0:
                monthly_units = round((watt * qty * hours * 30) / 1000, 1)
                breakdown.append({"appliance": app.get("name"), "current_monthly_units": monthly_units})
                total_units += monthly_units

        if not breakdown:
            raise HTTPException(status_code=400, detail="No valid appliances.")

        # Auto-calculate rate if user didn't change default
        if rate == 35:
            rate = get_rate_per_unit(total_units, "non-protected")

        prompt = PROMPT_MANUAL.format(
            appliance_data=json.dumps(breakdown),
            rate=rate
        )
        response = await call_gemini_with_retry([prompt])
        data = parse_ai_json(response)

        return {
            "breakdown": breakdown,
            "total_units": total_units,
            "rate_per_unit": rate,
            "risk_level": data.get("risk_level"),
            "estimated_monthly_saving_units": data.get("estimated_monthly_saving_units"),
            "estimated_monthly_saving_rs": data.get("estimated_monthly_saving_rs"),
            "overall_summary_roman_urdu": data.get("overall_summary_roman_urdu"),
            "appliance_insights": data.get("appliance_insights", [])
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
