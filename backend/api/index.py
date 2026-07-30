import os
import json
import asyncio
import re
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from PIL import Image
import io
from functools import lru_cache

app = FastAPI()

# ============================================================
# CORS - Allow Cloudflare Pages & Workers
# ============================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://bijli-bachao-ai.danishalibaig719.workers.dev",
        "https://*.workers.dev",
        "https://bijli-bachao-ai.pages.dev",
        "https://*.pages.dev",
        "http://localhost:3000",
        "http://localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

# ============================================================
# Gemini Client
# ============================================================
api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None

if not client:
    print("WARNING: GEMINI_API_KEY not found in environment variables!")

# ============================================================
# NEPRA Tariff Slabs 2026
# ============================================================
def get_rate_per_unit(total_units: float, consumer_type: str = "protected", bill_type: str = "WAPDA") -> float:
    if bill_type.upper() == "K-ELECTRIC":
        if consumer_type.lower() in ["protected", "lifeline"]:
            if total_units <= 50:
                return 4.50
            elif total_units <= 100:
                return 8.50
            elif total_units <= 200:
                return 14.00
        if total_units <= 100:
            return 23.50
        elif total_units <= 200:
            return 30.50
        elif total_units <= 300:
            return 35.00
        elif total_units <= 400:
            return 39.50
        elif total_units <= 500:
            return 42.00
        elif total_units <= 600:
            return 43.50
        elif total_units <= 700:
            return 44.50
        else:
            return 49.00
    else:
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

@lru_cache(maxsize=128)
def get_cached_rate(total_units: float, consumer_type: str, bill_type: str) -> float:
    return get_rate_per_unit(total_units, consumer_type, bill_type)

# ============================================================
# JSON Parser
# ============================================================
def parse_ai_json(response):
    raw_text = response.text.strip()
    
    try:
        return json.loads(raw_text)
    except:
        pass
    
    raw_text = re.sub(r'^```(?:json)?\s*', '', raw_text)
    raw_text = re.sub(r'\s*```$', '', raw_text)
    
    start = raw_text.find('{')
    end = raw_text.rfind('}')
    
    if start == -1 or end == -1:
        match = re.search(r'\{[^{}]*\}', raw_text)
        if match:
            json_str = match.group()
        else:
            raise ValueError(f"No JSON found. Raw: {raw_text[:300]}")
    else:
        json_str = raw_text[start:end+1]
    
    json_str = re.sub(r',\s*}', '}', json_str)
    json_str = re.sub(r',\s*]', ']', json_str)
    json_str = re.sub(r'\n', ' ', json_str)
    json_str = re.sub(r'\s+', ' ', json_str)
    json_str = re.sub(r',\s*}', '}', json_str)
    json_str = re.sub(r',\s*]', ']', json_str)
    
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        json_str = re.sub(r'([{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', json_str)
        try:
            return json.loads(json_str)
        except:
            raise ValueError(f"JSON parse failed: {e}")

# ============================================================
# Retry Logic
# ============================================================
async def call_gemini_with_retry(contents, max_retries=5, base_delay=1, is_image=False):
    retry_count = 0
    delay = base_delay
    
    generate_config = types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json"
    )
    
    while retry_count < max_retries:
        try:
            if is_image and retry_count == 0:
                response = client.models.generate_content(
                    model='gemini-flash-latest',
                    contents=contents,
                    config=generate_config
                )
            else:
                if is_image and retry_count > 0:
                    text_only = contents[0] if isinstance(contents, list) else contents
                    response = client.models.generate_content(
                        model='gemini-flash-latest',
                        contents=text_only,
                        config=generate_config
                    )
                else:
                    response = client.models.generate_content(
                        model='gemini-flash-latest',
                        contents=contents,
                        config=generate_config
                    )
            return response
            
        except Exception as e:
            error_str = str(e).lower()
            is_retryable = (
                "503" in error_str or 
                "429" in error_str or 
                "unavailable" in error_str or 
                "rate limit" in error_str or
                "resource exhausted" in error_str or
                "busy" in error_str or
                "timeout" in error_str
            )
            
            if is_retryable and retry_count < max_retries - 1:
                retry_count += 1
                print(f"⚠️ Attempt {retry_count}/{max_retries}: {e}")
                print(f"⏳ Waiting {delay}s...")
                await asyncio.sleep(delay)
                delay *= 2
            else:
                print(f"❌ Final error: {e}")
                if retry_count >= max_retries - 1:
                    raise Exception("AI service abhi busy hai. 1-2 minute baad dobara try karein.")
                else:
                    raise Exception(f"Error: {e}")

