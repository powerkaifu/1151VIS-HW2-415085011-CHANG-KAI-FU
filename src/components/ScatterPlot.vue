<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import { COLOR_MAP } from '../composables/useEnrollmentData.js'

// ========== Emits ==========
const emit = defineEmits(['select-school'])

// ========== Props ==========
const props = defineProps({
  /** 當前學年度的資料陣列（每筆 = 一所學校） */
  data: {
    type: Array,
    required: true,
  },
  /** 選取的學年度字串，例如 '114' */
  year: {
    type: String,
    required: true,
  },
  /** 教育部退場警戒線（預設 60%） */
  dangerThreshold: {
    type: Number,
    default: 60,
  },
  /** 篩選模式：all | public | private | danger */
  filterType: {
    type: String,
    default: 'all',
  },
  /** 目前選取或搜尋的學校名稱 */
  selectedSchool: {
    type: String,
    default: '',
  },
})

// 縮放狀態
const isZoomed = ref(false)

// 計算篩選後是否有有效資料（用於 Empty State）
const filteredCount = computed(() => {
  let d = props.data.filter(d => d.rate !== null && d.quota !== null && d.quota > 0)
  if (props.filterType === 'public') d = d.filter(d => d.ownership === '公立')
  else if (props.filterType === 'private') d = d.filter(d => d.ownership === '私立')
  else if (props.filterType === 'danger') d = d.filter(d => d.rate < props.dangerThreshold)
  return d.length
})

// ========== DOM 參照 ==========
const svgRef = ref(null)
const tooltipRef = ref(null)

// ========== 圖表常數（Margin Convention） ==========
const MARGIN = { top: 32, right: 36, bottom: 64, left: 68 }
const WIDTH  = 1000
const HEIGHT = 520

const INNER_W = WIDTH  - MARGIN.left - MARGIN.right
const INNER_H = HEIGHT - MARGIN.top  - MARGIN.bottom

// 🏷️ 簡化校名
function cleanName(name) {
  if (!name) return ''
  return name.replace(/學校財團法人/g, '').replace(/財團法人/g, '').replace(/(.+?)\1+/g, '$1').trim()
}

// ========== D3 實例與結構變數 ==========
let isInitialized = false
let mainG, gridGroup, dangerGroup, dangerRect, dangerLine, dangerText
let xAxisGroup, yAxisGroup, brushGroup, dotsGroup, brush
let xScale, yScale
let currentXDomain = [0, 10000]
let currentYDomain = [0, 100]

