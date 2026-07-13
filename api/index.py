import os
import json
import time
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List
from PIL import Image
import io
from google import genai

# ------------------------------------------------------------------
# 1. Setup
# ------------------------------------------------------------------
api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None

app = FastAPI(title="Bijli Bachao AI API")


# ------------------------------------------------------------------
# 2. Data models
# ------------------------------------------------------------------
class Appliance(BaseModel):
    name: str
    watt: float
    qty: float
    hours: float


class ManualRequest(BaseModel):
    rate_per_unit: float = 35
    appliances: List[Appliance]


# ------------------------------------------------------------------
# 3. Prompts (Roman Urdu output)
# ------------------------------------------------------------------
PROMPT_MANUAL = """
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

PROMPT_BILL_ONLY = """
You are a friendly Pakistani electrical energy auditor. Respond STRICTLY in Roman Urdu
(Urdu written in English letters) — no English, no Urdu script, no markdown fences.

Look at the attached electricity bill image and extract the total Units Consumed.
Since you don't have the user's real appliance list, ESTIMATE a realistic appliance-wise
breakdown for a typical Pakistani household that would add up close to the total bill
units (AC, Fridge, Fans, Lights, Motor, Iron, TV etc — only include plausible ones).
Clearly this is an estimate.

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


# ------------------------------------------------------------------
# 4. Helpers
# ------------------------------------------------------------------
def compute_appliance_units(appliances: List[Appliance]):
    breakdown = []
    for a in appliances:
        if a.qty <= 0 or a.hours <= 0 or a.watt <= 0 or not a.name:
            continue
        monthly_units = round((a.watt * a.qty * a.hours * 30) / 1000, 1)
        if monthly_units > 0:
            breakdown.append({"appliance": a.name, "current_monthly_units": monthly_units})
    return breakdown


def parse_ai_json(response_text: str):
    raw_text = response_text.strip()
    if raw_text.startswith("```"):
        raw_text = raw_text.strip("`")
        if raw_text.lower().startswith("json"):
            raw_text = raw_text[4:]
    return json.loads(raw_text)


def ensure_client():
    if not client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured on server.")


def call_gemini_with_retry(contents, retries: int = 3, base_delay: float = 2.0):
    """
    Calls Gemini, automatically retrying if the model is temporarily
    overloaded (503 / UNAVAILABLE). Uses simple exponential backoff.
    Raises the last error if all retries are exhausted.
    """
    last_error = None
    for attempt in range(retries + 1):
        try:
            return client.models.generate_content(
                model="gemini-flash-latest",
                contents=contents
            )
        except Exception as e:
            last_error = e
            error_text = str(e)
            is_overloaded = "503" in error_text or "UNAVAILABLE" in error_text or "overloaded" in error_text.lower()
            if is_overloaded and attempt < retries:
                time.sleep(base_delay * (attempt + 1))  # 2s, 4s, 6s...
                continue
            raise last_error


# ------------------------------------------------------------------
# 5. Routes (paths include /api prefix — matches Vercel's rewrite rule)
# ------------------------------------------------------------------
@app.get("/api")
def health_check():
    return {"status": "ok", "message": "Bijli Bachao AI backend is running"}


@app.post("/api/analyze-manual")
def analyze_manual(payload: ManualRequest):
    ensure_client()
    breakdown = compute_appliance_units(payload.appliances)

    if not breakdown:
        raise HTTPException(status_code=400, detail="Kam az kam ek appliance ki tadad aur ghante bharein.")

    prompt = PROMPT_MANUAL.format(
        appliance_data=json.dumps(breakdown),
        rate=payload.rate_per_unit
    )

    try:
        response = call_gemini_with_retry(prompt)
        data = parse_ai_json(response.text)
        data["breakdown"] = breakdown
        return data
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="AI response could not be parsed. Try again.")
    except Exception as e:
        error_text = str(e)
        if "503" in error_text or "UNAVAILABLE" in error_text or "overloaded" in error_text.lower():
            raise HTTPException(
                status_code=503,
                detail="Server filhal busy hai (AI provider par zyada load hai). 30-60 second baad dobara try karein."
            )
        raise HTTPException(status_code=500, detail=error_text)


@app.post("/api/analyze-bill")
async def analyze_bill(rate_per_unit: float = Form(35), file: UploadFile = File(...)):
    ensure_client()

    try:
        image_bytes = await file.read()
        img = Image.open(io.BytesIO(image_bytes))

        prompt = PROMPT_BILL_ONLY.format(rate=rate_per_unit)
        response = call_gemini_with_retry([prompt, img])
        data = parse_ai_json(response.text)
        data["breakdown"] = [
            {"appliance": i["appliance"], "current_monthly_units": i["current_monthly_units"]}
            for i in data.get("appliance_insights", [])
        ]
        return data
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="AI response could not be parsed. Try again.")
    except Exception as e:
        error_text = str(e)
        if "503" in error_text or "UNAVAILABLE" in error_text or "overloaded" in error_text.lower():
            raise HTTPException(
                status_code=503,
                detail="Server filhal busy hai (AI provider par zyada load hai). 30-60 second baad dobara try karein."
            )
        raise HTTPException(status_code=500, detail=error_text)
