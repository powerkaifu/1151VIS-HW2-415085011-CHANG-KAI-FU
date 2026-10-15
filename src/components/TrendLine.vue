<script setup>
import * as d3 from 'd3'
import { onMounted, ref, watch } from 'vue'
import { COLOR_MAP } from '../composables/useEnrollmentData.js'

// ========== Props ==========
const props = defineProps({
	/** 趨勢資料陣列（每筆 = { year, ownership, avgRate }） */
	trendData: {
		type: Array,
		required: true,
	},
	/** 目前選取的學年度（用來高亮對應年份垂直線） */
	selectedYear: {
		type: String,
		required: true,
	},
	/** 目前鎖定查看的特定學校名稱 */
	selectedSchool: {
		type: String,
		default: '',
	},
	/** 該選定學校的歷年走勢資料陣列 */
	schoolHistory: {
		type: Array,
		default: () => [],
	},
	/** 退場警戒線 */
	dangerThreshold: {
		type: Number,
		default: 60,
	},
})

// ========== DOM 參照 ==========
const svgRef = ref(null)

// ========== 圖表常數（Margin Convention） ==========
const MARGIN = { top: 36, right: 38, bottom: 56, left: 62 }
const WIDTH = 1000
const HEIGHT = 420

const INNER_W = WIDTH - MARGIN.left - MARGIN.right
const INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom

function cleanName(name) {
	if (!name) return ''
	return name
		.replace(/學校財團法人/g, '')
		.replace(/財團法人/g, '')
		.replace(/(.+?)\1+/g, '$1')
		.trim()
}

