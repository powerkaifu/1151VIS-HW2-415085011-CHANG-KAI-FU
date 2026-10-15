<script setup>
import { computed, ref, watch } from 'vue'
import ScatterPlot from './components/ScatterPlot.vue'
import TrendLine from './components/TrendLine.vue'
import { useEnrollmentData } from './composables/useEnrollmentData.js'

// 📊 載入資料 Composable
const {
	isLoading,
	error,
	availableYears,
	getDataByYear,
	getSchoolHistory,
	cleanSchoolName,
	trendData,
	THRESHOLD_DANGER,
	THRESHOLD_WARNING,
} = useEnrollmentData()

// 📅 當前選取學年度
const selectedYear = ref('')

// 🔘 當前過濾模式：all | public | private | danger
const filterType = ref('all')

// 🔍 搜尋與選取的特定學校名稱
const searchQuery = ref('')
const selectedSchool = ref('')
const searchNoResult = ref(false) // 🆕 搜尋無結果旗標

// ✅ 資料載入完成後預設最新年度
watch(
	availableYears,
	(years) => {
		if (years.length && !selectedYear.value) {
			selectedYear.value = years[0]
		}
	},
	{ immediate: true },
)

// 📋 當前學年度全部資料
const currentYearData = computed(() => (selectedYear.value ? getDataByYear(selectedYear.value) : []))

// 📋 當前學年度的可選學校清單（供搜尋自動匹配）
const schoolOptions = computed(() => {
	return currentYearData.value.map((d) => ({
		raw: d.schoolName,
		clean: cleanSchoolName(d.schoolName),
		ownership: d.ownership,
	}))
})

// 📈 當前學年度統計摘要
const summaryStats = computed(() => {
	const data = currentYearData.value.filter((d) => d.rate !== null)
	if (!data.length) return null

	const totalSchools = data.length
	const dangerSchools = data.filter((d) => d.rate < THRESHOLD_DANGER).length
	const warningSchools = data.filter((d) => d.rate >= THRESHOLD_DANGER && d.rate < THRESHOLD_WARNING).length

	const avgRate = data.reduce((acc, cur) => acc + cur.rate, 0) / totalSchools

	const pub = data.filter((d) => d.ownership === '公立')
	const pri = data.filter((d) => d.ownership === '私立')
	const pubAvg = pub.length ? pub.reduce((acc, c) => acc + c.rate, 0) / pub.length : 0
	const priAvg = pri.length ? pri.reduce((acc, c) => acc + c.rate, 0) / pri.length : 0

	return {
		totalSchools,
		dangerSchools,
		warningSchools,
		publicSchools: pub.length,
		privateSchools: pri.length,
		avgRate: avgRate.toFixed(1),
		pubAvg: pubAvg.toFixed(1),
		priAvg: priAvg.toFixed(1),
		gap: (pubAvg - priAvg).toFixed(1),
	}
})

// 📰 動態數據新聞導讀洞察（Editorial Storytelling）
const editorialInsight = computed(() => {
	if (!summaryStats.value) return ''
	const s = summaryStats.value
	return `${selectedYear.value} 學年度全台共有 ${s.totalSchools} 所大專校院。公立學校平均註冊率為 ${s.pubAvg}%，私立學校平均為 ${s.priAvg}%，兩者相差 ${s.gap} 個百分點；另有 ${s.dangerSchools} 所學校註冊率未達 60% 關注門檻。`
})

// 📈 當前選定學校的 9 年歷史資料
const currentSchoolHistory = computed(() => {
	if (!selectedSchool.value) return []
	return getSchoolHistory(selectedSchool.value)
})

// 🎯 選取學校處理
function handleSelectSchool(schoolName) {
	selectedSchool.value = schoolName
	searchQuery.value = cleanSchoolName(schoolName)
}

// 搜尋輸入監聽
function handleSearchInput() {
	searchNoResult.value = false
	if (!searchQuery.value.trim()) {
		selectedSchool.value = ''
		return
	}
	const match = currentYearData.value.find((d) =>
		cleanSchoolName(d.schoolName).toLowerCase().includes(searchQuery.value.trim().toLowerCase()),
	)
	if (match) {
		selectedSchool.value = match.schoolName
		searchNoResult.value = false
	} else {
		selectedSchool.value = ''
		searchNoResult.value = true // 🆕 觸發無結果提示
	}
}

