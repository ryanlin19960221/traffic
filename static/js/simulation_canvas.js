/**
 * Taiwan Traffic Simulation Engine - Dynamic Parametric Road & Camera Motion
 * Accurately models Taiwanese multi-lane urban intersections, vehicle dynamics,
 * and dynamically adapts the road geometry, lane count, and moving path from the uploaded video.
 */

class TrafficIntersectionSim {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.policy = options.policy || 'baseline';
    this.isSplit = options.isSplit || false;
    this.speedMultiplier = 1.0;
    this.isPlaying = true;
    
    // Road & Video Profile
    this.videoProfile = options.videoProfile || null;
    this.roadProfile = {
      lane_count: 3,
      is_moving_camera: false,
      camera_speed_kmh: 0.0,
      road_curvature: 'straight',
      curvature_factor: 0.0,
      has_intersection: true,
      stop_line_y: 350
    };

    // Dynamic Route scrolling & curvature state
    this.scrollTravelDistance = 0.0;
    this.cameraScrollSpeed = 3.6; // px per frame when moving
    this.curvePhase = 0.0;

    // Simulation rates
    this.scooterRate = options.scooterRate || 2200;
    this.carRate = options.carRate || 1400;
    this.leftTurnRatio = 0.25;
    this.rightTurnRatio = 0.20;

    // Stream playback pointer
    this.streamIndex = 0;
    this.streamTick = 0;
    
    // Geometry
    this.initDimensions();

    // State
    this.vehicles = [];
    this.conflictMarkers = [];
    this.totalThroughput = 0;
    this.totalConflicts = 0;
    this.waitBoxCount = 0;
    this.nextVehicleId = 1;
    this.frameCount = 0;
    
    // Signal Cycle
    this.signalState = 'GREEN';
    this.signalTimer = 0;
    this.cycleDuration = 600;

    window.addEventListener('resize', () => this.initDimensions());

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setVideoProfile(profile) {
    this.videoProfile = profile;
    if (profile && profile.road_profile) {
      this.roadProfile = Object.assign({}, this.roadProfile, profile.road_profile);
      if (this.roadProfile.is_moving_camera) {
        this.cameraScrollSpeed = Math.max(2.5, Math.min(6.5, this.roadProfile.camera_speed_kmh * 0.1));
      }
    }
    this.initDimensions();
    this.reset();

    if (profile && profile.breakdown) {
      const dur = Math.max(1, profile.duration_sec || 15);
      const factor = 3600 / dur;
      this.scooterRate = Math.min(4500, Math.max(800, Math.round(profile.breakdown.motorcycle * factor * 0.35)));
      this.carRate = Math.min(3000, Math.max(500, Math.round(profile.breakdown.car * factor * 0.35)));
    }
  }

