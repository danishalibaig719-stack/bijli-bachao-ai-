import os
import json
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from PIL import Image
import io

app = Flask(__name__)
CORS(app)

# Configure Gemini API
API_KEY = os.environ.get("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)
else:
    print("WARNING: GEMINI_API_KEY environment variable not found!")

MODEL_NAME = "gemini-1.5-flash"

SYSTEM_INSTRUCTION = """
You are a Pakistani energy expert. Analyze the input and output a strict JSON object.
Do NOT write any markdown wrapping, code blocks, or conversational text outside the JSON.
Keep 'overall_summary_roman_urdu' and 'tip_roman_urdu' extremely short, concise, and direct (max 2 sentences each) in Roman Urdu.
This is critical to prevent system timeouts.
"""

def get_generation_config():
    return {
        "temperature": 0.2,
        "top_p": 0.95,
        "max_output_tokens": 1000,
        "response_mime_type": "application/json"
    }

def clean_and_parse_json(raw_text):
    """
    This helper function prevents 500 errors by cleaning up any markdown
    formatting (like ```json ... ```) that Gemini might generate.
    """
    cleaned = raw_text.strip()
    # Remove markdown code blocks if present
    cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^```\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"```$", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip()
    return json.loads(cleaned)

@app.route("/api/analyze-manual", methods=["POST"])
def analyze_manual():
    try:
        data = request.get_json()
        if not data or "appliances" not in data:
            return jsonify({"detail": "Appliances data missing in request"}), 400
        
        rate = data.get("rate_per_unit", 35)
        appliances = data["appliances"]
        
        prompt = f"""
        Rate per unit: Rs {rate}.
        Appliances: {json.dumps(appliances)}.
        Calculate monthly units per appliance. Provide 3 targeted energy-saving tips in 'appliance_insights'.
        Return JSON strictly matching this structure:
        {{
          "risk_level": "Low/Medium/High",
          "estimated_monthly_saving_units": 120,
          "estimated_monthly_saving_rs": 4200,
          "overall_summary_roman_urdu": "Koshish karein AC kam chalayein aur peak hours ka khayal rakhein.",
          "breakdown": [
            {{"appliance": "AC", "current_monthly_units": 300}}
          ],
          "appliance_insights": [
            {{
              "appliance": "AC",
              "current_monthly_units": 300,
              "suggested_daily_hours": 4,
              "monthly_unit_saving": 50,
              "tip_roman_urdu": "Temperatue hamesha 26 degree par rakhein."
            }}
          ]
        }}
        """
        
        model = genai.GenerativeModel(
            model_name=MODEL_NAME,
            generation_config=get_generation_config(),
            system_instruction=SYSTEM_INSTRUCTION
        )
        
        response = model.generate_content(prompt)
        
        if not response or not response.text:
            return jsonify({"detail": "Gemini API returned an empty response."}), 502
            
        result = clean_and_parse_json(response.text)
        return jsonify(result)
        
    except json.JSONDecodeError as je:
        return jsonify({"detail": f"JSON parsing failed. Raw response was: {response.text if 'response' in locals() else 'None'}"}), 500
    except Exception as e:
        return jsonify({"detail": f"Backend Error: {str(e)}"}), 500


@app.route("/api/analyze-bill", methods=["POST"])
def analyze_bill():
    try:
        if "file" not in request.files:
            return jsonify({"detail": "No file uploaded"}), 400
            
        file = request.files["file"]
        rate = float(request.form.get("rate_per_unit", 35))
        
        # Read and open image safely
        img_bytes = file.read()
        try:
            image = Image.open(io.BytesIO(img_bytes))
        except Exception as img_err:
            return jsonify({"detail": f"Uploaded file is not a valid image: {str(img_err)}"}), 400
        
        prompt = f"""
        Analyze this Pakistani electricity bill image. Extracted rate: Rs {rate} per unit.
        1. Find the total consumed units (extracted_bill_units).
        2. Break down where these units are likely spent based on typical Pakistani households.
        3. Give smart saving advice.
        Return JSON strictly matching this structure:
        {{
          "extracted_bill_units": 350,
          "risk_level": "High/Medium/Low",
          "estimated_monthly_saving_units": 80,
          "estimated_monthly_saving_rs": 2800,
          "overall_summary_roman_urdu": "Aapke bill ke mutabiq units zyada hain. Fan aur lights ka be-ja istemal kam karein.",
          "breakdown": [
            {{"appliance": "AC", "current_monthly_units": 150}},
            {{"appliance": "Fridge", "current_monthly_units": 100}},
            {{"appliance": "Ceiling Fan", "current_monthly_units": 60}},
            {{"appliance": "LED Lights", "current_monthly_units": 40}}
          ],
          "appliance_insights": [
            {{
              "appliance": "AC",
              "current_monthly_units": 150,
              "suggested_daily_hours": 3,
              "monthly_unit_saving": 30,
              "tip_roman_urdu": "Peak hours (6pm-11pm) mein AC band rakhne se bill bohot kam hoga."
            }}
          ]
        }}
        """
        
        model = genai.GenerativeModel(
            model_name=MODEL_NAME,
            generation_config=get_generation_config(),
            system_instruction=SYSTEM_INSTRUCTION
        )
        
        response = model.generate_content([prompt, image])
        
        if not response or not response.text:
            return jsonify({"detail": "Gemini API returned an empty response for the bill."}), 502
            
        result = clean_and_parse_json(response.text)
        return jsonify(result)
        
    except json.JSONDecodeError as je:
        return jsonify({"detail": f"JSON parsing failed for bill. Raw response was: {response.text if 'response' in locals() else 'None'}"}), 500
    except Exception as e:
        return jsonify({"detail": f"Backend Error: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True)