// 清除選取
function clearSelectedSchool() {
	selectedSchool.value = ''
	searchQuery.value = ''
	searchNoResult.value = false // 🆕 同步重置
}
</script>

<template>
	<div class="app-layout">
		<!-- 頂部頁頭 -->
		<header class="app-header">
			<div class="header-content">
				<div class="header-main">
					<h1 class="page-title">台灣大專校院新生註冊率視覺化分析</h1>
					<div class="page-subtitle">
						<p class="subtitle-question">
							少子化下，學校招生真的招得到學生嗎？升學選校時，又該如何看懂一所學校的招生狀況？
						</p>
						<p class="subtitle-description">
							透過 106～114 學年度全台大專校院新生註冊率資料，從公私立分佈、招生規模、長期趨勢與 60% 關注門檻切入，幫助使用者快速理解各校招生狀況與歷年變化。
						</p>
					</div>
				</div>
				<div class="author-meta">
					<div class="course-label">資料分析與視覺化應用 · HW02</div>
					<div class="student-info">415085011 張凱富</div>
				</div>
			</div>
		</header>

		<!-- 載入中 -->
		<div v-if="isLoading" class="state-container">
			<div class="loading-spinner"></div>
			<p class="state-text">正在載入新生註冊率資料…</p>
		</div>

		<!-- 錯誤 -->
		<div v-else-if="error" class="state-container error">
			<div class="error-icon">⚠️</div>
			<p class="state-text">{{ error }}</p>
		</div>

		<!-- 主要內容區 -->
		<main v-else class="main-body">
			<!-- 📰 深度數據新聞導讀區塊（Editorial Hero） -->
			<section v-if="summaryStats" class="editorial-card">
				<div class="editorial-icon">📌</div>
				<div class="editorial-content">
					<div class="editorial-tag">核心局勢觀察 · {{ selectedYear }} 學年度</div>
					<p class="editorial-text">{{ editorialInsight }}</p>
				</div>
			</section>

			<!-- 關鍵指標卡片群（Hero KPI Stat Cards - 純展示數據摘要） -->
			<section v-if="summaryStats" class="kpi-grid">
				<div class="kpi-card">
					<div class="kpi-header">
						<span class="kpi-title">大專校院總數</span>
					</div>
					<div class="kpi-value-row">
						<span class="kpi-num">{{ summaryStats.totalSchools }}</span>
						<span class="kpi-unit">所</span>
					</div>
					<div class="kpi-desc">
						公立 {{ summaryStats.publicSchools }} 所 · 私立 {{ summaryStats.privateSchools }} 所
					</div>
				</div>

				<div class="kpi-card highlight">
					<div class="kpi-header">
						<span class="kpi-title">公立學校平均</span>
					</div>
					<div class="kpi-value-row">
						<span class="kpi-num text-primary">{{ summaryStats.pubAvg }}</span>
						<span class="kpi-unit">%</span>
					</div>
					<div class="kpi-desc">共 {{ summaryStats.publicSchools }} 所公立學校</div>
				</div>

				<div class="kpi-card warning">
					<div class="kpi-header">
						<span class="kpi-title">私立學校平均</span>
					</div>
					<div class="kpi-value-row">
						<span class="kpi-num text-warning">{{ summaryStats.priAvg }}</span>
						<span class="kpi-unit">%</span>
					</div>
					<div class="kpi-desc">與公立平均差距 {{ summaryStats.gap }} 個百分點</div>
				</div>

				<div class="kpi-card danger">
					<div class="kpi-header">
						<span class="kpi-title">未達 60% 學校</span>
					</div>
					<div class="kpi-value-row">
						<span class="kpi-num text-danger">{{ summaryStats.dangerSchools }}</span>
						<span class="kpi-unit">所</span>
					</div>
					<div class="kpi-desc">低於 60% 關注門檻</div>
				</div>
			</section>

			<!-- 🎛️ 綜合控制列（學年度 + 膠囊過濾 + 學校搜尋探針） -->
			<section class="toolbar-card">
				<div class="toolbar-left">
					<!-- 學年度下拉 -->
					<div class="tool-item">
						<label for="year-select" class="tool-label">學年度</label>
						<div class="select-wrapper">
							<select id="year-select" v-model="selectedYear" class="custom-select">
								<option v-for="y in availableYears" :key="y" :value="y">{{ y }} 學年度</option>
							</select>
							<span class="select-arrow">▾</span>
						</div>
					</div>

					<!-- 分段膠囊過濾器 -->
					<div class="tool-item">
						<span class="tool-label">快速篩選</span>
						<div class="pill-group">
							<button class="pill-btn" :class="{ active: filterType === 'all' }" @click="filterType = 'all'">
								全部
							</button>
							<button class="pill-btn" :class="{ active: filterType === 'public' }" @click="filterType = 'public'">
								僅看公立
							</button>
							<button class="pill-btn" :class="{ active: filterType === 'private' }" @click="filterType = 'private'">
								僅看私立
							</button>
							<button
								class="pill-btn danger-pill"
								:class="{ active: filterType === 'danger' }"
								@click="filterType = 'danger'"
							>
								⚠️ 未達 60%
							</button>
						</div>
					</div>
				</div>

				<!-- 學校搜尋探針 -->
				<div class="toolbar-right">
					<div class="search-box">
						<span class="search-icon">🔍</span>
						<input
							v-model="searchQuery"
							type="text"
							placeholder="搜尋學校（如：臺灣大學、輔仁大學）"
							class="search-input"
							@input="handleSearchInput"
						/>
						<button v-if="searchQuery" class="search-clear" @click="clearSelectedSchool">✕</button>
					</div>
					<!-- 🆕 搜尋無結果提示 -->
					<p v-if="searchNoResult" class="search-no-result">找不到「{{ searchQuery }}」</p>
				</div>
			</section>

			<!-- 核心視覺化雙圖佈局（全寬上下縱向排列） -->
			<section class="charts-layout">
				<!-- 主圖：散佈圖 -->
				<div class="chart-col-main">
					<ScatterPlot
						:data="currentYearData"
						:year="selectedYear"
						:danger-threshold="THRESHOLD_DANGER"
						:filter-type="filterType"
						:selected-school="selectedSchool"
						@select-school="handleSelectSchool"
					/>
				</div>

				<!-- 副圖：折線圖 -->
				<div class="chart-col-sub">
					<TrendLine
						:trend-data="trendData"
						:selected-year="selectedYear"
						:selected-school="selectedSchool"
						:school-history="currentSchoolHistory"
						:danger-threshold="THRESHOLD_DANGER"
						@clear-school="clearSelectedSchool"
					/>
				</div>
			</section>
		</main>

		<!-- 頁尾 -->
		<footer class="app-footer">
			<div class="footer-inner">
				<p>1151VIS-HW2 資料分析與視覺化應用 · Tamara Munzner 四層巢狀模型實踐作業</p>
				<p class="footer-source">
					資料來源：<a
						href="https://udb.moe.edu.tw/udata/DetailReportList/%E5%AD%B8%E7%94%9F%E9%A1%9E"
						target="_blank"
						rel="noopener noreferrer"
						class="footer-link"
						title="前往教育部大專校院校務資訊公開平臺"
						>教育部校務資訊公開平臺 (學12-3)</a
					>
				</p>
			</div>
		</footer>
	</div>