// ========== 繪圖邏輯 ==========
function render() {
	if (!svgRef.value || !props.trendData.length) return

	const svg = d3.select(svgRef.value)
	svg.selectAll('*').remove()

	const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

	// 取得所有學年度（升冪）
	const years = [...new Set(props.trendData.map((d) => d.year))].sort((a, b) => Number(a) - Number(b))
	const ownerships = [...new Set(props.trendData.map((d) => d.ownership))]

	// 1️⃣ 比例尺
	const xScale = d3.scalePoint().domain(years).range([0, INNER_W]).padding(0.15)

	// 判斷是否有特定學校且其註冊率較低，自適應 Y 軸
	let minY = 50
	if (props.schoolHistory.length) {
		const minSchoolRate = d3.min(props.schoolHistory, (d) => d.rate)
		if (minSchoolRate && minSchoolRate < 50) minY = Math.max(0, Math.floor(minSchoolRate / 10) * 10)
	}

	const yScale = d3.scaleLinear().domain([minY, 100]).range([INNER_H, 0]).nice()

	// 2️⃣ 水平背景網格線
	g.append('g')
		.attr('class', 'grid-lines')
		.call(d3.axisLeft(yScale).ticks(5).tickSize(-INNER_W).tickFormat(''))
		.selectAll('line')
		.attr('stroke', '#f1f5f9')
		.attr('stroke-width', 1)
	g.select('.grid-lines .domain').remove()

	// 3️⃣ 坐標軸
	g.append('g')
		.attr('class', 'x-axis')
		.attr('transform', `translate(0,${INNER_H})`)
		.call(d3.axisBottom(xScale).tickFormat((y) => `${y}`))

	g.append('g')
		.attr('class', 'y-axis')
		.call(
			d3
				.axisLeft(yScale)
				.ticks(5)
				.tickFormat((d) => `${d}%`),
		)

	// 4️⃣ 坐標軸標籤
	g.append('text')
		.attr('x', INNER_W / 2)
		.attr('y', INNER_H + 44)
		.attr('text-anchor', 'middle')
		.attr('fill', '#475569')
		.attr('font-size', 'var(--font-xs)')
		.attr('font-weight', '600')
		.text('學年度')

	g.append('text')
		.attr('transform', 'rotate(-90)')
		.attr('x', -INNER_H / 2)
		.attr('y', -46)
		.attr('text-anchor', 'middle')
		.attr('fill', '#475569')
		.attr('font-size', 'var(--font-xs)')
		.attr('font-weight', '600')
		.text('新生註冊率（%）')

	// 5️⃣ 退場警戒參考線 (60%)
	if (props.dangerThreshold >= minY) {
		g.append('line')
			.attr('x1', 0)
			.attr('x2', INNER_W)
			.attr('y1', yScale(props.dangerThreshold))
			.attr('y2', yScale(props.dangerThreshold))
			.attr('stroke', '#ef4444')
			.attr('stroke-width', 1.5)
			.attr('stroke-dasharray', '4,4')
	}

	// 6️⃣ 線條生成器
	const lineGen = d3
		.line()
		.x((d) => xScale(d.year))
		.y((d) => yScale(d.avgRate || d.rate))
		.curve(d3.curveMonotoneX)

	// 7️⃣ 繪製公私立平均折線
	for (const ownership of ownerships) {
		const lineData = props.trendData
			.filter((d) => d.ownership === ownership)
			.sort((a, b) => Number(a.year) - Number(b.year))

		const color = COLOR_MAP[ownership] ?? '#94a3b8'

		// 平滑折線
		g.append('path')
			.datum(lineData)
			.attr('fill', 'none')
			.attr('stroke', color)
			.attr('stroke-width', 2.5)
			.attr('stroke-opacity', props.schoolHistory.length ? 0.45 : 0.9)
			.attr('d', lineGen)

		// 資料點
		g.selectAll(`.dot-${ownership}`)
			.data(lineData)
			.join('circle')
			.attr('class', `dot-${ownership}`)
			.attr('cx', (d) => xScale(d.year))
			.attr('cy', (d) => yScale(d.avgRate))
			.attr('r', (d) => (d.year === props.selectedYear ? 6 : 3.5))
			.attr('fill', (d) => (d.year === props.selectedYear ? color : '#ffffff'))
			.attr('stroke', color)
			.attr('stroke-width', (d) => (d.year === props.selectedYear ? 2.5 : 1.8))
			.attr('stroke-opacity', props.schoolHistory.length ? 0.5 : 1)

		// 末端標籤 (顯示於圓點上方，避免右側邊界遮擋)
		const last = lineData[lineData.length - 1]
		if (last) {
			g.append('text')
				.attr('x', xScale(last.year))
				.attr('y', yScale(last.avgRate) - 12)
				.attr('text-anchor', 'middle')
				.attr('font-size', 'var(--font-xs)')
				.attr('fill', color)
				.attr('font-weight', '700')
				.style('paint-order', 'stroke')
				.style('stroke', '#ffffff')
				.style('stroke-width', '3px')
				.style('stroke-linecap', 'round')
				.style('stroke-linejoin', 'round')
				.attr('opacity', props.schoolHistory.length ? 0.7 : 1)
				.text(`${ownership}平均 ${last.avgRate?.toFixed(1)}%`)
		}
	}

	// 8️⃣ 🌟 若選取了特定學校，繪製專屬第三條歷史軌跡！
	if (props.schoolHistory.length > 1) {
		const schoolColor = '#7c3aed' // 鮮明紫色專屬標記

		// 專屬折線
		g.append('path')
			.datum(props.schoolHistory)
			.attr('fill', 'none')
			.attr('stroke', schoolColor)
			.attr('stroke-width', 3.2)
			.attr('d', lineGen)

		// 專屬資料點
		g.selectAll('.dot-school')
			.data(props.schoolHistory)
			.join('circle')
			.attr('class', 'dot-school')
			.attr('cx', (d) => xScale(d.year))
			.attr('cy', (d) => yScale(d.rate))
			.attr('r', (d) => (d.year === props.selectedYear ? 8 : 5))
			.attr('fill', schoolColor)
			.attr('stroke', '#ffffff')
			.attr('stroke-width', 2.2)

		// 末端專屬標籤（智慧垂直避讓 + 白色防重疊光暈描邊）
		const lastSchool = props.schoolHistory[props.schoolHistory.length - 1]
		if (lastSchool) {
			const isNearPublic = lastSchool.rate !== null && lastSchool.rate >= 87
			g.append('text')
				.attr('x', xScale(lastSchool.year))
				.attr('y', isNearPublic ? yScale(lastSchool.rate) + 20 : yScale(lastSchool.rate) - 14)
				.attr('text-anchor', 'middle')
				.attr('font-size', 'var(--font-xs)')
				.attr('fill', schoolColor)
				.attr('font-weight', '700')
				.style('paint-order', 'stroke')
				.style('stroke', '#ffffff')
				.style('stroke-width', '3px')
				.style('stroke-linecap', 'round')
				.style('stroke-linejoin', 'round')
				.text(`★ ${cleanName(props.selectedSchool)} ${lastSchool.rate?.toFixed(1)}%`)
		}
	}

	// 9️⃣ 選取學年度的垂直指示線
	const curX = xScale(props.selectedYear)
	if (curX !== undefined) {
		g.append('line')
			.attr('x1', curX)
			.attr('x2', curX)
			.attr('y1', 0)
			.attr('y2', INNER_H)
			.attr('stroke', 'rgba(37, 99, 235, 0.45)')
			.attr('stroke-width', 1)
			.attr('stroke-dasharray', '2,3')
	}
}

watch(() => [props.trendData, props.selectedYear, props.schoolHistory, props.selectedSchool], render, { deep: false })
onMounted(render)
</script>

