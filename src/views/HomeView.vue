<script setup lang="ts">
import { prepareAiModel, aiModel } from '../utils/aiModel'
import { formatDuration } from '../utils/format'

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

const emit = defineEmits<{
  navigate: [view: ToolKey]
}>()

/** 按设备显示 PWA 安装提示：移动端引导添加到主屏幕，PC 端引导浏览器安装 */
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

function startPreload() {
  // 失败原因已写入共享状态，这里只需避免未处理的 rejection
  prepareAiModel().catch(() => {})
}

interface ToolCard {
  key: ToolKey
  title: string
  desc: string
  grad: readonly [string, string]
  iconBody: string
  /** 首次使用需下载大体积模型的工具，把等待成本前置到点进去之前说明 */
  badge?: string
}

/** 每个工具卡片独立的渐变配色：青 / 珊瑚橙 / 玫粉 / 草绿 / 天蓝 / 靛紫 / 紫罗兰 / 湖绿 / 明黄，打破"全是紫色" */
const features: ToolCard[] = [
  {
    key: 'edit' as const,
    title: '图片编辑',
    desc: '自由裁剪、旋转翻转，处理后可直接进入其他工具',
    grad: ['#22d3ee', '#0ea5e9'] as const,
    iconBody: '<path d="M6.5 3.5h14v14"/><path d="M3.5 6.5h14v14"/>',
  },
  {
    key: 'grid' as const,
    title: '九宫格切图',
    desc: '朋友圈发图神器，一键切分多格，可保存完整图，支持留白与透明背景',
    grad: ['#ff8a5c', '#f4593a'] as const,
    iconBody: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.5h17M3.5 15.5h17M9.5 3.5v17M15.5 3.5v17"/>',
  },
  {
    key: 'watermark' as const,
    title: '添加水印',
    desc: '文字 / 图片水印，支持平铺、单点放置，保护你的原创图片',
    grad: ['#f472b6', '#db2777'] as const,
    iconBody: '<path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M8.5 14.5h7M9.5 17h5"/>',
  },
  {
    key: 'removeBg' as const,
    title: 'AI 抠图',
    desc: '一键去除背景，输出透明 PNG，可换背景色',
    badge: '首次需下载 42MB',
    grad: ['#34d399', '#22c55e'] as const,
    iconBody: '<circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.8 8.2 20.5 20M8.8 15.8 20.5 4"/>',
  },
  {
    key: 'compress' as const,
    title: '图片压缩',
    desc: '本地压缩图片体积，支持按质量或目标体积压缩，可批量处理',
    grad: ['#38bdf8', '#2563eb'] as const,
    iconBody: '<path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z"/><path d="M14 2.5v5h5"/><path d="m9 15.5 3-3 3 3M12 12.5v6"/>',
  },
  {
    key: 'merge' as const,
    title: '长图拼接',
    desc: '多张图片竖排 / 横排拼成长图，聊天截图必备',
    grad: ['#818cf8', '#6366f1'] as const,
    iconBody: '<rect x="3.5" y="3.5" width="17" height="7.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="7" rx="2"/><path d="M7 8.5h4"/>',
  },
  {
    key: 'idPhoto' as const,
    title: '证件照换底色',
    desc: 'AI 抠图一键换底，内置常见规格预设，支持一版多张打印',
    badge: '复用同一 42MB 模型',
    grad: ['#c084fc', '#d946ef'] as const,
    iconBody: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="12" cy="10.5" r="2.8"/><path d="M7.5 17.5c.9-2 2.6-3 4.5-3s3.6 1 4.5 3"/>',
  },
  {
    key: 'format' as const,
    title: '图片格式转换',
    desc: 'PNG / JPG / WebP 互转，透明自动白底',
    grad: ['#2dd4bf', '#14b8a6'] as const,
    iconBody: '<path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7M3.5 12a8.5 8.5 0 0 1 14.8-5.7"/><path d="M20.5 3.5v5h-5M3.5 20.5v-5h5"/>',
  },
  {
    key: 'collage' as const,
    title: '网格拼图',
    desc: '多张图片拼成网格，朋友圈九宫格神器',
    grad: ['#fcd34d', '#f59e0b'] as const,
    iconBody: '<rect x="3.5" y="3.5" width="8" height="8" rx="2"/><rect x="12.5" y="3.5" width="8" height="8" rx="2"/><rect x="3.5" y="12.5" width="8" height="8" rx="2"/><rect x="12.5" y="12.5" width="8" height="8" rx="2"/>',
  },
  {
    key: 'upscale' as const,
    title: '超分辨率',
    desc: 'AI 本地放大提升清晰度，适合小图修复',
    badge: '首次需下载 4.9MB',
    grad: ['#38bdf8', '#2563eb'] as const,
    iconBody: '<path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M9.5 15.5h5M12 13v5"/>',
  },
  {
    key: 'beauty' as const,
    title: '美颜修图',
    desc: '本地人脸检测，磨皮提亮更自然',
    badge: '首次需下载 3.6MB',
    grad: ['#f472b6', '#db2777'] as const,
    iconBody: '<path d="M12 4c2.8 3.7 5 6.5 5 9.3a5 5 0 1 1-10 0C7 10.5 9.2 7.7 12 4Z"/><path d="M8.8 13.5h6.4"/>',
  },
  {
    key: 'colorReplace' as const,
    title: '局部改色',
    desc: '框选区域，用取色器吸取颜色替换，绘画改色神器',
    grad: ['#fb923c', '#f97316'] as const,
    iconBody: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  },
]

/** 组装带独立渐变描边的图标 SVG（每个卡片引用自己的渐变 id） */
function iconSvg(item: (typeof features)[number]): string {
  const gid = `grad-${item.key}`
  return `<svg viewBox="0 0 24 24" fill="none" stroke="url(#${gid})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${item.iconBody}</svg>`
}
</script>