  initDimensions() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 640;
    this.height = rect.height || 520;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);

    // Dynamic Road Width based on detected lane count (2, 3, or 4 lanes!)
    this.laneCount = this.roadProfile.lane_count || 3;
    const laneWidthPx = (this.laneCount === 2) ? 125 : ((this.laneCount === 4) ? 80 : 105);
    this.roadWidth = laneWidthPx * this.laneCount;
    
    this.baseRoadLeft = (this.width - this.roadWidth) * 0.45;
    this.laneWidth = laneWidthPx;

    this.laneCenters = [];
    for (let i = 0; i < this.laneCount; i++) {
      this.laneCenters.push(this.baseRoadLeft + (i + 0.5) * this.laneWidth);
    }

    this.stopLineY = this.height * 0.62;
    this.crossStreetY = this.stopLineY + 25;

    // Hook turn box
    this.waitBox = {
      x: this.baseRoadLeft + this.roadWidth + 15,
      y: this.stopLineY + 45,
      w: 80,
      h: 65,
      maxCap: 5
    };
  }

  getCurvatureOffset(y) {
    if (this.roadProfile.is_moving_camera) {
      // Dynamic moving route: road curves smoothly as camera moves forward
      const factor = (this.roadProfile.curvature_factor || 0.0);
      const phase = (y + this.scrollTravelDistance) * 0.007;
      return Math.sin(phase) * 38 * (Math.abs(factor) > 0.1 ? Math.sign(factor) : 1.0);
    } else if (this.roadProfile.road_curvature !== 'straight') {
      // Stationary road with curvature
      const normY = (y - this.height * 0.5) / (this.height * 0.5);
      return (this.roadProfile.curvature_factor || 0.3) * (normY * normY) * 60;
    }
    return 0;
  }

  setPolicy(newPolicy) {
    this.policy = newPolicy;
    this.conflictMarkers = [];
  }

  reset() {
    this.vehicles = [];
    this.conflictMarkers = [];
    this.totalThroughput = 0;
    this.totalConflicts = 0;
    this.waitBoxCount = 0;
    this.frameCount = 0;
    this.signalTimer = 0;
    this.streamIndex = 0;
    this.streamTick = 0;
    this.scrollTravelDistance = 0.0;
  }

  spawnVehicle() {
    // Replay extracted vehicle sequence from uploaded video
    if (this.videoProfile && this.videoProfile.vehicle_stream && this.videoProfile.vehicle_stream.length > 0) {
      this.streamTick += this.speedMultiplier;
      const stream = this.videoProfile.vehicle_stream;
      const currentTarget = stream[this.streamIndex % stream.length];

      if (this.streamTick >= (this.streamIndex * 15)) {
        this.spawnFromVideoStreamItem(currentTarget);
        this.streamIndex++;
      }
      return;
    }

    // Parametric spawn fallback
    const spawnProb = (this.scooterRate + this.carRate) / (3600 * 25) * 1.5;
    if (Math.random() > spawnProb) return;

    const isScooter = Math.random() < (this.scooterRate / (this.scooterRate + this.carRate));
    let vType = isScooter ? 'motorcycle' : (Math.random() < 0.12 ? 'bus' : 'car');
    
    let chosenLane = this.laneCount - 1; // default outer
    let turnIntent = 'straight';
    const rTurn = Math.random();

    if (!this.roadProfile.is_moving_camera) {
      if (rTurn < this.leftTurnRatio) turnIntent = 'left';
      else if (rTurn < this.leftTurnRatio + this.rightTurnRatio) turnIntent = 'right';
    }

    if (vType === 'motorcycle') {
      if (this.policy === 'baseline') {
        chosenLane = this.laneCount - 1; // forced outer
        if (turnIntent === 'left') turnIntent = 'left_hook';
      } else if (this.policy === 'remove_lane_ban') {
        chosenLane = Math.floor(Math.random() * this.laneCount);
        if (turnIntent === 'left') turnIntent = 'left_hook';
      } else if (this.policy === 'direct_left_turn') {
        chosenLane = (turnIntent === 'left') ? Math.min(1, this.laneCount - 2) : (this.laneCount - 1);
      } else {
        chosenLane = (turnIntent === 'left') ? 0 : Math.floor(Math.random() * this.laneCount);
      }
    } else if (vType === 'car') {
      chosenLane = (turnIntent === 'right') ? (this.laneCount - 1) : Math.max(0, this.laneCount - 2);
    }

    this.createVehicleEntity(vType, chosenLane, turnIntent, `V-${this.nextVehicleId++}`);
  }

  spawnFromVideoStreamItem(item) {
    const vType = item.type || 'motorcycle';
    let turnIntent = item.turn || 'straight';
    let chosenLane = Math.min(this.laneCount - 1, item.initial_lane !== undefined ? item.initial_lane : (this.laneCount - 1));

    if (vType === 'motorcycle') {
      if (this.policy === 'baseline') {
        chosenLane = this.laneCount - 1; // forced to outer lane
        if (turnIntent === 'left' || turnIntent === 'left_hook') {
          turnIntent = 'left_hook';
        }
      } else if (this.policy === 'remove_lane_ban') {
        // Can take inner lane!
        if (chosenLane === this.laneCount - 1 && Math.random() < 0.5) {
          chosenLane = 0;
        }
        if (turnIntent === 'left') turnIntent = 'left_hook';
      } else if (this.policy === 'direct_left_turn') {
        if (turnIntent === 'left' || turnIntent === 'left_hook') {
          turnIntent = 'left';
          chosenLane = Math.max(0, this.laneCount - 2);
        }
      } else if (this.policy === 'full_reform') {
        if (turnIntent === 'left' || turnIntent === 'left_hook') {
          turnIntent = 'left';
          chosenLane = 0;
        } else if (Math.random() < 0.4) {
          chosenLane = 0;
        }
      }
    }

    this.createVehicleEntity(vType, chosenLane, turnIntent, `影片車輛 #${item.id || this.nextVehicleId++}`);
  }

  createVehicleEntity(vType, chosenLane, turnIntent, label) {
    const laneOffset = (vType === 'motorcycle') ? (Math.random() * 24 - 12) : (Math.random() * 8 - 4);
    const baseX = this.laneCenters[chosenLane] + laneOffset;
    const y = -60;
    const x = baseX + this.getCurvatureOffset(y);

    for (let v of this.vehicles) {
      if (Math.abs(v.x - x) < 22 && Math.abs(v.y - y) < 45) {
        return;
      }
    }

    const baseSpeed = (vType === 'motorcycle') ? 3.4 : (vType === 'car' ? 2.8 : 2.0);
    const speed = baseSpeed * (0.92 + Math.random() * 0.2);

    this.vehicles.push({
      id: this.nextVehicleId++,
      label: label,
      type: vType,
      x: x,
      y: y,
      baseX: baseX,
      vx: 0,
      vy: speed,
      baseSpeed: speed,
      lane: chosenLane,
      turn: turnIntent,
      state: 'cruising',
      boxTimer: 0,
      w: (vType === 'motorcycle') ? 14 : (vType === 'car' ? 26 : 30),
      h: (vType === 'motorcycle') ? 28 : (vType === 'car' ? 48 : 80),
      color: this.getVehicleColor(vType),
      waitingTime: 0
    });
  }

  getVehicleColor(type) {
    if (type === 'motorcycle') {
      const colors = ['#FF8C00', '#FFA500', '#FF7043', '#FFD54F', '#4DD0E1'];
      return colors[Math.floor(Math.random() * colors.length)];
    } else if (type === 'car') {
      const colors = ['#00B4D8', '#4FACFE', '#64748B', '#CBD5E1', '#E2E8F0', '#EF4444'];
      return colors[Math.floor(Math.random() * colors.length)];
    } else {
      return '#10B981';
    }
  }

  updateSignals() {
    if (this.roadProfile.is_moving_camera) {
      this.signalState = 'GREEN'; // Continuous moving roadway
      return;
    }

    this.signalTimer = (this.signalTimer + this.speedMultiplier) % this.cycleDuration;
    const phase = this.signalTimer / this.cycleDuration;

    if (this.policy === 'full_reform') {
      if (phase < 0.45) this.signalState = 'GREEN';
      else if (phase < 0.65) this.signalState = 'LEFT_ARROW';
      else if (phase < 0.70) this.signalState = 'YELLOW';
      else this.signalState = 'RED';
    } else {
      if (phase < 0.55) this.signalState = 'GREEN';
      else if (phase < 0.65) this.signalState = 'YELLOW';
      else this.signalState = 'RED';
    }
  }

  updateVehicles() {
    // If moving camera mode, advance route scroll travel distance
    if (this.roadProfile.is_moving_camera) {
      this.scrollTravelDistance += this.cameraScrollSpeed * this.speedMultiplier;
    }

    const aliveVehicles = [];
    let currentInBox = 0;

    for (let v of this.vehicles) {
      if (v.y > this.height + 80 || v.x > this.width + 80 || v.x < -60) {
        this.totalThroughput++;
        continue;
      }

      if (v.state === 'in_box') {
        currentInBox++;
        if (this.signalState === 'RED') {
          v.boxTimer += this.speedMultiplier;
          if (v.boxTimer > 25) {
            v.state = 'clearing';
            v.vx = v.baseSpeed * 1.1;
            v.vy = 0;
          }
        }
        aliveVehicles.push(v);
        continue;
      }

      if (v.state === 'clearing') {
        v.x += v.vx * this.speedMultiplier;
        aliveVehicles.push(v);
        continue;
      }

      const atStopLine = (!this.roadProfile.is_moving_camera) &&
                         (v.y + v.h * 0.5 >= this.stopLineY - 25 && v.y + v.h * 0.5 <= this.stopLineY + 10);
      let canPass = false;

      if (this.signalState === 'GREEN' || this.roadProfile.is_moving_camera) {
        canPass = true;
      } else if (this.signalState === 'LEFT_ARROW' && (v.turn === 'left' || v.turn === 'left_hook')) {
        canPass = true;
      } else if (this.signalState === 'YELLOW' && v.y > this.stopLineY - 40) {
        canPass = true;
      }

      let distAhead = 999;
      for (let other of this.vehicles) {
        if (other.id !== v.id && Math.abs(other.x - v.x) < 22) {
          const dy = (other.y - other.h * 0.5) - (v.y + v.h * 0.5);
          if (dy > 0 && dy < distAhead) {
            distAhead = dy;
          }
        }
      }

      let targetSpeed = v.baseSpeed;
      if (!canPass && atStopLine && v.y < this.stopLineY) {
        targetSpeed = 0;
        v.waitingTime += this.speedMultiplier;
      } else if (distAhead < 35) {
        targetSpeed = Math.max(0, (distAhead - 12) * 0.1);
        v.waitingTime += this.speedMultiplier * 0.5;
      }

      v.vy += (targetSpeed - v.vy) * 0.15;
      v.y += v.vy * this.speedMultiplier;

      // Adjust X based on dynamic road curvature
      const curveOffset = this.getCurvatureOffset(v.y);
      const targetX = v.baseX + curveOffset;
      v.x += (targetX - v.x) * 0.2;

      // Turning behavior at intersection
      if (!this.roadProfile.is_moving_camera && v.y >= this.stopLineY - 10) {
        if (v.turn === 'left_hook') {
          const targetBoxX = this.waitBox.x + 20 + (currentInBox % 3) * 22;
          const targetBoxY = this.waitBox.y + 20 + Math.floor(currentInBox / 3) * 20;
          v.x += (targetBoxX - v.x) * 0.12 * this.speedMultiplier;
          if (Math.abs(v.x - targetBoxX) < 10 && v.y >= targetBoxY - 10) {
            v.state = 'in_box';
            v.x = targetBoxX;
            v.y = targetBoxY;
            v.vx = 0;
            v.vy = 0;
          }
        } else if (v.turn === 'left') {
          v.x -= 2.2 * this.speedMultiplier;
          v.vy = Math.max(1.2, v.vy * 0.85);
        } else if (v.turn === 'right') {
          v.x += 2.2 * this.speedMultiplier;
          v.vy = Math.max(1.0, v.vy * 0.85);
        }
      }

      this.detectConflicts(v);
      aliveVehicles.push(v);
    }

    this.vehicles = aliveVehicles;
    this.waitBoxCount = currentInBox;
  }

  detectConflicts(v) {
    if (!this.roadProfile.is_moving_camera) {
      if (v.type === 'car' && v.turn === 'right' && v.y > this.stopLineY - 50 && v.y < this.stopLineY + 40) {
        for (let s of this.vehicles) {
          if (s.type === 'motorcycle' && s.turn === 'straight' && s.state !== 'in_box') {
            const dx = s.x - v.x;
            const dy = s.y - v.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 42) {
              this.totalConflicts++;
              if (this.conflictMarkers.length < 5) {
                this.conflictMarkers.push({
                  x: (v.x + s.x) * 0.5,
                  y: (v.y + s.y) * 0.5,
                  type: 'right_hook',
                  text: '⚠️ 汽機車右轉交織衝突 (右轉關門/鬼切)',
                  ttl: 35
                });
              }
            }
          }
        }
      }
    } else {
      // In moving dashcam mode: conflict occurs if car cuts across outer lane scooters while lane changing
      if (v.type === 'car' && v.lane === this.laneCount - 1) {
        for (let s of this.vehicles) {
          if (s.type === 'motorcycle' && s.id !== v.id && Math.abs(s.x - v.x) < 22 && Math.abs(s.y - v.y) < 36) {
            this.totalConflicts++;
            if (this.conflictMarkers.length < 5) {
              this.conflictMarkers.push({
                x: (v.x + s.x) * 0.5,
                y: (v.y + s.y) * 0.5,
                type: 'weaving',
                text: '⚠️ 變換車道夾擊衝突',
                ttl: 30
              });
            }
          }
        }
      }
    }

    if (this.waitBoxCount > this.waitBox.maxCap && (this.policy === 'baseline' || this.policy === 'remove_lane_ban')) {
      if (Math.random() < 0.05 && this.conflictMarkers.length < 5) {
        this.totalConflicts++;
        this.conflictMarkers.push({
          x: this.waitBox.x + this.waitBox.w * 0.5,
          y: this.waitBox.y + this.waitBox.h * 0.5,
          type: 'spillover',
          text: '⚠️ 待轉格滿溢！侵入斑馬線與路口車道',
          ttl: 45
        });
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#181A20';
    ctx.fillRect(0, 0, this.width, this.height);

    // Render Dynamic Curving Road
    this.renderDynamicRoad();

    // In moving dashcam mode, render the Ego Camera vehicle
    if (this.roadProfile.is_moving_camera) {
      this.renderEgoCameraVehicle();
    }

    // Render vehicles
    for (let v of this.vehicles) {
      this.renderVehicle(v);
    }

    // Render conflict markers & signal lights
    this.renderConflicts();
    if (!this.roadProfile.is_moving_camera) {
      this.renderSignalLight();
    }
  }

  renderDynamicRoad() {
    const ctx = this.ctx;
    const step = 8;
    const h = this.height;

    // 1. Draw Road Asphalt Polygon following dynamic curve
    ctx.beginPath();
    // Left boundary
    for (let y = 0; y <= h; y += step) {
      const x = this.baseRoadLeft + this.getCurvatureOffset(y);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // Right boundary
    for (let y = h; y >= 0; y -= step) {
      const x = this.baseRoadLeft + this.roadWidth + this.getCurvatureOffset(y);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#2A2C34';
    ctx.fill();

    // 2. If stationary intersection, draw cross street
    if (!this.roadProfile.is_moving_camera) {
      ctx.fillStyle = '#23252C';
      ctx.fillRect(0, this.crossStreetY - 10, this.width, this.height - (this.crossStreetY - 10));
    }

    // 3. Draw Left Double Yellow Line
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const endY = (!this.roadProfile.is_moving_camera) ? this.stopLineY : h;
    for (let y = 0; y <= endY; y += step) {
      const x = this.baseRoadLeft + this.getCurvatureOffset(y);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let y = 0; y <= endY; y += step) {
      const x = this.baseRoadLeft - 4 + this.getCurvatureOffset(y);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 4. Draw Right Solid White Line
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let y = 0; y <= endY; y += step) {
      const x = this.baseRoadLeft + this.roadWidth + this.getCurvatureOffset(y);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 5. Draw Dynamic Lane Divider Lines
    const dashLen = 18;
    const gapLen = 16;
    const cycle = dashLen + gapLen;
    const scroll = this.roadProfile.is_moving_camera ? (this.scrollTravelDistance % cycle) : 0;

    for (let l = 1; l < this.laneCount; l++) {
      const laneXOffset = l * this.laneWidth;
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 2;

      for (let y = -cycle + scroll; y <= endY; y += cycle) {
        if (y + dashLen > 0 && y < endY) {
          ctx.beginPath();
          const y1 = Math.max(0, y);
          const y2 = Math.min(endY, y + dashLen);
          const x1 = this.baseRoadLeft + laneXOffset + this.getCurvatureOffset(y1);
          const x2 = this.baseRoadLeft + laneXOffset + this.getCurvatureOffset(y2);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
    }

    // 6. Draw "禁行機車" Marking on Lane 1
    const l1_base_x = this.baseRoadLeft + this.laneWidth * 0.5;
    const marking_y = this.roadProfile.is_moving_camera ?
                      (((this.scrollTravelDistance * 1.2) % (h + 120)) - 60) :
                      (this.stopLineY * 0.45);

    if (marking_y > -40 && marking_y < h + 40) {
      const curX = l1_base_x + this.getCurvatureOffset(marking_y);
      if (this.policy === 'baseline' || this.policy === 'direct_left_turn') {
        ctx.fillStyle = 'rgba(255, 51, 102, 0.15)';
        ctx.fillRect(this.baseRoadLeft + this.getCurvatureOffset(marking_y), Math.max(0, marking_y - 25), this.laneWidth, 55);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('禁行', curX, marking_y);
        ctx.fillText('機車', curX, marking_y + 18);
      } else {
        ctx.fillStyle = '#00E676';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✓ 開放機車', curX, marking_y);
        ctx.fillText('(車速分流)', curX, marking_y + 16);
      }
    }

    // 7. Stationary Intersection Stop Line & Wait Box
    if (!this.roadProfile.is_moving_camera) {
      const stopCurve = this.getCurvatureOffset(this.stopLineY);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(this.baseRoadLeft + stopCurve, this.stopLineY);
      ctx.lineTo(this.baseRoadLeft + this.roadWidth + stopCurve, this.stopLineY);
      ctx.stroke();

      // Zebra crossing
      ctx.fillStyle = '#FFFFFF';
      for (let zx = this.baseRoadLeft + stopCurve - 10; zx < this.baseRoadLeft + this.roadWidth + stopCurve + 60; zx += 20) {
        ctx.fillRect(zx, this.stopLineY + 12, 12, 24);
      }

      // Wait Box
      const wbX = this.waitBox.x + stopCurve;
      if (this.policy === 'baseline' || this.policy === 'remove_lane_ban') {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.strokeRect(wbX, this.waitBox.y, this.waitBox.w, this.waitBox.h);
        ctx.fillStyle = 'rgba(0, 180, 216, 0.2)';
        ctx.fillRect(wbX, this.waitBox.y, this.waitBox.w, this.waitBox.h);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('機車待轉區', wbX + this.waitBox.w * 0.5, this.waitBox.y + 20);

        if (this.waitBoxCount > this.waitBox.maxCap) {
          ctx.fillStyle = '#FF3366';
          ctx.fillRect(wbX - 5, this.waitBox.y - 18, 90, 16);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '9px sans-serif';
          ctx.fillText('⚠️ 滿溢違規溢出!', wbX + 40, this.waitBox.y - 6);
        }
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(wbX, this.waitBox.y, this.waitBox.w, this.waitBox.h);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(100, 116, 139, 0.8)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('取消強制待轉', wbX + this.waitBox.w * 0.5, this.waitBox.y + 25);
      }
    }
  }

  renderEgoCameraVehicle() {
    const ctx = this.ctx;
    const egoY = this.height - 110;
    // Ego vehicle in outer lane
    const outerLaneCenter = this.laneCenters[this.laneCount - 1];
    const egoX = outerLaneCenter + this.getCurvatureOffset(egoY);

    ctx.save();
    ctx.translate(egoX, egoY);

    // Headlight cone beam
    const grad = ctx.createLinearGradient(0, 0, 0, -120);
    grad.addColorStop(0, 'rgba(255, 255, 200, 0.35)');
    grad.addColorStop(1, 'rgba(255, 255, 200, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(-30, -130);
    ctx.lineTo(30, -130);
    ctx.closePath();
    ctx.fill();

    // Ego Scooter Body
    ctx.fillStyle = '#00F2FE';
    ctx.beginPath();
    ctx.roundRect(-8, -16, 16, 32, 6);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Helmet
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Badge
    ctx.fillStyle = 'rgba(14, 21, 36, 0.9)';
    ctx.fillRect(-45, 22, 90, 16);
    ctx.strokeStyle = '#00F2FE';
    ctx.lineWidth = 1;
    ctx.strokeRect(-45, 22, 90, 16);
    ctx.fillStyle = '#00F2FE';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📹 拍攝行車鏡頭', 0, 34);

    ctx.restore();
  }

  renderVehicle(v) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(v.x, v.y);

    if (v.type === 'motorcycle') {
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.roundRect(-v.w * 0.5, -v.h * 0.5, v.w, v.h, 6);
      ctx.fill();
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -7);
      ctx.lineTo(6, -7);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 200, 0.8)';
      ctx.beginPath();
      ctx.arc(0, -v.h * 0.5 - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = (v.vy < 0.5) ? '#FF0033' : '#990000';
      ctx.beginPath();
      ctx.arc(0, v.h * 0.5 + 1, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (v.type === 'car') {
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.roundRect(-v.w * 0.5, -v.h * 0.5, v.w, v.h, 8);
      ctx.fill();
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#1E293B';
      ctx.fillRect(-v.w * 0.5 + 3, -v.h * 0.5 + 8, v.w - 6, 10);
      ctx.fillRect(-v.w * 0.5 + 3, v.h * 0.5 - 16, v.w - 6, 8);

      if ((v.turn === 'right' || v.turn === 'left') && (this.frameCount % 16 < 8)) {
        ctx.fillStyle = '#FFB800';
        const blinkX = (v.turn === 'right') ? v.w * 0.5 - 2 : -v.w * 0.5 + 2;
        ctx.beginPath();
        ctx.arc(blinkX, -v.h * 0.5 + 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = (v.vy < 0.5) ? '#FF1E44' : '#660000';
      ctx.beginPath();
      ctx.arc(-v.w * 0.5 + 4, v.h * 0.5 - 1, 2.5, 0, Math.PI * 2);
      ctx.arc(v.w * 0.5 - 4, v.h * 0.5 - 1, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.roundRect(-v.w * 0.5, -v.h * 0.5, v.w, v.h, 6);
      ctx.fill();
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#334155';
      for (let wy = -v.h * 0.5 + 12; wy < v.h * 0.5 - 12; wy += 14) {
        ctx.fillRect(-v.w * 0.5 + 3, wy, 5, 8);
        ctx.fillRect(v.w * 0.5 - 8, wy, 5, 8);
      }
    }

    ctx.restore();
  }

  renderConflicts() {
    const ctx = this.ctx;
    const remaining = [];

    for (let c of this.conflictMarkers) {
      c.ttl -= this.speedMultiplier;
      if (c.ttl > 0) {
        const radius = 22 + Math.sin(c.ttl * 0.4) * 6;
        ctx.strokeStyle = '#FF3366';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 51, 102, 0.2)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(c.text, c.x, c.y - radius - 6);

        remaining.push(c);
      }
    }

    this.conflictMarkers = remaining;
  }

  renderSignalLight() {
    const ctx = this.ctx;
    const stopCurve = this.getCurvatureOffset(this.stopLineY);
    const lightX = this.baseRoadLeft + this.roadWidth + stopCurve + 30;
    const lightY = this.stopLineY - 80;

    ctx.fillStyle = '#111827';
    ctx.strokeStyle = '#4B5563';
    ctx.lineWidth = 2;
    ctx.strokeRect(lightX, lightY, 32, 70);
    ctx.fillRect(lightX, lightY, 32, 70);

    ctx.fillStyle = (this.signalState === 'RED') ? '#EF4444' : '#450A0A';
    ctx.beginPath();
    ctx.arc(lightX + 16, lightY + 16, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = (this.signalState === 'YELLOW') ? '#FBBF24' : '#451A03';
    ctx.beginPath();
    ctx.arc(lightX + 16, lightY + 35, 7, 0, Math.PI * 2);
    ctx.fill();

    const isGreen = (this.signalState === 'GREEN' || this.signalState === 'LEFT_ARROW');
    ctx.fillStyle = isGreen ? '#10B981' : '#064E3B';
    ctx.beginPath();
    ctx.arc(lightX + 16, lightY + 54, 7, 0, Math.PI * 2);
    ctx.fill();

    if (this.signalState === 'LEFT_ARROW') {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('↰', lightX + 16, lightY + 57);
    }
  }

  loop() {
    if (this.isPlaying) {
      this.frameCount++;
      this.spawnVehicle();
      this.updateSignals();
      this.updateVehicles();
    }
    this.render();
    requestAnimationFrame(this.loop);
  }
}

window.TrafficIntersectionSim = TrafficIntersectionSim;
