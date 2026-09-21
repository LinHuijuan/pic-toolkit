<script setup lang="ts">
import { ref, computed } from 'vue'
import { prepareAiModel, aiModel } from '../utils/aiModel'
import { formatDuration } from '../utils/format'
import FeedbackWidget from '../components/FeedbackWidget.vue'
import RecentWidget from '../components/RecentWidget.vue'

/** 工具标识：与 hash 路由的 #/工具名 一一对应 */
type ToolKey =
  | 'edit'
  | 'grid'
  | 'watermark'
  | 'removeBg'
  | 'compress'
  | 'merge'
  | 'format'
  | 'collage'
  | 'idPhoto'
  | 'upscale'
  | 'beauty'
  | 'colorReplace'
  | 'exif'

/** 分组标识：按"用户想完成的事"分，而不是按技术能力分 */
type GroupKey = 'featured' | 'social' | 'portrait' | 'file'

const emit = defineEmits<{
  navigate: [view: ToolKey | 'privacy']
}>()

/** 按设备显示 PWA 安装提示：移动端引导添加到主屏幕，PC 端引导浏览器安装 */
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

function startPreload() {
  // 失败原因已写入共享状态，这里只需避免未处理的 rejection
  prepareAiModel().catch(() => {})
}

/** 一行内说清"要不要等、下完了吗、还要多久"；文案过长时靠省略号收尾 */
const aiStatusText = computed(() => {
  const m = aiModel
  if (m.stage === 'idle') return '抠图、证件照需 84MB 高清模型'
  if (m.stage === 'ready') return 'AI 模型已就绪，打开即用'
  if (m.stage === 'error') return m.message || '模型下载失败，可重试或进工具页再试'
  const size = m.totalMB > 0 ? `${m.loadedMB.toFixed(1)}/${m.totalMB.toFixed(1)}MB` : `${m.loadedMB.toFixed(1)}MB`
  const remain = m.remainingSeconds != null ? ` · 约再 ${formatDuration(m.remainingSeconds * 1000)}` : ''
  return `${m.message} ${m.percent}% · ${size}${remain}`
})

interface ToolCard {
  key: ToolKey
  title: string
  desc: string
  grad: readonly [string, string]
  iconBody: string
  group: GroupKey
  /** 首次使用需下载大体积模型的工具，把等待成本前置到点进去之前说明 */
  badge?: string
}