<template>
	<div class="trend-card">
		<div class="card-header">
			<div class="header-left">
				<h3 class="chart-title">106～114 學年度公私立平均新生註冊率趨勢</h3>
				<p class="chart-subtitle">
					<span v-if="selectedSchool" class="active-school-text">
						已鎖定：<strong>{{ cleanName(selectedSchool) }}</strong> 9 年歷年走勢對照
					</span>
					<span v-else> 全台大專公私立平均對比 </span>
				</p>
			</div>

			<!-- 🌟 右上角統一圖例與觀察標籤 -->
			<div class="header-right">
				<button v-if="selectedSchool" class="clear-school-btn" @click="$emit('clear-school')">✕ 重設鎖定</button>

				<div class="header-insight-group">
					<div class="header-insight-pill public">
						<span class="badge-public">公立學校</span>
						<span class="insight-summary">106～114 學年度平均走勢</span>
					</div>
					<div class="header-insight-pill private">
						<span class="badge-private">私立學校</span>
						<span class="insight-summary">106～114 學年度平均走勢</span>
					</div>
				</div>
			</div>
		</div>

		<div class="canvas-wrapper">
			<svg ref="svgRef" :width="1000" :height="420" viewBox="0 0 1000 420" class="chart-svg" />
		</div>

		<!-- 鎖定單一學校時保留底部專屬細節觀察 -->
		<div v-if="selectedSchool && schoolHistory.length" class="trend-insight">
			<div class="school-insight-box">
				<span class="box-tag">鎖定校觀察</span>
				<span class="box-text">
					{{ cleanName(selectedSchool) }} 在 {{ selectedYear }} 學年度註冊率為
					<strong>{{ (schoolHistory.find((d) => d.year === selectedYear)?.rate ?? 0).toFixed(2) }}%</strong>
				</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.trend-card {
	background: #ffffff;
	border-radius: 12px;
	border: 1px solid #e2e8f0;
	box-shadow:
		0 4px 6px -1px rgba(0, 0, 0, 0.04),
		0 2px 4px -2px rgba(0, 0, 0, 0.02);
	padding: 24px;
}

.card-header {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	margin-bottom: 16px;
	flex-wrap: wrap;
	gap: 16px;
}

.header-left {
	flex: 1;
	min-width: 280px;
}

.chart-title {
	font-size: var(--font-md);
	font-weight: 700;
	color: #0f172a;
	margin: 0 0 4px 0;
	letter-spacing: -0.01em;
}

.chart-subtitle {
	font-size: var(--font-xs);
	color: #475569;
	margin: 0;
}

.active-school-text strong {
	color: #7c3aed;
}

/* 🌟 右上角統一圖例與觀察標籤群組 */
.header-right {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}

.header-insight-group {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.header-insight-pill {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	background: #f8fafc;
	border: 1px solid #e2e8f0;
	border-radius: 6px;
	padding: 4px 10px;
	font-size: var(--font-xs);
	color: #475569;
}

.header-insight-pill.public {
	border-color: #dbeafe;
	background: #f8fbff;
}

.header-insight-pill.private {
	border-color: #ffedd5;
	background: #fffbf7;
}

.insight-summary {
	line-height: 1.4;
}

.insight-summary strong {
	color: #0f172a;
}

.clear-school-btn {
	background: #f1f5f9;
	border: 1px solid #cbd5e1;
	color: #334155;
	font-size: var(--font-xs);
	padding: 5px 12px;
	border-radius: 6px;
	cursor: pointer;
	transition: all 0.15s ease;
	font-weight: 600;
}

.clear-school-btn:hover {
	background: #e2e8f0;
	color: #0f172a;
}

.canvas-wrapper {
	width: 100%;
	overflow: hidden; /* 🛡️ 徹底禁止畫布內部產生任何水平或垂直捲動軸 */
}

.chart-svg {
	display: block;
	width: 100%;
	height: auto;
}

.trend-insight {
	margin-top: 16px;
	padding-top: 14px;
	border-top: 1px solid #f1f5f9;
}

.school-insight-box {
	display: flex;
	align-items: center;
	gap: 10px;
	background: #faf5ff;
	border: 1px solid #e9d5ff;
	border-radius: 8px;
	padding: 10px 14px;
	font-size: var(--font-xs);
	color: #581c87;
}

.box-tag {
	background: #7c3aed;
	color: #ffffff;
	font-size: var(--font-xs);
	font-weight: 700;
	padding: 2px 7px;
	border-radius: 4px;
}

.box-text strong {
	color: #7c3aed;
	font-size: var(--font-sm);
}

.badge-public,
.badge-private {
	font-size: var(--font-xs);
	font-weight: 700;
	padding: 2px 7px;
	border-radius: 4px;
	white-space: nowrap;
}

.badge-public {
	background: #eff6ff;
	color: #1d4ed8;
}

.badge-private {
	background: #fff7ed;
	color: #c2410c;
}

.insight-text {
	color: #475569;
}

.insight-text strong {
	color: #0f172a;
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
	.trend-card {
		padding: 16px;
	}

	.card-header {
		flex-direction: column;
		align-items: stretch;
		gap: 14px;
	}

	.header-left {
		min-width: unset;
		width: 100%;
	}

	.header-right {
		width: 100%;
		flex-direction: column;
		align-items: stretch;
	}

	.header-insight-group {
		width: 100%;
		gap: 6px;
	}

	.header-insight-pill {
		width: 100%;
		box-sizing: border-box;
	}

	.clear-school-btn {
		width: 100%;
		text-align: center;
	}
}
</style>
