import os
import json
import asyncio
import time
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from PIL import Image
import io

app = FastAPI()

# Allow CORS for all origins (for development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Gemini API Configuration
api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None

# Log for debugging (visible in Vercel logs)
if not client:
    print("WARNING: GEMINI_API_KEY not found in environment variables!")

# --- Retry Logic for Gemini API calls ---
async def call_gemini_with_retry(contents, max_retries=3):
    """
    Calls Gemini API with retry logic for 503 (overloaded) and 429 (rate limit) errors.
    """
    retry_count = 0
    delay = 1  # seconds
    
    while retry_count < max_retries:
        try:
            response = client.models.generate_content(
                model='gemini-flash-latest',
                contents=contents
            )
            # If successful, return the response
            return response
        except Exception as e:
            # Check if it's a rate limit or server overload error
            error_str = str(e).lower()
            is_503 = "503" in error_str or "unavailable" in error_str
            is_429 = "429" in error_str or "rate limit" in error_str or "resource exhausted" in error_str
            
            if is_503 or is_429:
                retry_count += 1
                if retry_count < max_retries:
                    print(f"Gemini API error (retry {retry_count}/{max_retries}): {e}")
                    await asyncio.sleep(delay * retry_count)  # Exponential backoff: 1s, 2s, 3s
                else:
                    print(f"Gemini API error, max retries reached: {e}")
                    # Last retry failed, raise a user-friendly error
                    raise Exception("AI service abhi busy hai. 1-2 minute baad dobara try karein.") from e
            else:
                # Other errors (e.g., 404, 500 from Gemini) - raise immediately
                print(f"Gemini API fatal error: {e}")
                raise Exception(f"AI service mein masla aaya: {e}") from e

# --- Helper to create the structured prompt for Gemini ---
PROMPT_TEMPLATE_MANUAL = """
You are a friendly Pakistani electrical energy auditor. Respond STRICTLY in Roman Urdu
(Urdu written in English letters) — no English sentences, no Urdu script, no markdown fences.

You are given the user's ACTUAL per-appliance monthly consumption breakdown, already
calculated from their real usage (watt x quantity x hours/day x 30). Use these EXACT
numbers — do not invent new ones. Only include appliances with current_monthly_units > 0.

Appliance data (JSON): {appliance_data}
Rate per unit (Rs): {rate}

Return STRICT JSON ONLY, in this exact schema:
{{
  "risk_level": "<Kam ya Darmiyana ya Zyada>",
  "estimated_monthly_saving_units": <number>,
  "estimated_monthly_saving_rs": <number>,
  "overall_summary_roman_urdu": "<2-3 line summary, biggest contributor appliance ka naam lein>",
  "appliance_insights": [
    {{
      "appliance": "<exact name from input>",
      "current_monthly_units": <number>,
      "suggested_daily_hours": <number>,
      "monthly_unit_saving": <number>,
      "tip_roman_urdu": "<specific action, under 20 words>"
    }}
  ]
}}
"""

PROMPT_TEMPLATE_BILL = """
You are a friendly Pakistani electrical energy auditor. Respond STRICTLY in Roman Urdu
(Urdu written in English letters) — no English, no Urdu script, no markdown fences.

Look at the attached electricity bill image and extract the total Units Consumed.
Since you don't have the user's real appliance list, ESTIMATE a realistic appliance-wise
breakdown for a typical Pakistani household that would add up close to the total bill
units (AC, Fridge, Fans, Lights, Motor, Iron, TV etc — only include plausible ones,
skip appliances that would not realistically apply). Clearly this is an estimate.

Return STRICT JSON ONLY, in this exact schema:
{{
  "extracted_bill_units": <number>,
  "risk_level": "<Kam ya Darmiyana ya Zyada>",
  "estimated_monthly_saving_units": <number>,
  "estimated_monthly_saving_rs": <number>,
  "overall_summary_roman_urdu": "<2-3 line summary, mention ke yeh andaza hai>",
  "appliance_insights": [
    {{
      "appliance": "<name>",
      "current_monthly_units": <estimated number>,
      "suggested_daily_hours": <number>,
      "monthly_unit_saving": <number>,
      "tip_roman_urdu": "<specific action, under 20 words>"
    }}
  ]
}}
Rate per unit assumption (Rs): {rate}
"""