/** 每个工具卡片独立的渐变配色：青 / 珊瑚橙 / 玫粉 / 草绿 / 天蓝 / 靛紫 / 紫罗兰 / 湖绿 / 明黄，打破"全是紫色" */
const features: ToolCard[] = [
  {
    key: 'removeBg' as const,
    title: 'AI 抠图',
    desc: '一键去背景并收边去白边，换底色、加描边做贴纸，还能手动擦残留',
    badge: '首次需下载 84MB 高清模型',
    grad: ['#34d399', '#22c55e'] as const,
    iconBody: '<circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.8 8.2 20.5 20M8.8 15.8 20.5 4"/>',
    group: 'featured' as const,
  },
  {
    key: 'idPhoto' as const,
    title: '证件照换底色',
    desc: 'AI 抠图一键换底，内置常见规格预设，支持一版多张打印',
    badge: '复用同一 84MB 高清模型',
    grad: ['#c084fc', '#d946ef'] as const,
    iconBody: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="12" cy="10.5" r="2.8"/><path d="M7.5 17.5c.9-2 2.6-3 4.5-3s3.6 1 4.5 3"/>',
    group: 'featured' as const,
  },
  {
    key: 'grid' as const,
    title: '九宫格切图',
    desc: '朋友圈发图神器，一键切分多格，支持留白与透明背景，多张一次打包',
    grad: ['#ff8a5c', '#f4593a'] as const,
    iconBody: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.5h17M3.5 15.5h17M9.5 3.5v17M15.5 3.5v17"/>',
    group: 'featured' as const,
  },
  {
    key: 'watermark' as const,
    title: '添加水印',
    desc: '文字 / 图片水印，可平铺或单点放置，一套参数批量套用几十张',
    grad: ['#f472b6', '#db2777'] as const,
    iconBody: '<path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M8.5 14.5h7M9.5 17h5"/>',
    group: 'social' as const,
  },
  {
    key: 'collage' as const,
    title: '网格拼图',
    desc: '多张拼成一张网格图，不用排版软件',
    grad: ['#fcd34d', '#f59e0b'] as const,
    iconBody: '<rect x="3.5" y="3.5" width="8" height="8" rx="2"/><rect x="12.5" y="3.5" width="8" height="8" rx="2"/><rect x="3.5" y="12.5" width="8" height="8" rx="2"/><rect x="12.5" y="12.5" width="8" height="8" rx="2"/>',
    group: 'social' as const,
  },
  {
    key: 'merge' as const,
    title: '长图拼接',
    desc: '多张竖排 / 横排拼成长图，聊天截图必备',
    grad: ['#818cf8', '#6366f1'] as const,
    iconBody: '<rect x="3.5" y="3.5" width="17" height="7.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="7" rx="2"/><path d="M7 8.5h4"/>',
    group: 'social' as const,
  },
  {
    key: 'edit' as const,
    title: '图片编辑',
    desc: '自由裁剪、旋转翻转，处理完可直接进其他工具',
    grad: ['#22d3ee', '#0ea5e9'] as const,
    iconBody: '<path d="M6.5 3.5h14v14"/><path d="M3.5 6.5h14v14"/>',
    group: 'social' as const,
  },
  {
    key: 'beauty' as const,
    title: '美颜修图',
    desc: '本地人脸检测，磨皮提亮更自然',
    badge: '首次需下载 3.6MB',
    grad: ['#f472b6', '#db2777'] as const,
    iconBody: '<path d="M12 4c2.8 3.7 5 6.5 5 9.3a5 5 0 1 1-10 0C7 10.5 9.2 7.7 12 4Z"/><path d="M8.8 13.5h6.4"/>',
    group: 'portrait' as const,
  },
  {
    key: 'upscale' as const,
    title: '超分辨率',
    desc: 'AI 本地放大提升清晰度，适合小图修复',
    badge: '首次需下载 4.9MB',
    grad: ['#38bdf8', '#2563eb'] as const,
    iconBody: '<path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M9.5 15.5h5M12 13v5"/>',
    group: 'portrait' as const,
  },
  {
    key: 'colorReplace' as const,
    title: '局部改色',
    desc: '框选区域取色替换，改衣服、改 logo 颜色',
    grad: ['#fb923c', '#f97316'] as const,
    iconBody: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
    group: 'portrait' as const,
  },
  {
    key: 'compress' as const,
    title: '图片压缩',
    desc: '按质量或目标体积压到最小，支持 WebP 与批量打包',
    grad: ['#38bdf8', '#2563eb'] as const,
    iconBody: '<path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z"/><path d="M14 2.5v5h5"/><path d="m9 15.5 3-3 3 3M12 12.5v6"/>',
    group: 'file' as const,
  },
  {
    key: 'format' as const,
    title: '图片格式转换',
    desc: 'PNG / JPG / WebP 互转，iPhone 的 HEIC 也能直接读',
    grad: ['#2dd4bf', '#14b8a6'] as const,
    iconBody: '<path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7M3.5 12a8.5 8.5 0 0 1 14.8-5.7"/><path d="M20.5 3.5v5h-5M3.5 20.5v-5h5"/>',
    group: 'file' as const,
  },
  {
    key: 'exif' as const,
    title: 'EXIF 信息',
    desc: '查看拍摄设备、时间与位置，公开前可一键清除',
    grad: ['#a78bfa', '#8b5cf6'] as const,
    iconBody: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    group: 'file' as const,
  },
]

/** 分组标题：说清这一组能帮用户完成什么 */
const groups: { key: GroupKey; title: string }[] = [
  { key: 'social' as const, title: '做社媒图' },
  { key: 'portrait' as const, title: '修人像、救糊图' },
  { key: 'file' as const, title: '压体积、查信息、转格式' },
]

/** 精选工具排成整行大卡，其余按组进双列宫格 */
const featuredTools = features.filter((f) => f.group === ('featured' as const))

function toolsOf(key: GroupKey) {
  return features.filter((f) => f.group === key && f.group !== ('featured' as const))
}

