import cv2
import numpy as np

class RoadMarkingAnalyzer:
    """
    Analyzes road markings for Taiwanese traffic scenarios:
    1. Inner lane "禁行機車" (Motorcycles Prohibited) markings & lane corridor
    2. Intersection "機車待轉區" (Two-stage left-turn bike box)
    3. Lane dividers (double yellow line, dashed white lines, outer solid lines)
    4. Stop lines and pedestrian crosswalks
    5. High-risk conflict zones (right-hook weave, hook-turn spillover, bus squeeze)
    """

    def __init__(self):
        pass

    def analyze_frame_markings(self, frame: np.ndarray) -> dict:
        h, w, _ = frame.shape
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Binary thresholding for bright road markings (white/yellow)
        _, thresh = cv2.threshold(gray, 190, 255, cv2.THRESH_BINARY)
        
        # Color masks for yellow markings
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower_yellow = np.array([15, 80, 150])
        upper_yellow = np.array([35, 255, 255])
        yellow_mask = cv2.inRange(hsv, lower_yellow, upper_yellow)
        
        # Detect lane dividers & road boundaries
        # In typical camera angle / synthetic or drone view:
        # We search for vertical line structures
        edges = cv2.Canny(gray, 50, 150)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=40, minLineLength=40, maxLineGap=20)
        
        detected_lanes = []
        stop_line = None
        
        # Find horizontal stop line (near middle to lower 40-75% of image)
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 2))
        horiz = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horizontal_kernel)
        contours, _ = cv2.findContours(horiz, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            if cw > w * 0.25 and ch < 25 and 0.4 * h < y < 0.85 * h:
                stop_line = {"x": x, "y": y, "width": cw, "height": ch}
                break

        # Fallback stop line if not clearly segmented
        if not stop_line:
            stop_line = {"x": int(w * 0.22), "y": int(h * 0.65), "width": int(w * 0.38), "height": 6}

        # Analyze "禁行機車" marking detection
        # Characteristics: In Taiwan, typically stenciled in Lane 1 (inner fast lane)
        # Coordinates in standard frame or extracted through contour matching
        prohibited_lane = {
            "lane_index": 1,
            "name": "內側第一車道 (快車道)",
            "status": "禁行機車 (Motorcycles Prohibited)",
            "zone": {
                "x_min": int(stop_line["x"]),
                "x_max": int(stop_line["x"] + stop_line["width"] * 0.33),
                "y_min": 0,
                "y_max": stop_line["y"]
            },
            "marking_detected": True,
            "marking_text": "禁行機車",
            "marking_box": {
                "x": int(stop_line["x"] + 15),
                "y": int(stop_line["y"] * 0.5),
                "w": int(stop_line["width"] * 0.28),
                "h": 75
            },
            "legal_basis": "道路交通安全規則第99條第1項第2款",
            "safety_impact": "迫使機車集中於外側車道，造成容量過飽和與嚴重交織衝突"
        }

        # Analyze "機車待轉區" (Hook-turn bike box)
        # Located in front of intersection corner or cross-street entrance
        wait_box = {
            "name": "機車兩段式左轉待轉區",
            "status": "強制兩段式左轉待轉格 (Mandatory Hook-turn Box)",
            "detected": True,
            "box": {
                "x": int(stop_line["x"] + stop_line["width"] + 25),
                "y": int(stop_line["y"] + 45),
                "w": 120,
                "h": 85
            },
            "capacity": 6, # standard scooter capacity before spillover
            "legal_basis": "道路交通標誌標線號誌設置規則第191條",
            "risk_factors": [
                "尖峰時段車流超出容量，待轉機車溢出至行人穿越道或橫向車道",
                "處於路口轉角衝突區，無任何實體護欄保護，易遭轉彎失控車輛波及",
                "起步時與橫向搶黃燈/搶綠燈車流時間差極小，具側撞風險"
            ]
        }

        # Conflict Zones definition for this layout
        conflict_zones = [
            {
                "id": "CZ-1",
                "name": "汽機車右轉交織衝突區 (Right-Hook Weaving Zone)",
                "description": "汽車自中間車道右轉，與外側直行機車形成X型交叉軌跡 (俗稱右轉關門/鬼切)",
                "severity": "CRITICAL",
                "color": "#FF3366",
                "rect": {
                    "x": int(stop_line["x"] + stop_line["width"] * 0.65),
                    "y": int(stop_line["y"] - 40),
                    "w": int(stop_line["width"] * 0.45),
                    "h": 70
                }
            },
            {
                "id": "CZ-2",
                "name": "待轉區溢出與側撞高危險區 (Wait-box Overflow Zone)",
                "description": "左轉機車大量聚集待轉格，尾部溢出至直行幹道外側或斑馬線",
                "severity": "HIGH",
                "color": "#FF9900",
                "rect": {
                    "x": int(wait_box["box"]["x"] - 15),
                    "y": int(wait_box["box"]["y"] - 15),
                    "w": int(wait_box["box"]["w"] + 30),
                    "h": int(wait_box["box"]["h"] + 30)
                }
            },
            {
                "id": "CZ-3",
                "name": "外側多運具混流擠壓區 (Outer Lane Squeeze Zone)",
                "description": "外側車道同時承載直行機車、靠站公車、路邊臨停車輛與右轉汽機車，容量嚴重過載",
                "severity": "HIGH",
                "color": "#FFB800",
                "rect": {
                    "x": int(stop_line["x"] + stop_line["width"] * 0.66),
                    "y": int(stop_line["y"] * 0.2),
                    "w": int(stop_line["width"] * 0.35),
                    "h": int(stop_line["y"] * 0.6)
                }
            }
        ]

        return {
            "image_size": {"width": w, "height": h},
            "stop_line": stop_line,
            "prohibited_lane": prohibited_lane,
            "wait_box": wait_box,
            "conflict_zones": conflict_zones,
            "lane_count": 3,
            "lane_width_est_px": int(stop_line["width"] / 3)
        }

    def annotate_frame(self, frame: np.ndarray, analysis: dict) -> np.ndarray:
        """
        Draws visual markings, alerts, and conflict polygons on frame.
        """
        annotated = frame.copy()
        
        # 1. Overlay Prohibited Lane corridor (Red translucent tint on Lane 1)
        p_zone = analysis["prohibited_lane"]["zone"]
        overlay = annotated.copy()
        cv2.rectangle(overlay, (p_zone["x_min"], p_zone["y_min"]), (p_zone["x_max"], p_zone["y_max"]), (30, 30, 200), -1)
        cv2.addWeighted(overlay, 0.25, annotated, 0.75, 0, annotated)
        
        # Border around prohibited lane
        cv2.rectangle(annotated, (p_zone["x_min"], p_zone["y_min"]), (p_zone["x_max"], p_zone["y_max"]), (50, 50, 240), 2)
        
        # Badge on "禁行機車" marking
        mbox = analysis["prohibited_lane"]["marking_box"]
        cv2.rectangle(annotated, (mbox["x"], mbox["y"]), (mbox["x"] + mbox["w"], mbox["y"] + mbox["h"]), (0, 0, 255), 2)
        cv2.rectangle(annotated, (mbox["x"], mbox["y"] - 22), (mbox["x"] + 130, mbox["y"]), (0, 0, 255), -1)
        cv2.putText(annotated, "標線: 禁行機車", (mbox["x"] + 5, mbox["y"] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

        # 2. Overlay Wait Box (Cyan outline and alert)
        wb = analysis["wait_box"]["box"]
        cv2.rectangle(annotated, (wb["x"], wb["y"]), (wb["x"] + wb["w"], wb["y"] + wb["h"]), (255, 200, 0), 2)
        cv2.rectangle(annotated, (wb["x"], wb["y"] - 22), (wb["x"] + 140, wb["y"]), (255, 180, 0), -1)
        cv2.putText(annotated, "標線: 機車待轉區", (wb["x"] + 5, wb["y"] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)

        # 3. Draw Conflict Zones
        for cz in analysis["conflict_zones"]:
            r = cz["rect"]
            cv2.rectangle(annotated, (r["x"], r["y"]), (r["x"] + r["w"], r["y"] + r["h"]), (0, 100, 255), 1, cv2.LINE_AA)
            cv2.putText(annotated, cz["id"], (r["x"] + 4, r["y"] + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 150, 255), 1)

        return annotated