# --- Helper to parse JSON from Gemini's response (which might include markdown) ---
def parse_ai_json(response):
    raw_text = response.text.strip()
    if raw_text.startswith("```"):
        raw_text = raw_text.strip("`")
        if raw_text.lower().startswith("json"):
            raw_text = raw_text[4:]
    return json.loads(raw_text)

# --- API Endpoints ---

@app.get("/api")
async def health_check():
    return {"status": "ok", "message": "Bijli Bachao AI backend is running"}

@app.post("/api/analyze-bill")
async def analyze_bill(file: UploadFile = File(...), rate_per_unit: float = Form(35)):
    if not client:
        raise HTTPException(status_code=500, detail="API Key missing. Please set GEMINI_API_KEY.")
    
    try:
        # Read and process image
        image_data = await file.read()
        img = Image.open(io.BytesIO(image_data))
        
        # Prepare prompt
        prompt = PROMPT_TEMPLATE_BILL.format(rate=rate_per_unit)
        
        # Call Gemini with retry
        response = await call_gemini_with_retry([prompt, img])
        data = parse_ai_json(response)
        
        # Structure the response for frontend
        breakdown = []
        for item in data.get("appliance_insights", []):
            breakdown.append({
                "appliance": item.get("appliance"),
                "current_monthly_units": item.get("current_monthly_units", 0)
            })
        
        return {
            "breakdown": breakdown,
            "extracted_bill_units": data.get("extracted_bill_units"),
            "risk_level": data.get("risk_level"),
            "estimated_monthly_saving_units": data.get("estimated_monthly_saving_units"),
            "estimated_monthly_saving_rs": data.get("estimated_monthly_saving_rs"),
            "overall_summary_roman_urdu": data.get("overall_summary_roman_urdu"),
            "appliance_insights": data.get("appliance_insights", [])
        }
    
    except Exception as e:
        print(f"Error in analyze_bill: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze-manual")
async def analyze_manual(request: dict):
    if not client:
        raise HTTPException(status_code=500, detail="API Key missing. Please set GEMINI_API_KEY.")
    
    try:
        rate = request.get("rate_per_unit", 35)
        appliances = request.get("appliances", [])
        
        if not appliances:
            raise HTTPException(status_code=400, detail="No appliances provided.")
        
        # Deterministic calculation (no AI)
        breakdown = []
        for app in appliances:
            watt = app.get("watt", 0)
            qty = app.get("qty", 0)
            hours = app.get("hours", 0)
            if watt > 0 and qty > 0 and hours > 0:
                monthly_units = round((watt * qty * hours * 30) / 1000, 1)
                breakdown.append({
                    "appliance": app.get("name"),
                    "current_monthly_units": monthly_units
                })
        
        if not breakdown:
            raise HTTPException(status_code=400, detail="No valid appliances with positive units.")
        
        # Prepare prompt for Gemini with exact numbers
        prompt = PROMPT_TEMPLATE_MANUAL.format(
            appliance_data=json.dumps(breakdown),
            rate=rate
        )
        
        # Call Gemini with retry
        response = await call_gemini_with_retry([prompt])
        data = parse_ai_json(response)
        
        return {
            "breakdown": breakdown,
            "risk_level": data.get("risk_level"),
            "estimated_monthly_saving_units": data.get("estimated_monthly_saving_units"),
            "estimated_monthly_saving_rs": data.get("estimated_monthly_saving_rs"),
            "overall_summary_roman_urdu": data.get("overall_summary_roman_urdu"),
            "appliance_insights": data.get("appliance_insights", [])
        }
    
    except Exception as e:
        print(f"Error in analyze_manual: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