// ========== 初始化圖表結構 ==========
function initChart() {
  if (!svgRef.value || isInitialized) return

  const svg = d3.select(svgRef.value)
  svg.selectAll('*').remove()

  // 1️⃣ 裁切路徑（Clip Path）：確保放大縮放時，圓點與警示色塊不溢出座標軸邊界
  const defs = svg.append('defs')
  defs.append('clipPath')
    .attr('id', 'scatter-clip')
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', INNER_W)
    .attr('height', INNER_H)

  // 2️⃣ 主繪圖群組
  mainG = svg.append('g')
    .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

  // 3️⃣ 水平網格線層
  gridGroup = mainG.append('g')
    .attr('class', 'grid-lines')

  // 4️⃣ 退場警戒區間（裁切範圍內）
  dangerGroup = mainG.append('g')
    .attr('class', 'danger-group')
    .attr('clip-path', 'url(#scatter-clip)')

  dangerRect = dangerGroup.append('rect')
    .attr('x', 0)
    .attr('width', INNER_W)
    .attr('fill', '#ef4444')
    .attr('fill-opacity', 0.04)

  dangerLine = dangerGroup.append('line')
    .attr('x1', 0)
    .attr('x2', INNER_W)
    .attr('stroke', '#ef4444')
    .attr('stroke-width', 1.8)
    .attr('stroke-dasharray', '5,4')

  dangerText = dangerGroup.append('text')
    .attr('x', INNER_W - 6)
    .attr('text-anchor', 'end')
    .attr('fill', '#dc2626')
    .attr('font-size', 'var(--font-xs)')
    .attr('font-weight', '700')
    .text(`⚠️ ${props.dangerThreshold}% 關注門檻`)

  // 5️⃣ 坐標軸刻度層
  xAxisGroup = mainG.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${INNER_H})`)

  yAxisGroup = mainG.append('g')
    .attr('class', 'y-axis')

  // 坐標軸標籤
  mainG.append('text')
    .attr('x', INNER_W / 2)
    .attr('y', INNER_H + 54)
    .attr('text-anchor', 'middle')
    .attr('fill', '#64748b')
    .attr('font-size', 'var(--font-xs)')
    .attr('font-weight', '600')
    .text('核定招生名額（人）')

  mainG.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -INNER_H / 2)
    .attr('y', -54)
    .attr('text-anchor', 'middle')
    .attr('fill', '#64748b')
    .attr('font-size', 'var(--font-xs)')
    .attr('font-weight', '600')
    .text('新生註冊率（%）')

  // 6️⃣ 矩形框選縮放層（Brush Layer，位於圓點層下方，支援滑鼠拖曳框選）
  brush = d3.brush()
    .extent([[0, 0], [INNER_W, INNER_H]])
    .on('start', onBrushStart)
    .on('end', onBrushEnd)

  brushGroup = mainG.append('g')
    .attr('class', 'brush-layer')
    .call(brush)

  // 7️⃣ 學校資料圓點層（裁切範圍內，避免縮放時溢出畫布）
  dotsGroup = mainG.append('g')
    .attr('class', 'dots-layer')
    .attr('clip-path', 'url(#scatter-clip)')

  // 雙擊畫布還原縮放
  svg.on('dblclick', () => {
    resetZoom()
  })

  // 點擊空白處重設選取學校
  svg.on('click', (event) => {
    if (event.target.tagName !== 'circle') {
      resetHighlight()
    }
  })

  // 8️⃣ 直接滾輪縮放監聽（以游標所在位置為中心平滑連續縮放）
  if (svgRef.value) {
    svgRef.value.addEventListener('wheel', onWheel, { passive: false })
  }

  isInitialized = true
}

// ========== 滾輪連續縮放（Direct Mouse Wheel Zooming） ==========
function onWheel(event) {
  if (!xScale || !yScale || !mainG) return
  event.preventDefault()
  hideTooltip()

  // 取得滑鼠在繪圖區中的座標
  const pointer = d3.pointer(event, mainG.node())
  const mx = Math.max(0, Math.min(INNER_W, pointer[0]))
  const my = Math.max(0, Math.min(INNER_H, pointer[1]))

  // 取得游標對應的資料中心點（Focal Point）
  const x0 = xScale.invert(mx)
  const y0 = yScale.invert(my)

  // 縮放係數：向上滾動放大 (0.88)，向下滾動縮小 (1.14)
  const zoomFactor = event.deltaY < 0 ? 0.88 : 1.14

  const maxQuota = d3.max(props.data, d => d.quota) || 10000
  const defaultSpanX = maxQuota * 1.05
  const defaultSpanY = 100

  // 計算新範圍
  let newXMin = x0 - (x0 - currentXDomain[0]) * zoomFactor
  let newXMax = x0 + (currentXDomain[1] - x0) * zoomFactor
  let newYMin = y0 - (y0 - currentYDomain[0]) * zoomFactor
  let newYMax = y0 + (currentYDomain[1] - y0) * zoomFactor

  let newSpanX = newXMax - newXMin
  let newSpanY = newYMax - newYMin

  // 1️⃣ 縮小（Zoom Out）極限保護：不可超越預設全景 [0, defaultSpanX] 與 [0, 100]
  if (zoomFactor > 1) {
    if (newSpanX >= defaultSpanX && newSpanY >= defaultSpanY) {
      currentXDomain = [0, defaultSpanX]
      currentYDomain = [0, 100]
      isZoomed.value = false
      updateChart({ animate: false })
      return
    }
  }

  // 2️⃣ 放大（Zoom In）極限保護：最多放大 10 倍（防止過度放大）
  const minSpanX = defaultSpanX / 10
  const minSpanY = defaultSpanY / 10
  if (newSpanX < minSpanX || newSpanY < minSpanY) {
    return
  }

  // 3️⃣ 邊界對齊校正（Clamp）：X 介於 0 ~ defaultSpanX，Y 介於 0 ~ 100
  if (newXMin < 0) {
    newXMax -= newXMin
    newXMin = 0
  }
  if (newXMax > defaultSpanX && newSpanX < defaultSpanX) {
    newXMin -= (newXMax - defaultSpanX)
    newXMax = defaultSpanX
    if (newXMin < 0) newXMin = 0
  }

  if (newYMin < 0) {
    newYMax -= newYMin
    newYMin = 0
  }
  if (newYMax > 100 && newSpanY < 100) {
    newYMin -= (newYMax - 100)
    newYMax = 100
    if (newYMin < 0) newYMin = 0
  }

  currentXDomain = [newXMin, newXMax]
  currentYDomain = [newYMin, newYMax]

  // 判斷是否處於放大狀態
  const isEssentiallyDefault = (
    Math.abs(currentXDomain[0] - 0) < 1 &&
    Math.abs(currentXDomain[1] - defaultSpanX) < 1 &&
    Math.abs(currentYDomain[0] - 0) < 0.5 &&
    Math.abs(currentYDomain[1] - 100) < 0.5
  )
  isZoomed.value = !isEssentiallyDefault

  // 清除可能殘留的 brush 選擇框
  if (brushGroup) {
    brushGroup.call(brush.move, null)
  }

  // 滾輪連續縮放：採用 0ms 即時平滑更新（零延遲，隨手隨到）
  updateChart({ animate: false })
}

// ========== 框選事件處理（Brush for Zooming） ==========
function onBrushStart() {
  // 框選開始時暫時關閉圓點滑鼠事件，避免拖曳時與圓點 hover/click 衝突
  if (dotsGroup) {
    dotsGroup.selectAll('circle.dot').style('pointer-events', 'none')
  }
  hideTooltip()
}

function onBrushEnd(event) {
  // 框選結束後恢復圓點事件
  if (dotsGroup) {
    dotsGroup.selectAll('circle.dot').style('pointer-events', 'auto')
  }

  const selection = event.selection
  if (!selection) return

  const [[x0, y0], [x1, y1]] = selection

  // 容錯判斷：小於 6px 視為單擊或微小誤觸，不觸發縮放
  if (Math.abs(x1 - x0) < 6 || Math.abs(y1 - y0) < 6) {
    brushGroup.call(brush.move, null)
    return
  }

  // 換算框選矩形對應的新 Domain
  const xA = xScale.invert(x0)
  const xB = xScale.invert(x1)
  const yA = yScale.invert(y1)
  const yB = yScale.invert(y0)

  currentXDomain = [Math.max(0, Math.min(xA, xB)), Math.max(xA, xB)]
  currentYDomain = [Math.max(0, Math.min(yA, yB)), Math.min(100, Math.max(yA, yB))]

  // 清除灰色框選遮罩
  brushGroup.call(brush.move, null)

  isZoomed.value = true
  updateChart({ animate: true })
}

// ========== 還原全景縮放 ==========
function resetZoom() {
  const maxQuota = d3.max(props.data, d => d.quota) || 10000
  currentXDomain = [0, maxQuota * 1.05]
  currentYDomain = [0, 100]
  isZoomed.value = false
  updateChart({ animate: true })
}

// ========== 繪製與平滑動畫更新邏輯 ==========
function updateChart(options = { animate: true }) {
  if (!isInitialized || !props.data.length) return
  const duration = options.animate ? 750 : 0

  // 1️⃣ 過濾有效資料
  let validData = props.data.filter(
    d => d.rate !== null && d.quota !== null && d.quota > 0
  )

  if (props.filterType === 'public') {
    validData = validData.filter(d => d.ownership === '公立')
  } else if (props.filterType === 'private') {
    validData = validData.filter(d => d.ownership === '私立')
  } else if (props.filterType === 'danger') {
    validData = validData.filter(d => d.rate < props.dangerThreshold)
  }

  // 若尚未縮放，更新預設全景 Domain
  if (!isZoomed.value) {
    const maxQuota = d3.max(props.data, d => d.quota) || 10000
    currentXDomain = [0, maxQuota * 1.05]
    currentYDomain = [0, 100]
  }

  // 2️⃣ 比例尺
  xScale = d3.scaleLinear()
    .domain(currentXDomain)
    .range([0, INNER_W])

  yScale = d3.scaleLinear()
    .domain(currentYDomain)
    .range([INNER_H, 0])

  // 3️⃣ 水平背景網格線平滑過渡
  gridGroup.transition().duration(duration)
    .call(
      d3.axisLeft(yScale)
        .ticks(5)
        .tickSize(-INNER_W)
        .tickFormat('')
    )
    .selectAll('line')
    .attr('stroke', '#f1f5f9')
    .attr('stroke-width', 1)
  gridGroup.select('.domain').remove()

  // 4️⃣ 坐標軸刻度平滑過渡
  xAxisGroup.transition().duration(duration)
    .call(
      d3.axisBottom(xScale)
        .ticks(6)
        .tickFormat(d => d >= 10000 ? `${d / 1000}k` : d.toLocaleString())
    )

  yAxisGroup.transition().duration(duration)
    .call(
      d3.axisLeft(yScale)
        .ticks(8)
        .tickFormat(d => `${d}%`)
    )

  // 5️⃣ 60% 退場警戒區間動態更新
  const dangerY = yScale(props.dangerThreshold)
  dangerRect.transition().duration(duration)
    .attr('y', Math.max(0, dangerY))
    .attr('height', Math.max(0, INNER_H - dangerY))

  dangerLine.transition().duration(duration)
    .attr('y1', dangerY)
    .attr('y2', dangerY)

  dangerText.transition().duration(duration)
    .attr('y', dangerY - 10)

  // 6️⃣ 圓點資料綁定與平滑補間動畫（Animated Transitions）
  const hasSelected = !!props.selectedSchool

  const dots = dotsGroup.selectAll('circle.dot')
    .data(validData, d => d.schoolCode || cleanName(d.schoolName))

  // 離開的圓點：平滑淡出並縮小
  dots.exit()
    .transition().duration(options.animate ? 400 : 0)
    .attr('r', 0)
    .attr('fill-opacity', 0)
    .remove()

  // 新進入的圓點
  const enterDots = dots.enter()
    .append('circle')
    .attr('class', 'dot')
    .attr('cx', d => xScale(d.quota))
    .attr('cy', d => yScale(d.rate))
    .attr('r', 0)
    .attr('fill', d => COLOR_MAP[d.ownership] ?? '#94a3b8')
    .attr('fill-opacity', 0)
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 1)
    .attr('cursor', 'pointer')
    .on('click', function (event, d) {
      event.stopPropagation()
      emit('select-school', d.schoolName)
    })
    .on('mouseover', function (event, d) {
      highlightTarget(d.schoolName, d)
    })
    .on('mouseleave', function () {
      resetHighlight()
    })

  // 合併更新與新進入的圓點：平滑移動至新座標
  const merged = enterDots.merge(dots)

  merged.transition().duration(duration)
    .attr('cx', d => xScale(d.quota))
    .attr('cy', d => yScale(d.rate))
    .attr('r', d => (hasSelected && d.schoolName === props.selectedSchool) ? 10 : 6)
    .attr('fill', d => COLOR_MAP[d.ownership] ?? '#94a3b8')
    .attr('fill-opacity', d => {
      if (!hasSelected) return 0.8
      return d.schoolName === props.selectedSchool ? 1 : 0.15
    })
    .attr('stroke', d => (hasSelected && d.schoolName === props.selectedSchool) ? '#0f172a' : '#ffffff')
    .attr('stroke-width', d => (hasSelected && d.schoolName === props.selectedSchool) ? 2.5 : 1)
}

// ========== Tooltip 與焦點互動 ==========
const tooltip = computed(() => d3.select(tooltipRef.value))

function showTooltip(d) {
  const badgeStyle = getBadgeMeta(d.rateGroup)
  tooltip.value
    .style('opacity', 1)
    .html(`
      <div class="tip-header">
        <span class="tip-title">${cleanName(d.schoolName)}</span>
        <span class="tip-badge" style="background:${badgeStyle.bg}; color:${badgeStyle.color};">${d.rateGroup}</span>
      </div>
      <div class="tip-meta">${d.ownership} · ${d.schoolType}</div>
      <div class="tip-divider"></div>
      <div class="tip-grid">
        <span class="tip-lbl">新生註冊率</span>
        <span class="tip-val highlight" style="color:${d.rate < 60 ? '#f87171' : (d.rate < 80 ? '#fbbf24' : '#ffffff')}">${d.rate?.toFixed(2)}%</span>
        <span class="tip-lbl">核定名額</span>
        <span class="tip-val">${d.quota?.toLocaleString()} 人</span>
        <span class="tip-lbl">實際註冊</span>
        <span class="tip-val">${d.enrolled?.toLocaleString()} 人</span>
        <span class="tip-lbl">名額差額</span>
        <span class="tip-val">${d.deficit !== null ? (d.deficit > 0 ? `-${d.deficit.toLocaleString()}` : '0') : '無'} 人</span>
      </div>
      <div class="tip-action-hint">👆 點擊查看 9 年歷年走勢</div>
    `)

  const svgEl = svgRef.value
  const rect = svgEl ? svgEl.getBoundingClientRect() : { width: WIDTH, height: HEIGHT }
  const scaleX = rect.width / WIDTH
  const scaleY = rect.height / HEIGHT

  const realCx = (xScale(d.quota) + MARGIN.left) * scaleX
  const realCy = (yScale(d.rate) + MARGIN.top) * scaleY
  const tipWidth = Math.min(300, rect.width - 24)
  const tipHeight = 220

  let left = realCx + 18
  if (left + tipWidth > rect.width - 12) {
    left = realCx - tipWidth - 18
  }
  if (left < 12) left = 12

  let top = realCy - tipHeight / 2
  if (top < 12) top = 12
  if (top + tipHeight > rect.height - 12) {
    top = rect.height - tipHeight - 12
  }

  tooltip.value
    .style('left', `${left}px`)
    .style('top',  `${top}px`)
}

function hideTooltip() {
  if (tooltipRef.value) {
    tooltip.value.style('opacity', 0)
  }
}

function highlightTarget(schoolName, d) {
  if (!dotsGroup) return
  dotsGroup.selectAll('circle.dot')
    .attr('fill-opacity', 0.15)
    .attr('stroke-opacity', 0.2)
  
  dotsGroup.selectAll('circle.dot')
    .filter(dot => dot.schoolName === schoolName)
    .raise()
    .attr('r', 11)
    .attr('fill-opacity', 1)
    .attr('stroke', '#0f172a')
    .attr('stroke-width', 2.8)
    .attr('stroke-opacity', 1)
    .style('filter', 'drop-shadow(0 0 6px rgba(37, 99, 235, 0.7))')

  showTooltip(d)
}

function resetHighlight() {
  if (!dotsGroup) return
  const hasSelected = !!props.selectedSchool
  dotsGroup.selectAll('circle.dot')
    .attr('r', d => (hasSelected && d.schoolName === props.selectedSchool) ? 10 : 6)
    .attr('fill-opacity', d => {
      if (!hasSelected) return 0.8
      return d.schoolName === props.selectedSchool ? 1 : 0.15
    })
    .attr('stroke', d => (hasSelected && d.schoolName === props.selectedSchool) ? '#0f172a' : '#ffffff')
    .attr('stroke-width', d => (hasSelected && d.schoolName === props.selectedSchool) ? 2.5 : 1)
    .attr('stroke-opacity', 1)
    .style('filter', 'none')

  hideTooltip()
}

function getBadgeMeta(level) {
  if (level === '未達 60%') return { bg: '#fee2e2', color: '#991b1b' }
  if (level === '60% ~ 80%') return { bg: '#fef3c7', color: '#92400e' }
  return { bg: '#dcfce7', color: '#166534' }
}

// 監聽生命週期與屬性變化
onMounted(() => {
  initChart()
  updateChart({ animate: false })
})

onUnmounted(() => {
  if (svgRef.value) {
    svgRef.value.removeEventListener('wheel', onWheel)
  }
})

// 學年度切換：平滑還原全景縮放，各校圓點補間滑動至新年度座標
watch(() => props.year, () => {
  if (isZoomed.value) {
    isZoomed.value = false
    const maxQuota = d3.max(props.data, d => d.quota) || 10000
    currentXDomain = [0, maxQuota * 1.05]
    currentYDomain = [0, 100]
  }
  updateChart({ animate: true })
})

// 篩選模式切換
watch(() => props.filterType, () => {
  updateChart({ animate: true })
})

// 選取特定學校
watch(() => props.selectedSchool, () => {
  resetHighlight()
})

// 資料集更新（例如剛載入完畢）
watch(() => props.data, () => {
  if (!isInitialized) initChart()
  updateChart({ animate: false })
}, { deep: false })
</script>

<template>
  <div class="scatter-card">
    <div class="card-header">
      <div class="header-left">
        <div class="title-row">
          <h2 class="chart-title">各校招生規模與新生註冊率分佈</h2>
          <span v-if="isZoomed" class="zoom-badge">🔍 局部特寫檢視中</span>
        </div>
        <p class="chart-subtitle">
          懸停查看學校明細 · <span class="highlight-action">點擊任一點查看歷年走勢</span> ·
          <span class="brush-hint">按住左鍵「框選矩形」或「滾動滑鼠滾輪」可直接局部放大特寫</span>
        </p>
      </div>

      <!-- 卡片頂部圖例與控制項 -->
      <div class="header-right">
        <!-- ⟲ 重設縮放按鈕 -->
        <button
          v-if="isZoomed"
          class="reset-zoom-btn"
          title="雙擊畫布或點擊此處還原全景"
          @click="resetZoom"
        >
          <span class="btn-icon">⟲</span>
          重設縮放 (Reset Zoom)
        </button>

        <div class="header-legend">
          <span class="legend-item">
            <span class="legend-dot public"></span>
            公立學校
          </span>
          <span class="legend-item">
            <span class="legend-dot private"></span>
            私立學校
          </span>
          <span class="legend-item">
            <span class="legend-line danger"></span>
            60% 關注線
          </span>
        </div>
      </div>
    </div>

    <!-- SVG 畫布區域 -->
    <div class="canvas-wrapper">
      <svg
        ref="svgRef"
        :width="1000"
        :height="520"
        viewBox="0 0 1000 520"
        class="chart-svg"
        :style="{ opacity: filteredCount === 0 ? 0 : 1 }"
      />

      <!-- 空狀態提示（篩選後無資料） -->
      <div v-if="filteredCount === 0" class="empty-state">
        <span class="empty-icon">📊</span>
        <p class="empty-text">此學年度無符合篩選條件的學校資料</p>
        <p class="empty-sub">請嘗試切換學年度或調整快速篩選條件</p>
      </div>

      <!-- 現代深色毛玻璃 Tooltip -->
      <div
        ref="tooltipRef"
        class="modern-tooltip"
      />
    </div>
  </div>
</template>

<style scoped>
.scatter-card {
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.04), 0 2px 4px -2px rgba(0, 0, 0, 0.02);
  padding: 24px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.chart-title {
  font-size: var(--font-md);
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.01em;
}

.zoom-badge {
  display: inline-flex;
  align-items: center;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 6px;
  border: 1px solid #bfdbfe;
}

.chart-subtitle {
  font-size: var(--font-xs);
  color: #475569;
  margin: 0;
  line-height: 1.5;
}

.highlight-action {
  color: #2563eb;
  font-weight: 600;
}

.brush-hint {
  color: #0d9488;
  font-weight: 600;
}

/* 卡片右上方圖例與狀態列 */
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* ⟲ 重設縮放按鈕 */
.reset-zoom-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: var(--font-xs);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.reset-zoom-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1e40af;
  transform: translateY(-1px);
}

.reset-zoom-btn:active {
  transform: translateY(0);
}

.btn-icon {
  font-size: 15px;
  font-weight: 700;
}

.header-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 6px 14px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--font-xs);
  font-weight: 600;
  color: #334155;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.legend-dot.public {
  background: #4575b4;
}
.legend-dot.private {
  background: #f46d43;
}

.legend-line.danger {
  width: 18px;
  height: 0;
  display: inline-block;
  border-top: 2px dashed #ef4444;
}

.canvas-wrapper {
  position: relative;
  width: 100%;
  overflow: hidden; /* 徹底禁止畫布內部產生任何水平或垂直捲動軸 */
}

.chart-svg {
  display: block;
  width: 100%;
  height: auto;
}

/* D3 Brush 樣式 */
:deep(.brush-layer .overlay) {
  cursor: crosshair;
}

:deep(.brush-layer .selection) {
  fill: #3b82f6;
  fill-opacity: 0.16;
  stroke: #2563eb;
  stroke-width: 1.5;
  stroke-dasharray: 4, 3;
}

/* 空狀態提示卡片 */
.empty-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  padding: 32px 48px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  pointer-events: none;
}

.empty-icon {
  font-size: 36px;
  display: block;
  margin-bottom: 12px;
}

.empty-text {
  font-size: var(--font-sm);
  font-weight: 600;
  color: #334155;
  margin: 0 0 6px 0;
}

.empty-sub {
  font-size: var(--font-xs);
  color: #94a3b8;
  margin: 0;
}

/* 現代深冷毛玻璃 Tooltip (舒適字級) */
.modern-tooltip {
  position: absolute;
  pointer-events: none;
  opacity: 0;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #f8fafc;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 14px 16px;
  font-size: var(--font-xs);
  line-height: 1.55;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
  transition: opacity 0.15s ease;
  z-index: 50;
  width: min(300px, calc(100vw - 48px));
  box-sizing: border-box;
}

:deep(.tip-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

:deep(.tip-title) {
  font-weight: 700;
  font-size: var(--font-base);
  color: #ffffff;
  line-height: 1.35;
}

:deep(.tip-badge) {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
}

:deep(.tip-meta) {
  font-size: var(--font-xs);
  color: #94a3b8;
  margin-bottom: 8px;
}

:deep(.tip-divider) {
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
  margin-bottom: 8px;
}

:deep(.tip-grid) {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
}

:deep(.tip-lbl) {
  color: #94a3b8;
  font-size: var(--font-xs);
}

:deep(.tip-val) {
  text-align: right;
  font-weight: 600;
  color: #f8fafc;
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}

:deep(.tip-val.highlight) {
  font-size: var(--font-sm);
  font-weight: 700;
}

:deep(.tip-action-hint) {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.18);
  font-size: var(--font-xs);
  color: #93c5fd;
  text-align: center;
}

:deep(.x-axis text),
:deep(.y-axis text) {
  font-size: var(--font-xs);
  font-weight: 500;
  fill: #475569;
}

:deep(.x-axis path),
:deep(.y-axis path),
:deep(.x-axis line),
:deep(.y-axis line) {
  stroke: #cbd5e1;
}

/* 📱 行動端與直向平板 RWD */
@media (max-width: 768px) {
  .scatter-card {
    padding: 16px;
  }

  .card-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .header-right {
    justify-content: space-between;
  }

  .header-legend {
    flex: 1;
    justify-content: space-around;
    padding: 8px 10px;
  }
}
</style>
