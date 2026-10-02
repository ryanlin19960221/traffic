/**
 * Taiwan Traffic Analysis - Report & Chart.js Visualizations
 * Renders comparative graphs, radar charts, and metrics tables for policy evaluation.
 */

class TrafficReportManager {
  constructor() {
    this.conflictChart = null;
    this.laneDistChart = null;
    this.delayChart = null;
  }

  initCharts(comparisonData) {
    if (!window.Chart) {
      console.warn("Chart.js not loaded yet");
      return;
    }

    this.renderConflictChart(comparisonData);
    this.renderLaneDistributionChart(comparisonData);
    this.renderDelayCapacityChart(comparisonData);
  }

  renderConflictChart(data) {
    const ctx = document.getElementById('chartConflicts');
    if (!ctx) return;

    if (this.conflictChart) this.conflictChart.destroy();

    const scenarios = ['baseline', 'remove_lane_ban', 'direct_left_turn', 'full_reform'];
    const labels = [
      '現行管制 (禁行+待轉)',
      '方案一 (解除禁行機車)',
      '方案二 (取消強制待轉)',
      '方案三 (完全平權最佳化)'
    ];

    const rightHook = scenarios.map(s => data.scenarios[s].conflict_breakdown.right_hook_conflicts);
    const spillover = scenarios.map(s => data.scenarios[s].conflict_breakdown.wait_box_overflow_conflicts);
    const weaving = scenarios.map(s => data.scenarios[s].conflict_breakdown.weaving_conflicts);

    this.conflictChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '汽機車右轉交織衝突 (右轉關門/鬼切)',
            data: rightHook,
            backgroundColor: '#FF3366',
            borderRadius: 6
          },
          {
            label: '待轉格滿溢與側撞風險',
            data: spillover,
            backgroundColor: '#FFB800',
            borderRadius: 6
          },
          {
            label: '公車靠站外側擠壓交織',
            data: weaving,
            backgroundColor: '#00F2FE',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#94A3B8', font: { size: 11, family: 'Inter' } }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#CBD5E1', font: { size: 10 } },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          y: {
            stacked: true,
            title: { display: true, text: '衝突點頻率 (次/千車)', color: '#94A3B8' },
            ticks: { color: '#94A3B8' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        }
      }
    });
  }

  renderLaneDistributionChart(data) {
    const ctx = document.getElementById('chartLaneDist');
    if (!ctx) return;

    if (this.laneDistChart) this.laneDistChart.destroy();

    const scenarios = ['baseline', 'remove_lane_ban', 'direct_left_turn', 'full_reform'];
    const labels = ['現行管制', '方案一(解禁)', '方案二(直接左轉)', '最佳平權'];

    const lane1 = scenarios.map(s => data.scenarios[s].lane_distribution.lane_1_inner.scooter_pct);
    const lane2 = scenarios.map(s => data.scenarios[s].lane_distribution.lane_2_middle.scooter_pct);
    const lane3 = scenarios.map(s => data.scenarios[s].lane_distribution.lane_3_outer.scooter_pct);

    this.laneDistChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '內側車道 (原禁行機車)',
            data: lane1,
            backgroundColor: 'rgba(0, 230, 118, 0.85)',
            borderRadius: 4
          },
          {
            label: '中間車道',
            data: lane2,
            backgroundColor: 'rgba(79, 172, 254, 0.85)',
            borderRadius: 4
          },
          {
            label: '外側慢車道 (易與公車右轉混流)',
            data: lane3,
            backgroundColor: 'rgba(255, 140, 0, 0.85)',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#94A3B8', font: { size: 11 } }
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#CBD5E1', font: { size: 11 } },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          y: {
            stacked: true,
            max: 100,
            title: { display: true, text: '機車車流佔比 (%)', color: '#94A3B8' },
            ticks: { color: '#94A3B8' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        }
      }
    });
  }

  renderDelayCapacityChart(data) {
    const ctx = document.getElementById('chartDelay');
    if (!ctx) return;

    if (this.delayChart) this.delayChart.destroy();

    const scenarios = ['baseline', 'remove_lane_ban', 'direct_left_turn', 'full_reform'];
    const labels = ['現行管制', '方案一(解禁)', '方案二(直接左轉)', '最佳平權'];

    const leftDelay = scenarios.map(s => data.scenarios[s].metrics.left_turn_delay_s);
    const throughput = scenarios.map(s => data.scenarios[s].metrics.throughput_veh_hr);

    this.delayChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '機車左轉平均延滯 (秒)',
            data: leftDelay,
            borderColor: '#FF3366',
            backgroundColor: 'rgba(255, 51, 102, 0.15)',
            fill: true,
            tension: 0.35,
            yAxisID: 'y'
          },
          {
            label: '路口總通行容量 (輛/小時)',
            data: throughput,
            borderColor: '#00E676',
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            pointRadius: 6,
            pointBackgroundColor: '#00E676',
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#94A3B8', font: { size: 11 } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#CBD5E1', font: { size: 11 } },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: '左轉延滯 (秒/車)', color: '#FF3366' },
            ticks: { color: '#FF3366' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: '總通行量 (輛/hr)', color: '#00E676' },
            ticks: { color: '#00E676' }
          }
        }
      }
    });
  }
}

window.TrafficReportManager = TrafficReportManager;
