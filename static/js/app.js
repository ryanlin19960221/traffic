/**
 * Taiwan Traffic & Motorcycle Equity Analysis - Main Application Controller
 * Handles synchronized real-time YOLO video playback and video-driven top-down simulation.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  const state = {
    currentTab: 'tab-video',
    currentPolicy: 'baseline',
    isSplitView: false,
    simRateScooter: 2200,
    simRateCar: 1400,
    simInstanceMain: null,
    simInstanceCompare: null,
    reportManager: new TrafficReportManager(),
    cachedComparisonData: null,
    
    // Video Player & Vision Timeline State
    currentAnalysisData: null,
    currentVideoProfile: null,
    videoTimeline: [],
    videoMarkings: null,
    videoDuration: 5.0,
    videoFps: 25,
    isVideoPlaying: false,
    videoCurrentTime: 0,
    videoPlaybackRate: 1.0,
    sampledFrames: [], // fallback frame player
    useFramePlayer: false,
    framePlayerTimer: null
  };

  // DOM Elements
  const tabButtons = document.querySelectorAll('.nav-tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('videoFileInput');
  const btnBrowse = document.getElementById('btnBrowseFile');
  const progressCard = document.getElementById('progressCard');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressLabel = document.getElementById('progressLabel');
  const progressPct = document.getElementById('progressPct');

  // Vision Display & Video Player Elements
  const visionResultsContainer = document.getElementById('visionResultsContainer');
  const uploadedVideo = document.getElementById('uploadedVideo');
  const videoOverlayCanvas = document.getElementById('videoOverlayCanvas');
  const videoPlayerContainer = document.getElementById('videoPlayerContainer');
  const videoSourceTitle = document.getElementById('videoSourceTitle');
  const videoSourceMeta = document.getElementById('videoSourceMeta');
  const playerTimestamp = document.getElementById('playerTimestamp');
  const videoTimelineScrubber = document.getElementById('videoTimelineScrubber');
  const btnVideoPlayPause = document.getElementById('btnVideoPlayPause');
  const btnVideoRestart = document.getElementById('btnVideoRestart');
  const btnVideoSpeed = document.getElementById('btnVideoSpeed');
  const chkShowBBoxes = document.getElementById('chkShowBBoxes');
  const chkShowMarkings = document.getElementById('chkShowMarkings');
  const chkShowConflicts = document.getElementById('chkShowConflicts');
  const liveConflictBanner = document.getElementById('liveConflictBanner');
  const hudLiveCounts = document.getElementById('hudLiveCounts');

  // KPI Elements
  const valTotalVehicles = document.getElementById('valTotalVehicles');
  const valScooterRatio = document.getElementById('valScooterRatio');
  const valCarRatio = document.getElementById('valCarRatio');
  const valConflictCount = document.getElementById('valConflictCount');
  const laneOuterBar = document.getElementById('laneOuterBar');
  const laneOuterPct = document.getElementById('laneOuterPct');
  const laneMiddleBar = document.getElementById('laneMiddleBar');
  const laneMiddlePct = document.getElementById('laneMiddlePct');
  const laneInnerBar = document.getElementById('laneInnerBar');
  const laneInnerPct = document.getElementById('laneInnerPct');

  // Simulation Elements
  const btnPlayPause = document.getElementById('btnPlayPause');
  const btnReset = document.getElementById('btnReset');
  const btnSpeed = document.getElementById('btnSpeed');
  const btnToggleSplit = document.getElementById('btnToggleSplit');
  const policyBtns = document.querySelectorAll('.policy-btn');
  const sliderScooter = document.getElementById('sliderScooter');
  const sliderScooterVal = document.getElementById('sliderScooterVal');
  const sliderCar = document.getElementById('sliderCar');
  const sliderCarVal = document.getElementById('sliderCarVal');
  const simThroughputVal = document.getElementById('simThroughputVal');
  const simConflictVal = document.getElementById('simConflictVal');
  const simWaitBoxVal = document.getElementById('simWaitBoxVal');
  const simVideoTitleText = document.getElementById('simVideoTitleText');
  const simVideoSubText = document.getElementById('simVideoSubText');
  const btnReplayVideoTraffic = document.getElementById('btnReplayVideoTraffic');
  const btnSendToSim = document.getElementById('btnSendToSim');
  const btnNextStepSim = document.getElementById('btnNextStepSim');

  // ================= TAB NAVIGATION =================
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  function switchTab(tabId) {
    state.currentTab = tabId;
    tabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
    tabPanels.forEach(p => p.classList.toggle('active', p.id === tabId));

    if (tabId === 'tab-simulation') {
      initSimulationInstances();
      // Pass video profile to simulation instances
      if (state.currentVideoProfile) {
        applyVideoProfileToSimulations(state.currentVideoProfile);
      }
    } else if (tabId === 'tab-report') {
      loadComparisonReport();
    }
  }

  // Next Step Buttons
  if (btnSendToSim) btnSendToSim.addEventListener('click', () => switchTab('tab-simulation'));
  if (btnNextStepSim) btnNextStepSim.addEventListener('click', () => switchTab('tab-simulation'));

  // ================= VIDEO UPLOAD & SAMPLES =================
  btnBrowse.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // Set native video source for direct playback
      const objectUrl = URL.createObjectURL(file);
      state.localVideoUrl = objectUrl;
      uploadAndAnalyze(file);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const objectUrl = URL.createObjectURL(file);
      state.localVideoUrl = objectUrl;
      uploadAndAnalyze(file);
    }
  });

  // Pre-loaded Sample Buttons
  document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sampleId = btn.getAttribute('data-sample');
      state.localVideoUrl = `/static/samples/${sampleId}`;
      analyzeSampleVideo(sampleId);
    });
  });

  async function uploadAndAnalyze(file) {
    showProgress("正在上傳影片至後端分析伺服器...", 15);
    const formData = new FormData();
    formData.append('file', file);

    try {
      simulateProgressSequence();
      const res = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.status === 'success') {
        finishProgress("影片分析完成！正在啟動即時 YOLO 播放器...", () => initVideoPlayerWithData(data.data, file.name));
      } else {
        alert("分析失敗: " + (data.detail || "未知錯誤"));
        hideProgress();
      }
    } catch (err) {
      console.error(err);
      alert("網路連線或伺服器錯誤: " + err.message);
      hideProgress();
    }
  }

  async function analyzeSampleVideo(sampleId) {
    showProgress("載入路況示範影片並啟動 YOLO 視覺辨識模型...", 20);
    try {
      simulateProgressSequence();
      const res = await fetch('/api/analyze-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_id: sampleId })
      });
      const data = await res.json();
      if (data.status === 'success') {
        finishProgress("AI 標線與車種辨識完成！正在啟動即時 YOLO 播放器...", () => initVideoPlayerWithData(data.data, sampleId));
      } else {
        alert("分析示範影片失敗");
        hideProgress();
      }
    } catch (err) {
      console.error(err);
      alert("示範影片載入錯誤: " + err.message);
      hideProgress();
    }
  }

  function showProgress(msg, startPct = 10) {
    progressCard.style.display = 'block';
    progressLabel.textContent = msg;
    progressPct.textContent = `${startPct}%`;
    progressBarFill.style.width = `${startPct}%`;
  }

  function simulateProgressSequence() {
    let p = 25;
    const interval = setInterval(() => {
      if (p < 85) {
        p += Math.floor(Math.random() * 15) + 5;
        if (p > 85) p = 85;
        progressBarFill.style.width = `${p}%`;
        progressPct.textContent = `${p}%`;
        if (p > 40 && p <= 65) {
          progressLabel.textContent = "執行 YOLO 模型：正在逐幀辨識機車、客車、大貨車與公車...";
        } else if (p > 65) {
          progressLabel.textContent = "分析標線幾何：標註禁行機車車道與兩段式待轉格位置...";
        }
      } else {
        clearInterval(interval);
      }
    }, 350);
  }

  function finishProgress(msg, callback) {
    progressBarFill.style.width = `100%`;
    progressPct.textContent = `100%`;
    progressLabel.textContent = msg;
    setTimeout(() => {
      progressCard.style.display = 'none';
      if (callback) callback();
    }, 500);
  }

  function hideProgress() {
    progressCard.style.display = 'none';
  }

  // ================= REAL-TIME YOLO VIDEO PLAYER =================
  function initVideoPlayerWithData(data, filename) {
    state.currentAnalysisData = data;
    state.currentVideoProfile = data.video_traffic_profile;
    state.videoTimeline = data.timeline || [];
    state.videoMarkings = data.road_markings;
    state.videoFps = data.video_metadata.fps || 25;
    state.videoDuration = data.video_metadata.duration_sec || 5.0;
    state.sampledFrames = data.sampled_frames || [];

    // Show container
    visionResultsContainer.style.display = 'block';
    visionResultsContainer.scrollIntoView({ behavior: 'smooth' });

    // Update Banner & Metadata
    videoSourceTitle.textContent = `正在播放影片：《${filename}》`;
    videoSourceMeta.textContent = `解析度: ${data.video_metadata.resolution} | 幀率: ${state.videoFps} FPS | 辨識到 ${data.vehicle_statistics.total_detected} 輛車（機車 ${data.vehicle_statistics.ratios.motorcycle}%）`;

    // Update KPI stats
    valTotalVehicles.textContent = data.vehicle_statistics.total_detected;
    valScooterRatio.textContent = `${data.vehicle_statistics.ratios.motorcycle}%`;
    valCarRatio.textContent = `${data.vehicle_statistics.ratios.car}%`;
    valConflictCount.textContent = data.traffic_conflict_diagnostics.right_hook_conflicts_detected;

    // Update Lane Distribution Bars
    const l1 = data.lane_analysis.lane_1_inner.scooter_flow_ratio;
    const l2 = data.lane_analysis.lane_2_middle.scooter_flow_ratio;
    const l3 = data.lane_analysis.lane_3_outer.scooter_flow_ratio;

    laneInnerBar.style.width = `${l1}%`;
    laneInnerPct.textContent = `${l1}% (禁行機車)`;

    laneMiddleBar.style.width = `${l2}%`;
    laneMiddlePct.textContent = `${l2}%`;

    laneOuterBar.style.width = `${l3}%`;
    laneOuterPct.textContent = `${l3}% (極度過載)`;

    const diagDesc = document.getElementById('diagSummaryText');
    if (diagDesc) {
      diagDesc.textContent = data.traffic_conflict_diagnostics.summary;
    }

    // Configure Real-time Video / Frame Player
    setupVideoPlayback(data, filename);
  }

  function setupVideoPlayback(data, filename) {
    const overlayCanvas = videoOverlayCanvas;
    const ctx = overlayCanvas.getContext('2d');

    // Resize overlay canvas to match container
    function syncCanvasSize() {
      const rect = videoPlayerContainer.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      overlayCanvas.width = rect.width * dpr;
      overlayCanvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    syncCanvasSize();
    window.addEventListener('resize', syncCanvasSize);

    // If we have sampled frames (pre-rendered by backend with OpenCV)
    // we can use the high-performance Frame Player which guarantees 100% video format compatibility!
    if (state.sampledFrames && state.sampledFrames.length > 5) {
      state.useFramePlayer = true;
      uploadedVideo.style.display = 'none'; // hide native video
      initFramePlayer();
    } else {
      // Use native HTML5 video element with overlay
      state.useFramePlayer = false;
      uploadedVideo.style.display = 'block';
      if (state.localVideoUrl) {
        uploadedVideo.src = state.localVideoUrl;
        uploadedVideo.play().catch(() => {});
        state.isVideoPlaying = true;
      }
      initNativeVideoOverlayLoop();
    }
  }

  // --- Frame Player Engine (Guaranteed 100% cross-browser codec compatibility) ---
  function initFramePlayer() {
    if (state.framePlayerTimer) cancelAnimationFrame(state.framePlayerTimer);

    const canvas = videoOverlayCanvas;
    const ctx = canvas.getContext('2d');
    const frames = state.sampledFrames;
    const totalFrames = frames.length;
    let currentIdx = 0;
    let lastTime = performance.now();
    const frameInterval = 1000 / (state.videoFps * state.videoPlaybackRate);

    // Pre-cache HTML images
    const imageObjects = frames.map(f => {
      const img = new Image();
      img.src = f.src;
      return img;
    });

    state.isVideoPlaying = true;
    btnVideoPlayPause.innerHTML = '⏸️';

    function renderFrameLoop(now) {
      if (state.isVideoPlaying) {
        const delta = now - lastTime;
        if (delta >= (1000 / (state.videoFps * state.videoPlaybackRate))) {
          lastTime = now;
          currentIdx = (currentIdx + 1) % totalFrames;
          state.videoCurrentTime = currentIdx / state.videoFps;
          
          // Update scrubber
          videoTimelineScrubber.value = (currentIdx / totalFrames) * 100;
          updatePlayerTimestampDisplay(state.videoCurrentTime, totalFrames / state.videoFps);
        }
      }

      // Draw current frame
      const currentImg = imageObjects[currentIdx];
      const rect = videoPlayerContainer.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      if (currentImg && currentImg.complete) {
        ctx.drawImage(currentImg, 0, 0, rect.width, rect.height);
      }

      // Draw dynamic YOLO boxes and markings if enabled
      drawYOLOOverlaysForFrame(ctx, currentIdx, rect.width, rect.height);

      state.framePlayerTimer = requestAnimationFrame(renderFrameLoop);
    }

    state.framePlayerTimer = requestAnimationFrame(renderFrameLoop);

    // Timeline Scrubber
    videoTimelineScrubber.oninput = (e) => {
      const pct = parseFloat(e.target.value) / 100;
      currentIdx = Math.floor(pct * (totalFrames - 1));
      state.videoCurrentTime = currentIdx / state.videoFps;
      updatePlayerTimestampDisplay(state.videoCurrentTime, totalFrames / state.videoFps);
    };
  }

  // --- Native Video Overlay Loop (for native mp4/webm uploads) ---
  function initNativeVideoOverlayLoop() {
    const canvas = videoOverlayCanvas;
    const ctx = canvas.getContext('2d');

    function overlayLoop() {
      if (!uploadedVideo.paused && !uploadedVideo.ended) {
        state.videoCurrentTime = uploadedVideo.currentTime;
        const dur = uploadedVideo.duration || state.videoDuration;
        videoTimelineScrubber.value = (state.videoCurrentTime / dur) * 100;
        updatePlayerTimestampDisplay(state.videoCurrentTime, dur);

        const currentFrameIdx = Math.floor(state.videoCurrentTime * state.videoFps);
        const rect = videoPlayerContainer.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);

        // Draw overlays
        drawYOLOOverlaysForFrame(ctx, currentFrameIdx, rect.width, rect.height);
      }
      requestAnimationFrame(overlayLoop);
    }
    requestAnimationFrame(overlayLoop);

    videoTimelineScrubber.oninput = (e) => {
      const pct = parseFloat(e.target.value) / 100;
      uploadedVideo.currentTime = pct * (uploadedVideo.duration || state.videoDuration);
    };
  }

  function drawYOLOOverlaysForFrame(ctx, frameIdx, viewW, viewH) {
    const timeline = state.videoTimeline;
    if (!timeline || timeline.length === 0) return;

    const frameData = timeline[frameIdx % timeline.length];
    if (!frameData) return;

    const vehicles = frameData.vehicles || [];
    const conflicts = frameData.conflicts || [];

    // Update HUD text
    let motoC = 0, carC = 0, busC = 0;
    vehicles.forEach(v => {
      if (v.type === 'motorcycle') motoC++;
      else if (v.type === 'car') carC++;
      else busC++;
    });
    hudLiveCounts.textContent = `🛵 機車 ${motoC} 輛 | 🚗 客車 ${carC} 輛 | 🚌 大車 ${busC} 輛`;

    // 1. Draw Road Markings & Prohibited Zone if checked
    if (chkShowMarkings.checked && state.videoMarkings) {
      const pZone = state.videoMarkings.prohibited_lane.zone;
      const wBox = state.videoMarkings.wait_box.box;
      const origW = state.videoMarkings.image_size.width;
      const origH = state.videoMarkings.image_size.height;

      // Draw Prohibited Lane 1 Corridor
      const px1 = (pZone.x_min / origW) * viewW;
      const px2 = (pZone.x_max / origW) * viewW;
      const py1 = (pZone.y_min / origH) * viewH;
      const py2 = (pZone.y_max / origH) * viewH;

      ctx.fillStyle = 'rgba(255, 51, 102, 0.15)';
      ctx.fillRect(px1, py1, px2 - px1, py2 - py1);
      ctx.strokeStyle = 'rgba(255, 51, 102, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px1, py1, px2 - px1, py2 - py1);

      // Draw Hook-turn Wait Box
      const bx = (wBox.x / origW) * viewW;
      const by = (wBox.y / origH) * viewH;
      const bw = (wBox.w / origW) * viewW;
      const bh = (wBox.h / origH) * viewH;

      ctx.fillStyle = 'rgba(255, 184, 0, 0.18)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#FFB800';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
    }

    // 2. Draw YOLO Bounding Boxes if checked
    if (chkShowBBoxes.checked) {
      for (let v of vehicles) {
        const [nx, ny, nw, nh] = v.bbox_norm;
        const x = nx * viewW;
        const y = ny * viewH;
        const w = nw * viewW;
        const h = nh * viewH;

        let boxColor = '#00F2FE';
        if (v.type === 'motorcycle') boxColor = '#FF8C00';
        else if (v.type === 'car') boxColor = '#00B4D8';
        else if (v.type === 'bus') boxColor = '#00E676';

        // Draw bounding box
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Corner accents
        ctx.fillStyle = boxColor;
        const cLen = Math.min(8, w * 0.25);
        ctx.fillRect(x, y, cLen, 2);
        ctx.fillRect(x, y, 2, cLen);
        ctx.fillRect(x + w - cLen, y, cLen, 2);
        ctx.fillRect(x + w - 2, y, 2, cLen);

        // Badge label
        const labelText = `${v.type_label} ${Math.round(v.confidence * 100)}%`;
        ctx.font = 'bold 11px sans-serif';
        const txtWidth = ctx.measureText(labelText).width;
        ctx.fillStyle = boxColor;
        ctx.fillRect(x, Math.max(0, y - 18), txtWidth + 8, 18);
        ctx.fillStyle = '#0F172A';
        ctx.fillText(labelText, x + 4, Math.max(12, y - 4));
      }
    }

    // 3. Draw Conflict Indicator if checked
    if (chkShowConflicts.checked && conflicts.length > 0) {
      liveConflictBanner.style.display = 'block';
      for (let cf of conflicts) {
        const [cnx, cny] = cf.location_norm;
        const cx = cnx * viewW;
        const cy = cny * viewH;

        ctx.strokeStyle = '#FF3366';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 28, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 51, 102, 0.3)';
        ctx.beginPath();
        ctx.arc(cx, cy, 28, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('! 汽機車右轉交織衝突 !', cx, cy - 34);
      }
    } else {
      liveConflictBanner.style.display = 'none';
    }
  }

  function updatePlayerTimestampDisplay(curr, total) {
    const curMin = Math.floor(curr / 60).toString().padStart(2, '0');
    const curSec = (curr % 60).toFixed(2).padStart(5, '0');
    const totMin = Math.floor(total / 60).toString().padStart(2, '0');
    const totSec = (total % 60).toFixed(2).padStart(5, '0');
    playerTimestamp.textContent = `${curMin}:${curSec} / ${totMin}:${totSec}`;
  }

  // Play / Pause Video Controls
  btnVideoPlayPause.addEventListener('click', () => {
    state.isVideoPlaying = !state.isVideoPlaying;
    btnVideoPlayPause.innerHTML = state.isVideoPlaying ? '⏸️' : '▶️';
    btnVideoPlayPause.classList.toggle('active', state.isVideoPlaying);

    if (!state.useFramePlayer) {
      if (state.isVideoPlaying) uploadedVideo.play();
      else uploadedVideo.pause();
    }
  });

  btnVideoRestart.addEventListener('click', () => {
    state.videoCurrentTime = 0;
    videoTimelineScrubber.value = 0;
    if (!state.useFramePlayer) uploadedVideo.currentTime = 0;
  });

  const videoSpeeds = [1.0, 1.5, 2.0, 0.5];
  let vSpeedIdx = 0;
  btnVideoSpeed.addEventListener('click', () => {
    vSpeedIdx = (vSpeedIdx + 1) % videoSpeeds.length;
    const spd = videoSpeeds[vSpeedIdx];
    state.videoPlaybackRate = spd;
    btnVideoSpeed.textContent = `${spd}x`;
    if (!state.useFramePlayer) uploadedVideo.playbackRate = spd;
  });

  // ================= TAB 2: TOP-DOWN SIMULATION (DIRECTLY CONSUMING UPLOADED VIDEO) =================
  function initSimulationInstances() {
    if (!state.simInstanceMain) {
      state.simInstanceMain = new TrafficIntersectionSim('simCanvasMain', {
        policy: state.currentPolicy,
        scooterRate: state.simRateScooter,
        carRate: state.simRateCar,
        videoProfile: state.currentVideoProfile
      });

      setInterval(() => {
        if (state.simInstanceMain) {
          simThroughputVal.textContent = state.simInstanceMain.totalThroughput;
          simConflictVal.textContent = state.simInstanceMain.totalConflicts;
          simWaitBoxVal.textContent = `${state.simInstanceMain.waitBoxCount} 輛`;
        }
      }, 500);
    }
  }

  function applyVideoProfileToSimulations(profile) {
    if (!profile) return;
    const rp = profile.road_profile || {};
    const motionStr = rp.is_moving_camera 
      ? `🚗 偵測為行車視角動態影片 (移動速度約 ${rp.camera_speed_kmh || 35} km/h, 彎道趨勢: ${rp.road_curvature === 'curve_right' ? '向右彎' : rp.road_curvature === 'curve_left' ? '向左彎' : '直線'})，路徑與標線動態滾動前進！`
      : `🚦 偵測為固定路口俯視角度 (${rp.lane_count || 3} 線道幾何)`;
    simVideoTitleText.textContent = `俯視模擬數據來源：已成功載入您上傳的影片《${profile.source_video}》`;
    simVideoSubText.innerHTML = `提取車輛時空動線：機車 ${profile.scooter_ratio_pct}%、汽車 ${profile.car_ratio_pct}%、外側過載率 ${profile.outer_lane_scooter_pct}% | <span style="color:var(--accent-cyan); font-weight:600;">${motionStr}</span>`;

    sliderScooterVal.textContent = `${state.simRateScooter} 輛/hr`;
    sliderCarVal.textContent = `${state.simRateCar} 輛/hr`;

    if (state.simInstanceMain) {
      state.simInstanceMain.setVideoProfile(profile);
    }
    if (state.simInstanceCompare) {
      state.simInstanceCompare.setVideoProfile(profile);
    }
  }

  // Replay video traffic button
  if (btnReplayVideoTraffic) {
    btnReplayVideoTraffic.addEventListener('click', () => {
      if (state.simInstanceMain) state.simInstanceMain.reset();
      if (state.simInstanceCompare) state.simInstanceCompare.reset();
    });
  }

  // Sim Play / Pause
  btnPlayPause.addEventListener('click', () => {
    if (!state.simInstanceMain) return;
    const isPlaying = !state.simInstanceMain.isPlaying;
    state.simInstanceMain.isPlaying = isPlaying;
    if (state.simInstanceCompare) state.simInstanceCompare.isPlaying = isPlaying;

    btnPlayPause.innerHTML = isPlaying ? '⏸️' : '▶️';
    btnPlayPause.classList.toggle('active', !isPlaying);
  });

  // Sim Reset
  btnReset.addEventListener('click', () => {
    if (state.simInstanceMain) state.simInstanceMain.reset();
    if (state.simInstanceCompare) state.simInstanceCompare.reset();
  });

  // Sim Speed
  const speeds = [1.0, 2.0, 4.0, 0.5];
  let speedIdx = 0;
  btnSpeed.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    const spd = speeds[speedIdx];
    btnSpeed.textContent = `${spd}x`;
    if (state.simInstanceMain) state.simInstanceMain.speedMultiplier = spd;
    if (state.simInstanceCompare) state.simInstanceCompare.speedMultiplier = spd;
  });

  // Policy Switcher
  policyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-policy');
      state.currentPolicy = p;
      policyBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (state.simInstanceMain) {
        state.simInstanceMain.setPolicy(p);
      }

      const vpTitle = document.getElementById('viewportMainTitle');
      const vName = state.currentVideoProfile ? state.currentVideoProfile.source_video : "上傳影片";
      if (vpTitle) {
        const names = {
          'baseline': `🔴 現行管制方案 (《${vName}》原況還原：內側禁行 + 強制待轉)`,
          'remove_lane_ban': `🟡 方案一 (若《${vName}》解除禁行機車：機車可騎內線)`,
          'direct_left_turn': `🔵 方案二 (若《${vName}》取消待轉：機車直接左轉)`,
          'full_reform': `🟢 最佳平權方案 (《${vName}》完全改革：車速分流 + 偏心左轉道)`
        };
        vpTitle.textContent = names[p] || btn.textContent;
      }
    });
  });

  // Simulation Sliders
  sliderScooter.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.simRateScooter = val;
    sliderScooterVal.textContent = `${val} 輛/hr`;
    if (state.simInstanceMain) state.simInstanceMain.scooterRate = val;
    if (state.simInstanceCompare) state.simInstanceCompare.scooterRate = val;
  });

  sliderCar.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.simRateCar = val;
    sliderCarVal.textContent = `${val} 輛/hr`;
    if (state.simInstanceMain) state.simInstanceMain.carRate = val;
    if (state.simInstanceCompare) state.simInstanceCompare.carRate = val;
  });

  // Split View (Dual Side-by-Side Comparison)
  btnToggleSplit.addEventListener('click', () => {
    state.isSplitView = !state.isSplitView;
    const wrapper = document.getElementById('canvasWrapper');
    const compareCard = document.getElementById('compareViewportCard');

    if (state.isSplitView) {
      wrapper.classList.add('split-view');
      compareCard.style.display = 'block';
      btnToggleSplit.classList.add('active');
      btnToggleSplit.textContent = '關閉雙畫面對比';

      if (!state.simInstanceCompare) {
        state.simInstanceCompare = new TrafficIntersectionSim('simCanvasCompare', {
          policy: 'full_reform',
          scooterRate: state.simRateScooter,
          carRate: state.simRateCar,
          videoProfile: state.currentVideoProfile
        });
      } else if (state.currentVideoProfile) {
        state.simInstanceCompare.setVideoProfile(state.currentVideoProfile);
      }
    } else {
      wrapper.classList.remove('split-view');
      compareCard.style.display = 'none';
      btnToggleSplit.classList.remove('active');
      btnToggleSplit.textContent = '雙畫面同步對比';
    }
  });

  // ================= TAB 3: REPORT & CHARTS =================
  async function loadComparisonReport() {
    if (state.cachedComparisonData) {
      state.reportManager.initCharts(state.cachedComparisonData);
      return;
    }

    try {
      const res = await fetch('/api/comparison-report');
      const json = await res.json();
      if (json.status === 'success') {
        state.cachedComparisonData = json.data;
        state.reportManager.initCharts(json.data);
      }
    } catch (err) {
      console.error("Failed to load comparison report:", err);
    }
  }

  const btnPrint = document.getElementById('btnPrintReport');
  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      window.print();
    });
  }

  // Pre-load default video profile from backend on page startup
  fetch('/api/latest-video-profile')
    .then(r => r.json())
    .then(d => {
      if (d.status === 'success' && d.data) {
        state.currentVideoProfile = d.data;
      }
    })
    .catch(() => {});
});
