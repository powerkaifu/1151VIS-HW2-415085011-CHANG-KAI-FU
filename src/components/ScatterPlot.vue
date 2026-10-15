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
const CLIP_PAD = 14 // 容納圓點半徑 (一般 6px，Hover/聚焦時 11px，徹底杜絕邊界截斷)

// 🏷️ 簡化校名
function cleanName(name) {
  if (!name) return ''
  return name.replace(/學校財團法人/g, '').replace(/財團法人/g, '').replace(/(.+?)\1+/g, '$1').trim()
}

// 📐 取得預設全景 Domain（給予頂端與左右足夠的視覺呼吸緩衝，徹底避免 100% 滿分校或邊界圓點被截斷）
function getDefaultDomains() {
  const maxQuota = d3.max(props.data, d => d.quota) || 10000
  // X 軸向左預留 2.5% 呼吸緩衝，向右預留 6% 空間
  const xDom = [-maxQuota * 0.025, maxQuota * 1.06]
  // Y 軸頂端向上預留 4% 空間 (0 ~ 104%)，讓 100% 註冊率的滿分學校圓點完整優雅地呈現
  const yDom = [0, 104]
  return { xDom, yDom, maxQuota }
}

// ========== D3 實例與結構變數 ==========
let isInitialized = false
let mainG, gridGroup, dangerGroup, dangerRect, dangerLine, dangerText
let xAxisGroup, yAxisGroup, dotsGroup
let xScale, yScale
let currentXDomain = [0, 10000]
let currentYDomain = [0, 104]

// 手掌平移拖曳狀態變數（Photoshop Pan）
let isPanning = false
let hasDragged = false
let panStartClientX = 0, panStartClientY = 0
let panStartXDomain = [0, 10000], panStartYDomain = [0, 104]
let singleClickTimer = null
let cachedDefaultDomains = null

// ========== 初始化圖表結構 ==========
function initChart() {
  if (!svgRef.value || isInitialized) return

  const svg = d3.select(svgRef.value)
  svg.selectAll('*').remove()

  // 1️⃣ 裁切路徑（Clip Path）：包含 CLIP_PAD 緩衝區，確保圓點在邊界處完整呈現、放大縮放時不溢出畫布
  const defs = svg.append('defs')
  defs.append('clipPath')
    .attr('id', 'scatter-clip')
    .append('rect')
    .attr('x', -CLIP_PAD)
    .attr('y', -CLIP_PAD)
    .attr('width', INNER_W + CLIP_PAD * 2)
    .attr('height', INNER_H + CLIP_PAD * 2)

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

  // 6️⃣ 學校資料圓點層（裁切範圍內，避免縮放時溢出畫布）
  dotsGroup = mainG.append('g')
    .attr('class', 'dots-layer')
    .attr('clip-path', 'url(#scatter-clip)')

  // 雙擊畫布還原縮放（具備單擊計時防抖，絕不誤抹除選定學校）
  svg.on('dblclick', () => {
    if (singleClickTimer) {
      clearTimeout(singleClickTimer)
      singleClickTimer = null
    }
    resetZoom()
  })

  // 點擊空白處重設選取學校（延遲 220ms，並在雙擊時自動取消）
  svg.on('click', (event) => {
    if (event.detail > 1) return // 忽略雙擊序列產生的第二個 click
    if (hasDragged) return
    const isCircle = event.target.tagName === 'circle' || event.target.classList?.contains('dot')
    if (!isCircle) {
      if (singleClickTimer) clearTimeout(singleClickTimer)
      singleClickTimer = setTimeout(() => {
        if (props.selectedSchool) {
          emit('select-school', '')
        }
        resetHighlight()
        singleClickTimer = null
      }, 220)
    }
  })

  // 7️⃣ 直接滾輪縮放監聽（以游標所在位置為中心平滑連續縮放）
  if (svgRef.value) {
    svgRef.value.addEventListener('wheel', onWheel, { passive: false })
  }

  // 8️⃣ 手掌平移拖曳監聽（Photoshop 式流暢拖曳）
  svg.on('mousedown', onMouseDown)
  window.addEventListener('mousemove', onGlobalMouseMove)
  window.addEventListener('mouseup', onGlobalMouseUp)
  window.addEventListener('blur', onWindowBlur)

  isInitialized = true
}

// ========== 視窗失去焦點保護（防止滑鼠按住切換視窗時狀態殘留） ==========
function onWindowBlur() {
  if (isPanning) {
    isPanning = false
    hasDragged = false
    if (dotsGroup) {
      dotsGroup.style('pointer-events', 'auto')
    }
  }
}