/** 卡片角标：抠图 / 证件照共用同一枚 84MB 高清模型，已就绪后就不再提示「首次需下载」 */
function effectiveBadge(item: ToolCard): string | undefined {
  if ((item.key === 'removeBg' || item.key === 'idPhoto') && aiModel.stage === 'ready') return undefined
  return item.badge
}

/** 组装带独立渐变描边的图标 SVG（每个卡片引用自己的渐变 id） */
function iconSvg(item: ToolCard): string {
  const gid = `grad-${item.key}`
  return `<svg viewBox="0 0 24 24" fill="none" stroke="url(#${gid})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${item.iconBody}</svg>`
}

/* ---------- 工具搜索：按「想做成的事」找工具，而不是记住 13 个入口 ---------- */
const searchInput = ref('')

/** 每个工具的通俗说法 / 常见任务词，命中「我要压缩图片」这种口语也能找到对应工具 */
const SEARCH_ALIASES: Record<string, string[]> = {
  removeBg: ['抠图', '去背景', '去底', '去白边', '透明', '贴纸', '换背景'],
  idPhoto: ['证件照', '一寸', '二寸', '报名照', '登记照', '换底色', '护照'],
  grid: ['九宫格', '朋友圈', '切图', '发圈', '九张', '宫格'],
  watermark: ['水印', '加水印', '防盗', '署名', '版权', 'logo'],
  collage: ['拼图', '网格', '长图', '九拼', '多张'],
  merge: ['长图', '拼接', '聊天截图', '纵向', '竖排'],
  edit: ['裁剪', '旋转', '翻转', '编辑', '裁方'],
  beauty: ['美颜', '磨皮', '人像', '提亮', '修图', '美白'],
  upscale: ['超分', '放大', '清晰', '变高清', '修复', '模糊'],
  colorReplace: ['改色', '换色', '局部', '换logo颜色'],
  compress: ['压缩', '变小', '压体积', '省空间', '省内存', 'kb'],
  format: ['格式', '转换', 'png', 'jpg', 'webp', 'heic', 'iphone'],
  exif: ['exif', '拍摄信息', '位置', 'gps', '隐私', '元数据'],
}

const normalizedQuery = computed(() => searchInput.value.trim().toLowerCase())

const searchResults = computed<ToolCard[]>(() => {
  const q = normalizedQuery.value
  if (!q) return []
  const hit = (item: ToolCard) => {
    if (item.title.toLowerCase().includes(q)) return true
    if (item.desc.toLowerCase().includes(q)) return true
    return (SEARCH_ALIASES[item.key] ?? []).some((w) => w.toLowerCase().includes(q))
  }
  return features.filter(hit)
})

function pickSearch(key: ToolKey) {
  searchInput.value = ''
  emit('navigate', key)
}
</script>