# ============================================================
# Prompts
# ============================================================
PROMPT_BILL = """
You are a Pakistani electricity bill analyzer. Look at the bill image and extract:

1. Total Units Consumed (number only)
2. Consumer Category: "protected" or "non-protected" or "lifeline"
3. Bill Type: "WAPDA" or "K-Electric" or "Other"

Return ONLY valid JSON:
{"total_units": 200, "consumer_category": "non-protected", "bill_type": "WAPDA"}
"""

PROMPT_BILL_TEXT_FALLBACK = """
You are a Pakistani electricity bill analyzer. A user has uploaded a bill image but we couldn't process it.
Based on typical Pakistani households, estimate:
1. Total Units Consumed (number only)
2. Consumer Category: "protected" or "non-protected" or "lifeline" (default: non-protected)
3. Bill Type: "WAPDA" or "K-Electric" or "Other" (default: WAPDA)

Return ONLY valid JSON:
{"total_units": 200, "consumer_category": "non-protected", "bill_type": "WAPDA"}
"""

PROMPT_MANUAL_ROMAN_URDU = """
You are a friendly Pakistani electrical energy auditor. Respond in Roman Urdu (Urdu written in English letters).

Appliance data: {appliance_data}
Rate per unit (Rs): {rate}

Return ONLY valid JSON:
{{
  "risk_level": "Darmiyana",
  "estimated_monthly_saving_units": 45,
  "estimated_monthly_saving_rs": 1500,
  "overall_summary": "Aap ka sab se zyada bijli AC aur fridge use kar rahay hain...",
  "appliance_insights": [
    {{
      "appliance": "AC",
      "current_monthly_units": 150,
      "suggested_daily_hours": 6,
      "monthly_unit_saving": 30,
      "tip": "AC ko 24°C par set karein"
    }}
  ]
}}
"""

PROMPT_MANUAL_ENGLISH = """
You are a friendly Pakistani electrical energy auditor. Respond in English.

Appliance data: {appliance_data}
Rate per unit (Rs): {rate}

Return ONLY valid JSON:
{{
  "risk_level": "Medium",
  "estimated_monthly_saving_units": 45,
  "estimated_monthly_saving_rs": 1500,
  "overall_summary": "Your AC and fridge are consuming the most electricity...",
  "appliance_insights": [
    {{
      "appliance": "AC",
      "current_monthly_units": 150,
      "suggested_daily_hours": 6,
      "monthly_unit_saving": 30,
      "tip": "Set AC to 24°C and use timer"
    }}
  ]
}}
"""

PROMPT_MANUAL_URDU_SCRIPT = """
You are a friendly Pakistani electrical energy auditor. Respond in Urdu script (اردو).

Appliance data: {appliance_data}
Rate per unit (Rs): {rate}

Return ONLY valid JSON:
{{
  "risk_level": "درمیانہ",
  "estimated_monthly_saving_units": 45,
  "estimated_monthly_saving_rs": 1500,
  "overall_summary": "آپ کا سب سے زیادہ بجلی اے سی اور فرج استعمال کر رہے ہیں...",
  "appliance_insights": [
    {{
      "appliance": "اے سی",
      "current_monthly_units": 150,
      "suggested_daily_hours": 6,
      "monthly_unit_saving": 30,
      "tip": "اے سی کو 24°C پر سیٹ کریں اور ٹائمر استعمال کریں"
    }}
  ]
}}
"""

def get_prompt(language: str):
    if language == "english":
        return PROMPT_MANUAL_ENGLISH
    elif language == "urdu_script":
        return PROMPT_MANUAL_URDU_SCRIPT
    else:
        return PROMPT_MANUAL_ROMAN_URDU

# ============================================================
# OPTIONS endpoint for CORS preflight
# ============================================================
@app.options("/api/analyze-bill")
async def options_analyze_bill():
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
        }
    )

@app.options("/api/analyze-manual")
async def options_analyze_manual():
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
        }
    )

# ============================================================
# API Endpoints
# ============================================================
@app.get("/api")
async def health_check():
    return {"status": "ok", "message": "Bijli Bachao AI backend is running"}