// ========== 拖曳平移處理（Pan & Drag） ==========
function onMouseDown(event) {
  if (event.button !== 0) return // 僅限滑鼠左鍵平移

  isPanning = true
  hasDragged = false
  panStartClientX = event.clientX
  panStartClientY = event.clientY
  panStartXDomain = [...currentXDomain]
  panStartYDomain = [...currentYDomain]
  cachedDefaultDomains = getDefaultDomains()
}

function onGlobalMouseMove(event) {
  if (!isPanning || !svgRef.value) return

  const dx = event.clientX - panStartClientX
  const dy = event.clientY - panStartClientY

  // 移動超過 4px 確認為拖曳行為，此時才暫時關閉圓點事件防止 Tooltip 閃爍
  if (Math.hypot(dx, dy) > 4) {
    hasDragged = true
    if (dotsGroup) {
      dotsGroup.style('pointer-events', 'none')
    }
    hideTooltip()
  }

  // 🛡️ 全景未放大狀態下鎖定平移，防止圖表被拖離畫布產生大片空白
  if (!isZoomed.value) return

  const rect = svgRef.value.getBoundingClientRect()
  const scaleX = rect.width / WIDTH
  const scaleY = rect.height / HEIGHT

  const dataDx = (dx / scaleX) * (panStartXDomain[1] - panStartXDomain[0]) / INNER_W
  const dataDy = (dy / scaleY) * (panStartYDomain[1] - panStartYDomain[0]) / INNER_H

  let newXMin = panStartXDomain[0] - dataDx
  let newXMax = panStartXDomain[1] - dataDx
  let newYMin = panStartYDomain[0] + dataDy
  let newYMax = panStartYDomain[1] + dataDy

  // 邊界防跑出視野保護：嚴格鎖定在全景範圍內（0% 溢出），防止使用者拖曳迷失在空白區
  const { xDom, yDom } = cachedDefaultDomains || getDefaultDomains()

  if (newXMin < xDom[0]) {
    newXMax += (xDom[0] - newXMin)
    newXMin = xDom[0]
  }
  if (newXMax > xDom[1]) {
    newXMin -= (newXMax - xDom[1])
    newXMax = xDom[1]
  }

  if (newYMin < yDom[0]) {
    newYMax += (yDom[0] - newYMin)
    newYMin = yDom[0]
  }
  if (newYMax > yDom[1]) {
    newYMin -= (newYMax - yDom[1])
    newYMax = yDom[1]
  }

  currentXDomain = [newXMin, newXMax]
  currentYDomain = [newYMin, newYMax]

  updateChart({ animate: false })
}