</template>

<style>
:root {
	/* 🔤 全域字階原生變數系統（最小字體 14px） */
	--font-xs: 14px; /* 基準底線：座標軸刻度、圖例、Tooltip 細項、微型標籤、頁尾 */
	--font-sm: 15px; /* 次要正文：控制項輸入文字、下拉選單、卡片描述、頁面副標 */
	--font-base: 16px; /* 主要正文：導讀文章、操作標籤 Label、膠囊按鈕 */
	--font-md: 18px; /* 卡片標題、重點區塊標題 */
	--font-lg: 20px; /* 強調標題、次級大標 */
	--font-xl: 30px; /* 頁面大標題 (Page Title) */
	--font-stat: 36px; /* KPI 指標核心大數值 */
}

*,
*::before,
*::after {
	box-sizing: border-box;
}

body {
	margin: 0;
	padding: 0;
	font-family:
		'Inter',
		'Noto Sans TC',
		system-ui,
		-apple-system,
		sans-serif;
	background-color: #f8fafc;
	color: #0f172a;
	-webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.app-layout {
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

/* 頁頭 Hero 區塊（深色漸層主視覺） */
.app-header {
	background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #1d4ed8 100%);
	padding: 48px 0;
}

.header-content {
	max-width: 1400px;
	width: 100%;
	margin: 0 auto;
	padding: 0 32px;
	box-sizing: border-box;
	display: flex;
	justify-content: space-between;
	align-items: flex-end;
	flex-wrap: wrap;
	gap: 16px;
}

.page-title {
	font-size: var(--font-xl);
	font-weight: 800;
	color: #ffffff;
	margin: 0 0 10px 0;
	letter-spacing: -0.02em;
	text-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

.page-subtitle {
	max-width: 880px;
}

.subtitle-question {
	font-size: var(--font-base);
	font-weight: 600;
	color: #e0f2fe;
	margin: 0 0 6px 0;
	line-height: 1.6;
}

.subtitle-description {
	font-size: var(--font-sm);
	color: #bfdbfe;
	margin: 0;
	line-height: 1.65;
}

.author-meta {
	text-align: right;
	font-size: var(--font-xs);
}

.course-label {
	font-weight: 600;
	color: #e0f2fe;
}

.student-info {
	color: #93c5fd;
	margin-top: 4px;
	font-variant-numeric: tabular-nums;
}

/* 主容器（寬度與 header-content 100% 垂直對齊） */
.main-body {
	max-width: 1400px;
	width: 100%;
	margin: 0 auto;
	padding: 60px 32px;
	box-sizing: border-box;
	flex: 1;
}

/* 📰 深度數據新聞導讀卡 */
.editorial-card {
	display: flex;
	gap: 16px;
	background: #eff6ff;
	border: 1px solid #bfdbfe;
	border-radius: 10px;
	padding: 16px 22px;
	margin-bottom: 24px;
}

.editorial-icon {
	font-size: 24px;
	line-height: 1.3;
}

.editorial-tag {
	font-size: var(--font-md);
	font-weight: 800;
	color: #1e40af;
	margin-bottom: 8px;
	letter-spacing: 0.01em;
}

.editorial-text {
	font-size: var(--font-base);
	line-height: 1.75;
	color: #1e3a8a;
	margin: 0;
}

/* KPI 卡片 */
.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
	gap: 18px;
	margin-bottom: 48px;
}

.kpi-card {
	background: #ffffff;
	border: 1px solid #e2e8f0;
	border-radius: 10px;
	padding: 18px 22px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.kpi-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 10px;
}

.kpi-title {
	font-size: var(--font-xs);
	font-weight: 600;
	color: #475569;
}

.kpi-pill {
	font-size: var(--font-xs);
	font-weight: 700;
	padding: 2px 7px;
	border-radius: 4px;
}

.kpi-pill.gray {
	background: #f1f5f9;
	color: #475569;
}
.kpi-pill.red {
	background: #fee2e2;
	color: #991b1b;
}
.kpi-pill.amber {
	background: #fef3c7;
	color: #92400e;
}
.kpi-pill.blue {
	background: #eff6ff;
	color: #1e40af;
}

.kpi-value-row {
	display: flex;
	align-items: baseline;
	gap: 6px;
	margin-bottom: 6px;
}

.kpi-num {
	font-size: var(--font-stat);
	font-weight: 800;
	letter-spacing: -0.02em;
	font-variant-numeric: tabular-nums;
	color: #0f172a;
}

.kpi-unit {
	font-size: var(--font-sm);
	font-weight: 600;
	color: #64748b;
}

.kpi-desc {
	font-size: var(--font-xs);
	color: #64748b;
	line-height: 1.5;
}

.text-danger {
	color: #dc2626 !important;
}
.text-warning {
	color: #d97706 !important;
}
.text-primary {
	color: #2563eb !important;
}

/* 🎛️ 綜合工具列 */
.toolbar-card {
	display: flex;
	justify-content: space-between;
	align-items: center;
	background: #f8fafc;
	padding: 16px 22px;
	border-radius: 10px;
	border: 1px solid #e2e8f0;
	box-shadow: none;
	margin-bottom: 24px;
	flex-wrap: wrap;
	gap: 16px;
}

.toolbar-left,
.toolbar-right {
	display: flex;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
}

.tool-item {
	display: flex;
	align-items: center;
	gap: 10px;
}

.tool-label {
	font-size: var(--font-base);
	font-weight: 600;
	color: #334155;
}

.select-wrapper {
	position: relative;
	display: inline-block;
}

.custom-select {
	appearance: none;
	background: #f8fafc;
	border: 1px solid #cbd5e1;
	border-radius: 6px;
	padding: 8px 34px 8px 14px;
	font-size: var(--font-sm);
	font-weight: 600;
	color: #0f172a;
	cursor: pointer;
	transition: all 0.15s ease;
}

.custom-select:focus {
	outline: none;
	border-color: #2563eb;
	background: #ffffff;
}

.select-arrow {
	position: absolute;
	right: 12px;
	top: 50%;
	transform: translateY(-50%);
	pointer-events: none;
	font-size: var(--font-xs);
	color: #64748b;
}

/* 膠囊按鈕群 */
.pill-group {
	display: flex;
	background: #f1f5f9;
	padding: 4px;
	border-radius: 6px;
	gap: 3px;
}

.pill-btn {
	background: transparent;
	border: none;
	padding: 6px 12px;
	font-size: var(--font-xs);
	font-weight: 600;
	color: #475569;
	border-radius: 4px;
	cursor: pointer;
	transition: all 0.15s ease;
}

.pill-btn:hover {
	color: #0f172a;
}

.pill-btn.active {
	background: #ffffff;
	color: #0f172a;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	font-weight: 700;
}

.pill-btn.danger-pill.active {
	background: #fee2e2;
	color: #dc2626;
	font-weight: 700;
}

/* 搜尋框 */
.search-box {
	position: relative;
	display: flex;
	align-items: center;
}

.search-icon {
	position: absolute;
	left: 10px;
	font-size: var(--font-xs);
	color: #94a3b8;
	pointer-events: none;
}

.search-input {
	background: #f8fafc;
	border: 1px solid #cbd5e1;
	border-radius: 6px;
	padding: 8px 32px 8px 34px;
	font-size: var(--font-sm);
	width: 280px;
	color: #0f172a;
	transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.search-input:focus {
	outline: none;
	border-color: #2563eb;
	background: #ffffff;
	width: 340px;
	box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.search-clear {
	position: absolute;
	right: 10px;
	background: none;
	border: none;
	font-size: var(--font-xs);
	color: #94a3b8;
	cursor: pointer;
}

/* 🆕 搜尋無結果提示 */
.search-no-result {
	font-size: var(--font-xs);
	color: #dc2626;
	margin: 0;
	padding: 4px 2px;
	animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

/* 核心視覺化雙圖佈局（上下縱向全寬排列，呼吸感充足） */
.charts-layout {
	display: grid;
	grid-template-columns: 1fr;
	gap: 28px;
}

/* 狀態訊息 */
.state-container {
	max-width: 600px;
	margin: 80px auto;
	text-align: center;
	padding: 40px;
	background: #ffffff;
	border-radius: 12px;
	border: 1px solid #e2e8f0;
}

.loading-spinner {
	width: 36px;
	height: 36px;
	border: 3px solid #e2e8f0;
	border-top-color: #2563eb;
	border-radius: 50%;
	animation: spin 0.8s linear infinite;
	margin: 0 auto 16px;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

.state-text {
	font-size: var(--font-sm);
	color: #64748b;
	margin: 0;
}

/* 頁尾（方案 A：深色呼應風格） */
.app-footer {
	background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
	border-top: 1px solid rgba(255, 255, 255, 0.08);
	padding: 36px 0;
	margin-top: auto;
}

.footer-inner {
	max-width: 1400px;
	width: 100%;
	margin: 0 auto;
	padding: 0 32px;
	box-sizing: border-box;
	text-align: center;
	font-size: var(--font-xs);
	color: #94a3b8;
}

.footer-inner p {
	margin: 4px 0;
}

.footer-source {
	color: #cbd5e1;
}

.footer-link {
	color: #60a5fa;
	text-decoration: none;
	font-weight: 500;
	transition: color 0.15s ease;
}

.footer-link:hover {
	color: #93c5fd;
	text-decoration: underline;
}

/* ==========================================================================
   📱 響應式網頁設計（RWD 媒體查詢）
   ========================================================================== */

/* 💻 平板與窄螢幕桌面 (<= 1024px) */
@media (max-width: 1024px) {
	.kpi-grid {
		grid-template-columns: repeat(2, 1fr);
		gap: 16px;
	}

	.toolbar-card {
		gap: 14px;
	}
}

/* 📱 主流行動端與直向平板 (<= 768px) */
@media (max-width: 768px) {
	/* 頂部 Header 自適應緊湊排版 */
	.app-header {
		padding: 28px 0;
	}

	.header-content {
		padding: 0 16px;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}

	.page-title {
		font-size: var(--font-lg); /* 20px~24px 平衡大小 */
		margin-bottom: 6px;
	}

	.subtitle-question {
		font-size: var(--font-sm);
		line-height: 1.5;
		margin-bottom: 4px;
	}

	.subtitle-description {
		font-size: var(--font-xs);
		line-height: 1.55;
	}

	/* 作者資訊：換行靠左對齊，搭配微光透頂線自然過渡 */
	.author-meta {
		text-align: left;
		width: 100%;
		padding-top: 10px;
		margin-top: 4px;
		border-top: 1px solid rgba(255, 255, 255, 0.12);
	}

	/* 主內容區邊距縮減，釋放寶貴水平螢幕寬度 */
	.main-body {
		padding: 24px 16px 48px;
	}

	/* 📰 新聞導讀卡自適應 */
	.editorial-card {
		padding: 14px 16px;
		gap: 12px;
		margin-bottom: 18px;
	}

	.editorial-icon {
		font-size: 20px;
	}

	.editorial-tag {
		font-size: var(--font-base);
		margin-bottom: 6px;
	}

	.editorial-text {
		font-size: var(--font-sm);
		line-height: 1.65;
	}

	/* 🎛️ 綜合控制列：縱向滿版流式佈局，徹底根除橫向溢出 */
	.toolbar-card {
		padding: 16px;
		flex-direction: column;
		align-items: stretch;
		gap: 14px;
		margin-bottom: 20px;
	}

	.toolbar-left {
		flex-direction: column;
		align-items: stretch;
		gap: 12px;
		width: 100%;
	}

	.tool-item {
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		width: 100%;
	}

	.select-wrapper {
		width: 100%;
	}

	.custom-select {
		width: 100%;
		box-sizing: border-box;
	}

	.pill-group {
		width: 100%;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 4px;
		box-sizing: border-box;
	}

	.pill-btn {
		text-align: center;
		padding: 8px 6px;
		width: 100%;
		box-sizing: border-box;
	}

	.toolbar-right {
		width: 100%;
		flex-direction: column;
		align-items: stretch;
	}

	.search-box {
		width: 100%;
	}

	/* 🚨 搜尋框禁止固定寬度，手機端強制 100% 流式寬度以防溢出 */
	.search-input {
		width: 100% !important;
		box-sizing: border-box;
	}

	.search-input:focus {
		width: 100% !important;
	}

	/* 頁尾安全邊距 */
	.footer-inner {
		padding: 0 16px;
	}
}

/* 📱 小型手機設備 (<= 480px) */
@media (max-width: 480px) {
	.kpi-grid {
		grid-template-columns: 1fr;
		gap: 12px;
	}

	.kpi-card {
		padding: 16px;
	}

	.pill-btn {
		font-size: var(--font-xs);
		padding: 6px 4px;
	}
}
</style>
