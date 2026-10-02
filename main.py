import os
import shutil
import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from detector import TrafficDetector
from simulation import MicroTrafficSimulator
from sample_generator import create_sample_traffic_video

app = FastAPI(
    title="台灣交通路況與機車路權評估系統 (Taiwan Traffic & Motorcycle Lane Rights AI Analyzer)",
    description="分析台灣路況、官方驗證YOLOv8車種辨識、道路標線偵測、俯視動態路線車流模擬、移除禁行機車與待轉區之成效評估",
    version="2.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
os.makedirs("results", exist_ok=True)
os.makedirs("static", exist_ok=True)
os.makedirs("static/samples", exist_ok=True)

detector = TrafficDetector()
simulator = MicroTrafficSimulator()

latest_video_profile = {
    "source_video": "sample_rush_hour.mp4",
    "total_vehicles_detected": 28,
    "scooter_ratio_pct": 64.3,
    "car_ratio_pct": 28.6,
    "outer_lane_scooter_pct": 86.3,
    "right_hook_conflicts_observed": 3,
    "road_profile": {
        "lane_count": 3,
        "is_moving_camera": False,
        "camera_speed_kmh": 0.0,
        "road_curvature": "straight",
        "curvature_factor": 0.0,
        "has_intersection": True
    },
    "vehicle_stream": [
        {"id": 1, "type": "motorcycle", "arrival_frame": 0, "initial_lane": 2, "turn": "straight", "speed": 3.4},
        {"id": 2, "type": "car", "arrival_frame": 6, "initial_lane": 1, "turn": "straight", "speed": 2.8},
        {"id": 3, "type": "motorcycle", "arrival_frame": 12, "initial_lane": 2, "turn": "left_hook", "speed": 3.2},
        {"id": 4, "type": "car", "arrival_frame": 20, "initial_lane": 1, "turn": "right", "speed": 2.4},
        {"id": 5, "type": "motorcycle", "arrival_frame": 26, "initial_lane": 2, "turn": "straight", "speed": 3.5},
        {"id": 6, "type": "bus", "arrival_frame": 35, "initial_lane": 2, "turn": "straight", "speed": 2.0}
    ]
}

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/results", StaticFiles(directory="results"), name="results")

@app.get("/")
async def get_index():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Taiwan Traffic AI Analysis Server is Running."}

@app.get("/api/sample-videos")
async def get_sample_videos():
    samples = [
        {
            "id": "sample_rush_hour.mp4",
            "title": "15秒路口實測：三線道外側擠壓與右轉交織衝突",
            "description": "完整15秒市區幹道，內側禁行機車，大量機車被迫擠在外側慢車道，汽車右轉時劇烈交織衝突。",
            "url": "/static/samples/sample_rush_hour.mp4",
            "lane_count": 3,
            "is_moving": False
        },
        {
            "id": "sample_moving_dashcam.mp4",
            "title": "15秒機車行車記錄器：前進移動動態路線實測",
            "description": "真實前進移動視角（行車記錄器），俯視微觀模擬將動態捲動道路路線，呈現機車行駛外側受壓迫動線。",
            "url": "/static/samples/sample_moving_dashcam.mp4",
            "lane_count": 3,
            "is_moving": True
        }
    ]
    return {"status": "success", "samples": samples}

@app.post("/api/upload-video")
async def upload_video(file: UploadFile = File(...)):
    global latest_video_profile
    try:
        filename = file.filename or "uploaded_video.mp4"
        file_path = os.path.join("uploads", filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Support at least 25 seconds of video
        analysis_result = detector.process_video(file_path, output_dir="results", max_seconds=25.0)
        latest_video_profile = analysis_result.get("video_traffic_profile", latest_video_profile)
        
        return {
            "status": "success",
            "message": "影片分析完成",
            "data": analysis_result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"影片分析失敗: {str(e)}")

@app.post("/api/analyze-sample")
async def analyze_sample(payload: dict = Body(...)):
    global latest_video_profile
    sample_id = payload.get("sample_id", "sample_rush_hour.mp4")
    sample_path = os.path.join("static", "samples", sample_id)
    
    if not os.path.exists(sample_path):
        scenario = "moving_dashcam" if "moving" in sample_id else "peak"
        create_sample_traffic_video(sample_path, duration_sec=15, fps=25, scenario_type=scenario)

    try:
        # Full 15+ second analysis
        analysis_result = detector.process_video(sample_path, output_dir="results", max_seconds=25.0)
        latest_video_profile = analysis_result.get("video_traffic_profile", latest_video_profile)
        return {
            "status": "success",
            "message": "示範影片分析完成",
            "data": analysis_result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析示範影片失敗: {str(e)}")

@app.get("/api/latest-video-profile")
async def get_latest_video_profile():
    return {
        "status": "success",
        "data": latest_video_profile
    }

@app.post("/api/simulate")
async def simulate_traffic(params: dict = Body(...)):
    try:
        res = simulator.run_simulation(params)
        return {
            "status": "success",
            "data": res
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"模擬計算錯誤: {str(e)}")

@app.get("/api/comparison-report")
async def get_comparison_report():
    try:
        report = simulator.generate_all_scenarios_comparison()
        return {
            "status": "success",
            "data": report
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"產生報告失敗: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