<template>
  <div class="page-content home-page">
    <!-- 品牌渐变头部（hero）：logo 承担品牌识别，主标题位置让给结果导向的那句话。
         隐私承诺与 AI 模型状态都收在这一屏里，首屏要留给工具卡片 -->
    <div class="home-header">
      <div class="home-logo">
        <!-- 品牌 logo：负空间工具箱（掀盖 + 魔法星，与 favicon/PWA 图标同源） -->
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <g transform="rotate(-4 12 7)">
            <path d="M8.8 5.2 C8.8 2.6 15.2 2.6 15.2 5.2" />
            <rect x="3.8" y="5" width="16.4" height="3.6" rx="1.8" fill="#fff" stroke="none" />
          </g>
          <rect x="3.5" y="9.8" width="17" height="10.7" rx="2.6" />
          <path d="M3.5 12.9 H20.5" stroke-width="1.5" />
          <rect x="10.7" y="11.6" width="2.6" height="2.6" rx="0.9" fill="#fff" stroke="none" />
          <path d="M19.4 1.6 Q19.9 3.7 22 4.2 Q19.9 4.7 19.4 6.8 Q18.9 4.7 16.8 4.2 Q18.9 3.7 19.4 1.6 Z" fill="#fff" stroke="none" />
        </svg>
      </div>
      <h1 class="home-title">图片不用上传，就能抠图、换底色、切九宫格</h1>
      <p class="home-subtitle">13 个工具在你这台设备里跑完 ·<br class="home-subtitle-br" />不注册、不上传、打开即用</p>

      <div class="hero-status" :class="'hero-status--' + aiModel.stage">
        <span class="hero-status-icon">{{ aiModel.stage === 'ready' ? '✓' : aiModel.stage === 'error' ? '!' : '⚡' }}</span>
        <span class="hero-status-text">{{ aiStatusText }}</span>
        <button v-if="aiModel.stage === 'idle' || aiModel.stage === 'error'" class="hero-status-action" @click="startPreload">
          {{ aiModel.stage === 'error' ? '重试' : '预下载' }}
        </button>
        <div v-if="aiModel.stage === 'downloading' || aiModel.stage === 'warming'" class="progress-bar is-mini hero-status-bar">
          <div class="progress-inner" :style="{ width: aiModel.percent + '%' }"></div>
        </div>
      </div>
    </div>

    <!-- 隐私信任标识：一行低调徽标，把「本地处理、不上传」这个核心卖点讲透，不上传即最放心的省 -->
    <div class="trust-bar">
      <span class="trust-chip">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 3.5 5 6v5c0 4.4 2.9 8.2 7 9.5 4.1-1.3 7-5.1 7-9.5V6l-7-2.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 11.5 2.2 2.2L15.5 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        全本地处理
      </span>
      <span class="trust-chip">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10V4M8 7.5 12 4l4 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        图片不上传
      </span>
      <span class="trust-chip">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        无需注册
      </span>
    </div>

    <!-- 工具搜索：想做什么直接输入，不必先认清 13 个入口 -->
    <div class="tool-search">
      <svg class="tool-search-icon" viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <input
        v-model="searchInput"
        class="tool-search-input"
        type="search"
        placeholder="找工具：压体积、抠图、切九宫格…"
        aria-label="搜索工具"
      />
    </div>
    <div v-if="normalizedQuery" class="search-results">
      <template v-if="searchResults.length">
        <a
          v-for="item in searchResults"
          :key="item.key"
          class="search-result"
          :href="'#/' + item.key"
          @click.prevent="pickSearch(item.key)"
        >
          <span class="search-result-icon" v-html="iconSvg(item)"></span>
          <span class="search-result-body">
            <span class="search-result-title">{{ item.title }}</span>
            <span class="search-result-desc">{{ item.desc }}</span>
          </span>
          <span class="search-result-arrow" aria-hidden="true">›</span>
        </a>
      </template>
      <p v-else class="search-empty">没有匹配的工具，换个说法试试，比如「压体积」或「换底色」</p>
    </div>

    <!-- 一键接力：把常见的一条龙步骤做成可点的入口，弱化「找工具、换页面」的割裂感 -->
    <section v-show="!normalizedQuery" class="flow-strip">
      <div class="flow-title">常见一条龙 · 图片全程留在本机</div>
      <div class="flow-steps">
        <a class="flow-step" href="#/compress" @click.prevent="emit('navigate', 'compress')">
          <b>压缩体积</b><span>变小更好传</span>
        </a>
        <span class="flow-arrow" aria-hidden="true">›</span>
        <a class="flow-step" href="#/format" @click.prevent="emit('navigate', 'format')">
          <b>转换格式</b><span>兼容各端</span>
        </a>
        <span class="flow-arrow" aria-hidden="true">›</span>
        <a class="flow-step" href="#/grid" @click.prevent="emit('navigate', 'grid')">
          <b>切图发布</b><span>发圈装饰</span>
        </a>
      </div>
    </section>

    <!-- 入口分两层：先用整行大卡给出三个"最值得试"的，其余按意图分组 -->
    <section v-show="!normalizedQuery" class="tool-group">
      <h2 class="group-title">效果最直观的 3 个</h2>
      <div class="featured-list">
        <a
          v-for="(item, idx) in featuredTools"
          :key="item.key"
          class="feature-card is-featured"
          :href="'#/' + item.key"
          :style="{ '--card-from': item.grad[0], '--card-to': item.grad[1], '--i': idx }"
          @click.prevent="emit('navigate', item.key)"
        >
          <div class="feature-icon" v-html="iconSvg(item)"></div>
          <div class="feature-info">
            <div class="feature-title">
              {{ item.title }}
              <span v-if="effectiveBadge(item)" class="feature-badge">{{ effectiveBadge(item) }}</span>
            </div>
            <div class="feature-desc">{{ item.desc }}</div>
          </div>
          <span class="feature-arrow" aria-hidden="true">›</span>
        </a>
      </div>
    </section>

    <section v-for="group in groups" v-show="!normalizedQuery" :key="group.key" class="tool-group">
      <h2 class="group-title">{{ group.title }}</h2>
      <div class="feature-list">
        <a
          v-for="(item, idx) in toolsOf(group.key)"
          :key="item.key"
          class="feature-card"
          :href="'#/' + item.key"
          :style="{ '--card-from': item.grad[0], '--card-to': item.grad[1], '--i': idx }"
          @click.prevent="emit('navigate', item.key)"
        >
          <div class="feature-icon" v-html="iconSvg(item)"></div>
          <div class="feature-info">
            <div class="feature-title">
              {{ item.title }}
              <span v-if="effectiveBadge(item)" class="feature-badge">{{ effectiveBadge(item) }}</span>
            </div>
            <div class="feature-desc">{{ item.desc }}</div>
          </div>
        </a>
      </div>
    </section>

    <!-- 底部功能入口：收进页面流内，不悬浮、不遮挡内容 -->
    <div class="footer-util">
      <RecentWidget />
      <FeedbackWidget />
    </div>

    <!-- 底部说明（按设备显示安装提示） -->
    <p class="tip-text footer-tip">
      {{ isMobile
        ? '提示：本工具为 PWA 应用，可在浏览器菜单中「添加到主屏幕」，使用体验更接近原生 App。'
        : '提示：本工具为 PWA 应用，可在浏览器地址栏点击安装图标（或安装提示），安装为桌面应用使用。' }}
      <span class="footer-sep"> · </span>
      <a href="#/privacy" @click.prevent="emit('navigate', 'privacy')" class="footer-link">隐私说明</a>
    </p>
    <!-- 每张功能卡片独立的渐变定义（图标描边引用各自 id） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient
          v-for="item in features"
          :key="item.key"
          :id="`grad-${item.key}`"
          x1="0"
          y1="0"
          x2="24"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" :stop-color="item.grad[0]" />
          <stop offset="100%" :stop-color="item.grad[1]" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.home-page {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 20px;
}