function onGlobalMouseUp() {
  if (!isPanning) return
  isPanning = false
  if (dotsGroup) {
    dotsGroup.style('pointer-events', 'auto')
  }
  setTimeout(() => {
    hasDragged = false
  }, 80)
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

  const { xDom, yDom } = getDefaultDomains()
  const defaultSpanX = xDom[1] - xDom[0]
  const defaultSpanY = yDom[1] - yDom[0]

  // 計算新範圍
  let newXMin = x0 - (x0 - currentXDomain[0]) * zoomFactor
  let newXMax = x0 + (currentXDomain[1] - x0) * zoomFactor
  let newYMin = y0 - (y0 - currentYDomain[0]) * zoomFactor
  let newYMax = y0 + (currentYDomain[1] - y0) * zoomFactor

  let newSpanX = newXMax - newXMin
  let newSpanY = newYMax - newYMin

  // 1️⃣ 縮小（Zoom Out）極限保護：不可超越預設全景 [xDom[0], xDom[1]] 與 [yDom[0], yDom[1]]
  if (zoomFactor > 1) {
    if (newSpanX >= defaultSpanX * 0.98 || newSpanY >= defaultSpanY * 0.98) {
      currentXDomain = [...xDom]
      currentYDomain = [...yDom]
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

  // 3️⃣ 邊界對齊校正（Clamp）：X 介於 xDom[0] ~ xDom[1]，Y 介於 yDom[0] ~ yDom[1]
  if (newXMin < xDom[0]) {
    newXMax -= (newXMin - xDom[0])
    newXMin = xDom[0]
  }
  if (newXMax > xDom[1] && newSpanX < defaultSpanX) {
    newXMin -= (newXMax - xDom[1])
    newXMax = xDom[1]
    if (newXMin < xDom[0]) newXMin = xDom[0]
  }

  if (newYMin < yDom[0]) {
    newYMax -= (newYMin - yDom[0])
    newYMin = yDom[0]
  }
  if (newYMax > yDom[1] && newSpanY < defaultSpanY) {
    newYMin -= (newYMax - yDom[1])
    newYMax = yDom[1]
    if (newYMin < yDom[0]) newYMin = yDom[0]
  }

  currentXDomain = [newXMin, newXMax]
  currentYDomain = [newYMin, newYMax]

  // 判斷是否處於放大狀態
  const isEssentiallyDefault = (
    Math.abs(currentXDomain[0] - xDom[0]) < 1 &&
    Math.abs(currentXDomain[1] - xDom[1]) < 1 &&
    Math.abs(currentYDomain[0] - yDom[0]) < 0.5 &&
    Math.abs(currentYDomain[1] - yDom[1]) < 0.5
  )
  isZoomed.value = !isEssentiallyDefault

  // 滾輪連續縮放：採用 0ms 即時平滑更新（零延遲，隨手隨到）
  updateChart({ animate: false })
}

// ========== 還原全景縮放 ==========
function resetZoom() {
  const { xDom, yDom } = getDefaultDomains()
  currentXDomain = [...xDom]
  currentYDomain = [...yDom]
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
    const { xDom, yDom } = getDefaultDomains()
    currentXDomain = [...xDom]
    currentYDomain = [...yDom]
  }

  // 2️⃣ 比例尺
  xScale = d3.scaleLinear()
    .domain(currentXDomain)
    .range([0, INNER_W])

  yScale = d3.scaleLinear()
    .domain(currentYDomain)
    .range([INNER_H, 0])

  // 3️⃣ 水平背景網格線平滑過渡（全景時對齊 0~100%，放大時自適應）
  const gridAxis = d3.axisLeft(yScale).tickSize(-INNER_W).tickFormat('')
  if (isZoomed.value) {
    gridAxis.ticks(6)
  } else {
    gridAxis.tickValues([0, 20, 40, 60, 80, 100])
  }
  gridGroup.transition().duration(duration)
    .call(gridAxis)
    .selectAll('line')
    .attr('stroke', '#f1f5f9')
    .attr('stroke-width', 1)
  gridGroup.select('.domain').remove()

  // 4️⃣ 坐標軸刻度平滑過渡
  const xAxis = d3.axisBottom(xScale).ticks(6)
    .tickFormat(d => d < 0 ? '' : (d >= 10000 ? `${d / 1000}k` : d.toLocaleString()))
  xAxisGroup.transition().duration(duration).call(xAxis)

  const yAxis = d3.axisLeft(yScale)
  if (isZoomed.value) {
    yAxis.ticks(8).tickFormat(d => `${d.toFixed(d % 1 === 0 ? 0 : 1)}%`)
  } else {
    yAxis.tickValues([0, 20, 40, 60, 80, 100]).tickFormat(d => `${d}%`)
  }
  yAxisGroup.transition().duration(duration).call(yAxis)

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

  // 合併更新與新進入的圓點：平滑移動至新座標並綁定互動事件
  const merged = enterDots.merge(dots)
    .attr('cursor', 'pointer')
    .on('click', function (event, d) {
      if (hasDragged) return
      event.stopPropagation()
      emit('select-school', d.schoolName)
      highlightTarget(d.schoolName, d)
    })
    .on('mouseover', function (event, d) {
      if (hasDragged) return
      highlightTarget(d.schoolName, d)
    })
    .on('mouseleave', function () {
      if (hasDragged) return
      resetHighlight()
    })

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
  window.removeEventListener('mousemove', onGlobalMouseMove)
  window.removeEventListener('mouseup', onGlobalMouseUp)
  window.removeEventListener('blur', onWindowBlur)
  if (singleClickTimer) {
    clearTimeout(singleClickTimer)
    singleClickTimer = null
  }
})

// 學年度切換：平滑還原全景縮放，各校圓點補間滑動至新年度座標
watch(() => props.year, () => {
  if (isZoomed.value) {
    isZoomed.value = false
    const { xDom, yDom } = getDefaultDomains()
    currentXDomain = [...xDom]
    currentYDomain = [...yDom]
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
          <span class="direct-hint">
            🖱️ <strong>直接互動：</strong>滾輪縮放 · 拖曳平移 · 雙擊重設全景
          </span>
        </p>
      </div>

      <!-- 卡片頂部圖例與控制項 -->
      <div class="header-right">
        <!-- ⟲ 重設縮放按鈕（僅在特寫時出現） -->
        <button
          v-if="isZoomed"
          class="reset-zoom-btn"
          title="雙擊畫布空白處或點擊此處還原全景"
          @click="resetZoom"
        >
          <span class="btn-icon">⟲</span>
          重設全景 (Reset Zoom)
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

.direct-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #f1f5f9;
  color: #334155;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: var(--font-xs);
  font-weight: 500;
  margin-left: 4px;
}

.direct-hint strong {
  color: #1e293b;
  font-weight: 700;
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
  user-select: none;
  -webkit-user-select: none;
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