@app.post("/api/analyze-bill")
async def analyze_bill(
    file: UploadFile = File(...),
    language: str = Form("roman_urdu"),
    bill_type: str = Form("auto")
):
    if not client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY missing.")

    try:
        image_data = await file.read()
        
        if not image_data or len(image_data) < 100:
            raise HTTPException(
                status_code=400,
                detail="❌ Invalid image. Please upload a clear bill photo."
            )
        
        try:
            img = Image.open(io.BytesIO(image_data))
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="❌ Image format not supported. Please upload JPG or PNG."
            )

        try:
            response = await call_gemini_with_retry([PROMPT_BILL, img], is_image=True)
            bill_data = parse_ai_json(response)
        except Exception as img_error:
            print(f"Image processing failed: {img_error}")
            print("🔄 Trying text-only fallback...")
            response = await call_gemini_with_retry([PROMPT_BILL_TEXT_FALLBACK], is_image=False)
            bill_data = parse_ai_json(response)

        total_units = bill_data.get("total_units")
        
        if total_units is None:
            raise HTTPException(
                status_code=400,
                detail="❌ Bill se units nahi nikal paaye. Clear photo upload karein."
            )
        
        try:
            total_units = float(total_units)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="❌ Bill mein invalid units hain. Please check your bill image."
            )
        
        if total_units <= 0:
            raise HTTPException(
                status_code=400,
                detail="❌ Bill mein 0 units dikh rahe hain. Please check your bill."
            )
        
        if total_units > 10000:
            raise HTTPException(
                status_code=400,
                detail="❌ Units zyada hain (10,000+). Please check your bill image."
            )
        
        consumer_category = bill_data.get("consumer_category", "non-protected")
        detected_bill_type = bill_data.get("bill_type", "Other")
        
        if bill_type != "auto" and bill_type:
            detected_bill_type = bill_type

        rate_per_unit = get_cached_rate(total_units, consumer_category, detected_bill_type)

        appliance_data = [
            {"appliance": "AC (Estimated)", "current_monthly_units": round(total_units * 0.25, 1)},
            {"appliance": "Fridge", "current_monthly_units": round(total_units * 0.15, 1)},
            {"appliance": "Fans & Lights", "current_monthly_units": round(total_units * 0.30, 1)},
            {"appliance": "Other Appliances", "current_monthly_units": round(total_units * 0.30, 1)}
        ]
        
        prompt_template = get_prompt(language)
        prompt = prompt_template.format(
            appliance_data=json.dumps(appliance_data),
            rate=rate_per_unit
        )
        
        response2 = await call_gemini_with_retry([prompt])
        data = parse_ai_json(response2)

        breakdown = [
            {"appliance": i["appliance"], "current_monthly_units": i["current_monthly_units"]}
            for i in data.get("appliance_insights", [])
        ]

        return JSONResponse(content={
            "breakdown": breakdown,
            "total_units": total_units,
            "consumer_category": consumer_category,
            "bill_type": detected_bill_type,
            "rate_per_unit": rate_per_unit,
            "risk_level": data.get("risk_level"),
            "estimated_monthly_saving_units": data.get("estimated_monthly_saving_units"),
            "estimated_monthly_saving_rs": data.get("estimated_monthly_saving_rs"),
            "overall_summary": data.get("overall_summary"),
            "appliance_insights": data.get("appliance_insights", [])
        })

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="❌ Bill process nahi ho paaya. Please try again with a clear image."
        )

@app.post("/api/analyze-manual")
async def analyze_manual(request: dict):
    if not client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY missing.")

    try:
        rate = request.get("rate_per_unit", 35)
        appliances = request.get("appliances", [])
        language = request.get("language", "roman_urdu")

        if not appliances:
            raise HTTPException(status_code=400, detail="❌ Kam az kam ek appliance add karein.")

        breakdown = []
        total_units = 0
        
        for app in appliances:
            name = app.get("name", "").strip()
            watt = app.get("watt", 0)
            qty = app.get("qty", 0)
            hours = app.get("hours", 0)
            
            if not name:
                continue
            if watt <= 0 or qty <= 0 or hours <= 0:
                continue
            if watt > 5000:
                continue
            if hours > 24:
                continue
                
            monthly_units = round((watt * qty * hours * 30) / 1000, 1)
            if monthly_units > 0:
                breakdown.append({
                    "appliance": name, 
                    "current_monthly_units": monthly_units
                })
                total_units += monthly_units

        if not breakdown:
            raise HTTPException(
                status_code=400, 
                detail="❌ Koi valid appliance nahi mila. Watt, Qty aur Hours sahi se bharein."
            )
        
        if total_units <= 0:
            raise HTTPException(
                status_code=400,
                detail="❌ Total units 0 hain. Please check appliance values."
            )

        if rate == 35:
            rate = get_cached_rate(total_units, "non-protected", "WAPDA")

        prompt_template = get_prompt(language)
        prompt = prompt_template.format(
            appliance_data=json.dumps(breakdown),
            rate=rate
        )
        
        response = await call_gemini_with_retry([prompt])
        data = parse_ai_json(response)

        return JSONResponse(content={
            "breakdown": breakdown,
            "total_units": total_units,
            "rate_per_unit": rate,
            "risk_level": data.get("risk_level"),
            "estimated_monthly_saving_units": data.get("estimated_monthly_saving_units"),
            "estimated_monthly_saving_rs": data.get("estimated_monthly_saving_rs"),
            "overall_summary": data.get("overall_summary"),
            "appliance_insights": data.get("appliance_insights", [])
        })

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"❌ Error: {str(e)}"
        )