/* 首屏各区块（hero / trust / 分组）都是 flex 纵向排列的块级子项，默认 min-width:auto
  会把某段长内容的 min-content 带进布局，窄屏时横向撑破。统一放行收缩 */
.home-page > * {
  min-width: 0;
}

/* 背景氛围光斑：柔和的多色 radial 光晕，打破"全是紫色"，PC 满宽更有层次不空旷 */
.home-page::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(520px circle at 12% 6%, rgba(34, 211, 238, 0.2), transparent 55%),
    radial-gradient(480px circle at 88% 10%, rgba(250, 204, 21, 0.16), transparent 55%),
    radial-gradient(640px circle at 42% 88%, rgba(168, 85, 247, 0.18), transparent 60%),
    radial-gradient(430px circle at 96% 62%, rgba(16, 185, 129, 0.14), transparent 55%),
    radial-gradient(360px circle at 70% 30%, rgba(244, 114, 182, 0.1), transparent 55%);
}

/* 品牌渐变头部 */
.home-header {
  text-align: center;
  padding: 18px;
  background: var(--gradient);
  border-radius: 22px;
  box-shadow: 0 10px 30px rgba(79, 110, 247, 0.28);
  position: relative;
  overflow: hidden;
}

/* 装饰光斑：缓慢浮动动画（不遮挡文字，文字 z-index 更高） */
.home-header::before,
.home-header::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}

.home-header::before {
  width: 140px;
  height: 140px;
  top: -50px;
  right: -30px;
  animation: home-blob 7s ease-in-out infinite;
}

.home-header::after {
  width: 100px;
  height: 100px;
  bottom: -40px;
  left: -20px;
  background: rgba(255, 255, 255, 0.08);
  animation: home-blob 9s ease-in-out 1s infinite reverse;
}

@keyframes home-blob {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(-14px, 12px) scale(1.12);
  }
}

@keyframes logo-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

/* 首页功能卡片入场：淡入 + 轻微上浮，逐卡微错开 */
@keyframes feature-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.home-logo {
  width: 52px;
  height: 52px;
  margin: 0 auto 6px;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
  animation: logo-breathe 3.6s ease-in-out infinite;
}

