import os
import cv2
import numpy as np
import math

def create_sample_traffic_video(output_path: str, duration_sec: int = 15, fps: int = 25, scenario_type: str = "peak"):
    """
    Generates a realistic 15-second synthetic bird's-eye or dashcam traffic video.
    Supports both stationary intersection view and forward-moving dashcam view.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    width, height = 960, 540
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    total_frames = duration_sec * fps
    is_moving = (scenario_type == "moving_dashcam")

    road_left = 220
    road_right = 580
    lane_count = 3
    lane_w = (road_right - road_left) // lane_count
    stop_line_y = 360

    # Colors
    C_ROAD = (45, 45, 48)
    C_SIDEWALK = (80, 75, 70)
    C_MARKING = (235, 235, 235)
    C_YELLOW = (0, 215, 255)

    C_CAR_COLORS = [(220, 180, 70), (60, 60, 200), (210, 210, 210), (60, 60, 60)]
    C_SCOOTER_COLORS = [(0, 140, 255), (0, 200, 255), (50, 220, 100), (220, 80, 200)]

    vehicles = []
    next_id = 1
    np.random.seed(42 if scenario_type == "peak" else 88)

    # Initial vehicles in waitbox
    if not is_moving:
        vehicles.append({
            "id": 901, "type": "motorcycle", "x": 620.0, "y": 410.0,
            "vx": 0.0, "vy": 0.0, "w": 18, "h": 36, "color": (0, 140, 255),
            "turn": "waiting_hook", "status": "in_box", "lane": 0
        })
        vehicles.append({
            "id": 902, "type": "motorcycle", "x": 655.0, "y": 415.0,
            "vx": 0.0, "vy": 0.0, "w": 18, "h": 36, "color": (50, 220, 100),
            "turn": "waiting_hook", "status": "in_box", "lane": 0
        })

    scroll_y = 0.0

    for f in range(total_frames):
        frame = np.full((height, width, 3), C_SIDEWALK, dtype=np.uint8)

        if is_moving:
            # Moving dashcam mode: Road scrolls downwards with forward travel speed
            camera_speed = 4.2
            scroll_y = (scroll_y + camera_speed) % 50
            curve_offset = int(math.sin(f * 0.03) * 35) # dynamic road curving left and right!
        else:
            camera_speed = 0.0
            curve_offset = 0

        # Draw road asphalt polygon (with curve if moving)
        cur_left = road_left + curve_offset
        cur_right = road_right + curve_offset

        cv2.rectangle(frame, (cur_left, 0), (cur_right, height), C_ROAD, -1)

        # In stationary mode, draw cross street
        if not is_moving:
            cv2.rectangle(frame, (0, stop_line_y + 15), (width, height), (40, 40, 42), -1)

        # Left edge double yellow line
        cv2.line(frame, (cur_left, 0), (cur_left, stop_line_y if not is_moving else height), C_YELLOW, 3)
        cv2.line(frame, (cur_left - 4, 0), (cur_left - 4, stop_line_y if not is_moving else height), C_YELLOW, 2)

        # Right edge solid white line
        cv2.line(frame, (cur_right, 0), (cur_right, stop_line_y if not is_moving else height), C_MARKING, 3)

        # Lane dividers (dashed lines moving if dashcam)
        dash_start = int(scroll_y) if is_moving else 0
        for dy in range(dash_start - 35, (stop_line_y if not is_moving else height) + 35, 35):
            if 0 <= dy < (stop_line_y if not is_moving else height):
                # Divider 1-2
                cv2.line(frame, (cur_left + lane_w, dy), (cur_left + lane_w, min(dy + 18, height)), C_MARKING, 2)
                # Divider 2-3
                cv2.line(frame, (cur_left + 2 * lane_w, dy), (cur_left + 2 * lane_w, min(dy + 18, height)), C_MARKING, 2)

        # Markings: "禁行機車" in Lane 1
        marking_y = int((180 + (scroll_y if is_moving else 0)) % (stop_line_y if not is_moving else height))
        cv2.rectangle(frame, (cur_left + 15, marking_y - 20), (cur_left + lane_w - 15, marking_y + 55), (55, 55, 60), -1)
        cv2.putText(frame, "禁行", (cur_left + 26, marking_y + 10), cv2.FONT_HERSHEY_SIMPLEX, 0.65, C_MARKING, 2, cv2.LINE_AA)
        cv2.putText(frame, "機車", (cur_left + 26, marking_y + 40), cv2.FONT_HERSHEY_SIMPLEX, 0.65, C_MARKING, 2, cv2.LINE_AA)

        if not is_moving:
            # Stop line & crosswalk
            cv2.line(frame, (cur_left, stop_line_y), (cur_right, stop_line_y), C_MARKING, 6)
            for zx in range(cur_left - 20, cur_right + 80, 24):
                cv2.rectangle(frame, (zx, stop_line_y + 12), (zx + 14, stop_line_y + 36), C_MARKING, -1)

            # Wait box
            box_x1, box_y1 = cur_right + 25, stop_line_y + 50
            box_x2, box_y2 = cur_right + 145, stop_line_y + 135
            cv2.rectangle(frame, (box_x1, box_y1), (box_x2, box_y2), (255, 255, 255), 3)
            cv2.putText(frame, "機車待轉區", (box_x1 + 10, box_y1 + 35), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)

        # Spawn vehicles periodically (at least 15 seconds)
        if f % 22 == 0 and len(vehicles) < 20:
            r = np.random.rand()
            if r < 0.60:
                v_type = "motorcycle"
                lane_idx = 2 if np.random.rand() < 0.85 else 1
                lane_offset = np.random.randint(-25, 25)
                w, h = 18, 38
                color = C_SCOOTER_COLORS[np.random.randint(0, len(C_SCOOTER_COLORS))]
                turn = "left_hook" if (not is_moving and np.random.rand() < 0.3) else "straight"
                speed = np.random.uniform(2.8, 3.8)
            elif r < 0.90:
                v_type = "car"
                lane_idx = np.random.choice([0, 1, 2], p=[0.45, 0.40, 0.15])
                lane_offset = np.random.randint(-8, 8)
                w, h = 34, 66
                color = C_CAR_COLORS[np.random.randint(0, len(C_CAR_COLORS))]
                turn = "right" if (not is_moving and lane_idx >= 1 and np.random.rand() < 0.25) else "straight"
                speed = np.random.uniform(2.2, 3.0)
            else:
                v_type = "bus"
                lane_idx = 1
                lane_offset = 0
                w, h = 38, 100
                color = (40, 160, 60)
                turn = "straight"
                speed = 2.0

            x = cur_left + lane_idx * lane_w + lane_w // 2 + lane_offset
            y = -h - 10
            vehicles.append({
                "id": next_id, "type": v_type, "x": float(x), "y": float(y),
                "vx": 0.0, "vy": float(speed), "w": int(w), "h": int(h),
                "color": color, "turn": turn, "status": "driving", "lane": lane_idx + 1
            })
            next_id += 1

        # In moving dashcam mode, place the Ego vehicle in outer lane
        if is_moving:
            ego_x = cur_left + 2 * lane_w + lane_w // 2
            ego_y = height - 90
            cv2.rectangle(frame, (ego_x - 10, ego_y - 22), (ego_x + 10, ego_y + 22), (0, 140, 255), -1)
            cv2.circle(frame, (ego_x, ego_y), 6, (240, 240, 240), -1)
            cv2.putText(frame, "EGO SCOOTER", (ego_x - 45, ego_y + 35), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 240, 255), 1)

        # Update and draw vehicles
        alive = []
        for v in vehicles:
            if v["status"] == "in_box":
                alive.append(v)
            else:
                v["y"] += v["vy"]
                if not is_moving and v["turn"] == "left_hook" and v["y"] >= stop_line_y - 15:
                    v["x"] += 2.0
                    if v["y"] >= stop_line_y + 50:
                        v["status"] = "in_box"
                elif not is_moving and v["turn"] == "right" and v["y"] >= stop_line_y - 10:
                    v["x"] += 2.5

                if v["y"] < height + 80 and v["x"] < width + 80:
                    alive.append(v)

            # Draw vehicle body
            vx, vy = int(v["x"]), int(v["y"])
            vw, vh = v["w"], v["h"]
            cv2.rectangle(frame, (vx - vw//2, vy - vh//2), (vx + vw//2, vy + vh//2), v["color"], -1)
            cv2.rectangle(frame, (vx - vw//2, vy - vh//2), (vx + vw//2, vy + vh//2), (20, 20, 20), 1)
            if v["type"] == "motorcycle":
                cv2.circle(frame, (vx, vy), 5, (230, 230, 230), -1)
            elif v["type"] == "car":
                cv2.rectangle(frame, (vx - vw//2 + 3, vy - vh//2 + 8), (vx + vw//2 - 3, vy - vh//2 + 20), (30, 35, 40), -1)

        vehicles = alive

        # HUD
        cv2.rectangle(frame, (10, 10), (320, 75), (20, 20, 25), -1)
        mode_text = "MOVING DASHCAM" if is_moving else "STATIONARY CAM"
        cv2.putText(frame, f"TAIWAN ROAD CAM ({mode_text})", (18, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 240, 255), 1)
        cv2.putText(frame, f"Time: {f/fps:.2f}s / {duration_sec}s | 15s Footage", (18, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1)
        cv2.putText(frame, f"LANE 1: 禁行機車管制中", (18, 68), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (100, 150, 255), 1)

        out.write(frame)

    out.release()
    print(f"Generated {output_path} ({total_frames} frames, {duration_sec} seconds)")

if __name__ == "__main__":
    os.makedirs("static/samples", exist_ok=True)
    # Generate 15-second stationary intersection sample
    create_sample_traffic_video("static/samples/sample_rush_hour.mp4", duration_sec=15, fps=25, scenario_type="peak")
    # Generate 15-second moving dashcam sample
    create_sample_traffic_video("static/samples/sample_moving_dashcam.mp4", duration_sec=15, fps=25, scenario_type="moving_dashcam")