<template>
  <div class="page-content home-page">
    <!-- 品牌渐变头部（hero） -->
    <div class="home-header">
      <div class="home-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
          <circle cx="9" cy="9.5" r="1.8" />
          <path d="m5.5 18.5 4.5-4.5 3 3 3.5-3.5 2 2" />
        </svg>
      </div>
      <h1 class="home-title">图片工具箱</h1>
      <p class="home-subtitle">12 个图片工具全在你设备里跑完：图片不上传、不注册、打开即用</p>
    </div>

    <!-- 隐私承诺 -->
    <div class="privacy-banner">
      <span class="privacy-icon">🔒</span>
      <span>全部图片在本机处理，绝不上传服务器</span>
    </div>

    <!-- AI 模型预下载 -->
    <div class="ai-model-card">
      <div class="ai-model-top">
        <div class="ai-model-badge">⚡</div>
        <div>
          <div class="ai-model-title">AI 模型</div>
          <div class="ai-model-desc">抠图与证件照需要 42MB 模型，仅下载一次，之后离线可用</div>
        </div>
      </div>

      <template v-if="aiModel.stage === 'idle'">
        <button class="btn btn-primary" style="width: 100%" @click="startPreload">预下载模型</button>
      </template>
      <template v-else-if="aiModel.stage === 'downloading' || aiModel.stage === 'warming'">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: aiModel.percent + '%' }"></div>
        </div>
        <div class="ai-model-meta">
          <span>{{ aiModel.message }}</span>
          <span v-if="aiModel.totalMB > 0">{{ aiModel.loadedMB.toFixed(1) }} / {{ aiModel.totalMB.toFixed(1) }} MB</span>
          <span v-else>{{ aiModel.loadedMB.toFixed(1) }} MB</span>
        </div>
        <div class="ai-model-meta sub">
          <span>已用 {{ formatDuration(aiModel.elapsedMs) }}</span>
          <span v-if="aiModel.remainingSeconds != null">预计剩余 {{ formatDuration(aiModel.remainingSeconds * 1000) }}</span>
        </div>
      </template>
      <template v-else-if="aiModel.stage === 'ready'">
        <div class="ai-model-ready">模型已就绪 ✓</div>
      </template>
      <template v-else-if="aiModel.stage === 'error'">
        <div class="ai-model-error">{{ aiModel.message }}</div>
        <button class="btn btn-outline" style="width: 100%" @click="startPreload">重试</button>
      </template>
    </div>

    <!-- 功能入口：每项对应一个可独立分享的 hash 地址 -->
    <div class="feature-list">
      <a
        v-for="item in features"
        :key="item.key"
        class="feature-card"
        :href="'#/' + item.key"
        :style="{ '--card-from': item.grad[0], '--card-to': item.grad[1] }"
        @click.prevent="emit('navigate', item.key)"
      >
        <div class="feature-icon" v-html="iconSvg(item)"></div>
        <div class="feature-info">
          <div class="feature-title">
            {{ item.title }}
            <span v-if="item.badge" class="feature-badge">{{ item.badge }}</span>
          </div>
          <div class="feature-desc">{{ item.desc }}</div>
        </div>
      </a>
    </div>

    <!-- 底部说明（按设备显示安装提示） -->
    <p class="tip-text footer-tip">
      {{ isMobile
        ? '提示：本工具为 PWA 应用，可在浏览器菜单中「添加到主屏幕」，使用体验更接近原生 App。'
        : '提示：本工具为 PWA 应用，可在浏览器地址栏点击安装图标（或安装提示），安装为桌面应用使用。' }}
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
  padding: 28px 20px 24px;
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

.home-logo {
  width: 64px;
  height: 64px;
  margin: 0 auto 10px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.home-logo svg {
  width: 34px;
  height: 34px;
}

.home-title {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  position: relative;
  z-index: 1;
  text-shadow: 0 2px 8px rgba(31, 41, 55, 0.15);
}

.home-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  position: relative;
  z-index: 1;
}

/* 隐私承诺 */
.privacy-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(79, 110, 247, 0.08) 100%);
  border: 1px solid rgba(16, 185, 129, 0.15);
  color: #059669;
  font-size: 13px;
  font-weight: 500;
}

.feature-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
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

.feature-card:hover::before {
  opacity: 1;
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

.feature-card:hover .feature-icon {
  transform: scale(1.06);
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
  border: 1px solid var(--card-from);
  border-radius: 999px;
  color: var(--card-to);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.5;
}

.feature-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-sub);
}

/* PC：3 列宫格 + hover 抬升 */
@media (min-width: 768px) {
  .feature-list {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  .feature-card {
    padding: 22px 18px 18px;
    gap: 12px;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .feature-card:hover {
    transform: translateY(-5px);
    box-shadow:
      0 16px 32px color-mix(in srgb, var(--card-from) 30%, transparent),
      0 4px 10px rgba(31, 41, 55, 0.06);
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
    font-size: 13px;
  }
}

.footer-tip {
  text-align: center;
}

/* 首页「预下载 AI 模型」卡片 */
.ai-model-card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai-model-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-model-badge {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #fcd34d, #f59e0b);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.ai-model-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
}

.ai-model-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-sub);
}

.progress-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(79, 110, 247, 0.12);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--gradient);
  transition: width 0.25s ease;
}

.ai-model-meta {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--text-sub);
}

.ai-model-meta.sub {
  color: var(--text-3);
}

.ai-model-ready {
  text-align: center;
  padding: 6px 0;
  font-size: 14px;
  font-weight: 600;
  color: #059669;
}

.ai-model-error {
  text-align: center;
  font-size: 13px;
  color: var(--danger);
}
</style>