.home-logo svg {
  width: 28px;
  height: 28px;
}

.home-title {
  margin-top: 10px;
  font-size: 21px;
  line-height: 1.35;
  font-weight: 700;
  color: #fff;
  position: relative;
  z-index: 1;
  text-shadow: 0 2px 8px rgba(31, 41, 55, 0.15);
}

.home-subtitle {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.85);
  position: relative;
  z-index: 1;
}

/* AI 模型状态：压在 hero 底部的一行胶囊，避免单独占一整张卡的高度 */
.hero-status {
  position: relative;
  z-index: 1;
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.28);
  font-size: 12px;
  color: #fff;
  text-align: left;
  overflow: hidden;
}

.hero-status-icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-weight: 700;
}

.hero-status--ready .hero-status-icon {
  color: #bbf7d0;
}

.hero-status--error {
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(255, 255, 255, 0.35);
}

.hero-status-text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hero-status-action {
  flex-shrink: 0;
  margin-left: auto;
  padding: 4px 12px;
  border: 0;
  border-radius: 999px;
  background: #fff;
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.hero-status-action:active {
  transform: scale(0.96);
}

/* 触屏下把命中区撑到胶囊内高（24 → 38px）。不能用 min-height: 44px：胶囊只有 40px 高、
   按钮再大也会被 overflow: hidden 裁掉，或者反过来把整条 pill 撑变形。
   左边只外扩 4px（与文字之间有 8px gap），避免点到状态文字就误触下载。 */
@media (hover: none) {
  .hero-status-action {
    position: relative;
  }

  .hero-status-action::after {
    content: '';
    position: absolute;
    top: -7px;
    right: -12px;
    bottom: -7px;
    left: -4px;
  }
}

/* 进度线贴在胶囊底边，不再单独占一行 */
.hero-status-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

/* 隐私信任标识：一行小徽标，低调不抢视觉焦点 */
.trust-bar {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 2px;
}

.trust-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-sub);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.7);
  line-height: 1.3;
}

.trust-chip svg {
  flex-shrink: 0;
  color: color-mix(in srgb, #4f6ef7 70%, transparent);
}

/* 工具搜索：白底胶囊输入框，低调不抢工具卡片 */
.tool-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card, 0 1px 2px rgba(31, 41, 55, 0.04));
  transition: border-color 0.15s, box-shadow 0.15s;
}

.tool-search:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
}

.tool-search-icon {
  flex-shrink: 0;
  color: var(--text-sub);
}

.tool-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 14px;
  color: var(--text-main);
  font-family: inherit;
}

.tool-search-input::placeholder {
  color: var(--text-sub);
}

/* 搜索结果：卡片列表，与功能卡同一圆角语言 */
.search-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-card);
  color: inherit;
  text-decoration: none;
  animation: feature-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) backwards;
}

.search-result:active {
  transform: scale(0.98);
}

.search-result-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--card-from, #4f6ef7) 14%, #fff), color-mix(in srgb, var(--card-to, #4f6ef7) 22%, #fff));
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-result-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.search-result-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.search-result-title {
  font-size: 15px;
  font-weight: 600;
}

.search-result-desc {
  font-size: 12px;
  color: var(--text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-result-arrow {
  flex-shrink: 0;
  font-size: 20px;
  color: color-mix(in srgb, var(--card-to, #4f6ef7) 70%, transparent);
}

.search-empty {
  margin: 4px 0 0;
  padding: 6px 4px;
  font-size: 13px;
  color: var(--text-sub);
}

/* 分组标题 */
.tool-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-sub);
  padding-left: 2px;
}

.feature-list {
  display: grid;
  /* minmax(0,1fr)：grid track 默认 min 为 auto，卡片里的长文案/图标会把列宽顶破，
     窄屏下一半就超出视口。强制列宽可收缩到 0，由视口说了算 */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

/* 精选工具：整行横卡，图标在左、文案左对齐，和下面的双列宫格拉开层级 */
.featured-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feature-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: inherit;
  text-decoration: none;
  gap: 10px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  padding: 16px 12px 14px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  /* 进入分批上浮：--i 由模板按卡片序号传入，backwards 让动画结束后交还 hover/active 控制 */
  animation: feature-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: calc(var(--i, 0) * 60ms);
}

.feature-card.is-featured {
  flex-direction: row;
  align-items: center;
  text-align: left;
  gap: 14px;
  padding: 14px 14px;
}

.feature-card.is-featured .feature-icon {
  width: 48px;
  height: 48px;
}

.feature-card.is-featured .feature-title {
  font-size: 16px;
}

.feature-card.is-featured .feature-desc {
  font-size: 13px;
}

/* 整行横卡右侧的箭头：补足"点进去"的可点击暗示 */
.feature-arrow {
  flex-shrink: 0;
  font-size: 24px;
  line-height: 1;
  color: color-mix(in srgb, var(--card-to) 70%, transparent);
}

/* 一键接力：一条扁平的步骤链，窄屏自动换行也不破坏节奏 */
.flow-strip {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.6);
  border: 1px dashed color-mix(in srgb, var(--primary) 35%, transparent);
}

.flow-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-sub);
  padding-left: 2px;
}

.flow-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.flow-step {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--border);
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  min-width: 0;
}

.flow-step:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 14px rgba(79, 110, 247, 0.12);
  transform: translateY(-1px);
}

.flow-step:active {
  transform: translateY(0);
}

.flow-step b {
  font-size: 14px;
  font-weight: 700;
}

.flow-step span {
  font-size: 11px;
  color: var(--text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-arrow {
  flex-shrink: 0;
  font-size: 18px;
  color: color-mix(in srgb, var(--primary) 60%, transparent);
  line-height: 1;
}

/* 渐变描边：默认隐藏，hover 时沿卡片边缘亮起一张彩色描边 */
.feature-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.6px;
  background: linear-gradient(135deg, var(--card-from), var(--card-to));
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.feature-card:active {
  transform: scale(0.98);
  box-shadow: 0 3px 12px rgba(79, 110, 247, 0.12);
}

.feature-icon {
  width: 52px;
  height: 52px;
  border-radius: 15px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--card-from) 16%, #fff),
    color-mix(in srgb, var(--card-to) 24%, #fff)
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--card-from) 20%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.2s;
}

.feature-icon svg {
  width: 26px;
  height: 26px;
}

.feature-info {
  flex: 1;
  min-width: 0;
}

.feature-title {
  font-size: 15px;
  font-weight: 600;
}

/* 首次需下载模型的提示徽标：说明等待成本，但不抢标题重心 */
.feature-badge {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--card-from) 70%, var(--text-sub));
  border-radius: 999px;
  color: color-mix(in srgb, var(--card-to) 72%, #1f2937);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}

.feature-desc {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-sub);
}

/* 只有真正带悬停能力的指针设备才启用 hover 效果，触屏上按压缩放已经够了 */
@media (hover: hover) {
  .feature-card:hover::before {
    opacity: 1;
  }

  .feature-card:hover .feature-icon {
    transform: scale(1.06);
  }
}

/* PC：宫格放宽 + hover 抬升 */
@media (min-width: 768px) {
  .home-subtitle-br {
    display: none;
  }

  .home-title {
    font-size: 26px;
  }

  .feature-list {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  .feature-card {
    padding: 22px 18px 18px;
    gap: 12px;
  }

  .feature-icon {
    width: 58px;
    height: 58px;
    border-radius: 17px;
  }

  .feature-icon svg {
    width: 30px;
    height: 30px;
  }

  .feature-title {
    font-size: 16px;
  }

  .feature-desc {
    font-size: 14px;
  }

  /* 精选横卡在宽屏下更舒展，一整行三个 */
  .featured-list {
    flex-direction: row;
    gap: 16px;
  }

  .feature-card.is-featured {
    flex: 1;
    padding: 20px 18px;
  }

  @media (hover: hover) {
    .feature-card:hover {
      transform: translateY(-5px);
      box-shadow:
        0 16px 32px color-mix(in srgb, var(--card-from) 30%, transparent),
        0 4px 10px rgba(31, 41, 55, 0.06);
    }
  }
}

.footer-tip {
  text-align: center;
}

.footer-sep {
  color: var(--border);
}

.footer-link {
  color: var(--primary);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--primary) 50%, transparent);
}

.footer-link:hover {
  border-bottom-style: solid;
}

/* 底部功能入口：与说明文字并列，浅色、不抢眼 */
.footer-util {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
</style>
