<script setup lang="ts">
const emit = defineEmits<{
  navigate: [view: 'grid' | 'watermark' | 'removeBg']
}>()

const features = [
  {
    key: 'grid' as const,
    icon: '🔲',
    title: '九宫格切图',
    desc: '朋友圈发图神器，一键切分多格，支持留白与透明背景',
    color: '#4f6ef7',
  },
  {
    key: 'watermark' as const,
    icon: '💧',
    title: '添加水印',
    desc: '文字水印平铺 / 单点放置，保护你的原创图片',
    color: '#22c55e',
  },
  {
    key: 'removeBg' as const,
    icon: '✂️',
    title: 'AI 抠图',
    desc: '一键去除背景，输出透明 PNG，可换背景色',
    color: '#f59e0b',
  },
]
</script>

<template>
  <div class="page-content home-page">
    <!-- 头部品牌区 -->
    <div class="home-header">
      <div class="home-logo">🖼️</div>
      <h1 class="home-title">图片工具箱</h1>
      <p class="home-subtitle">九宫格切图 · 水印 · AI 抠图</p>
    </div>

    <!-- 隐私承诺 -->
    <div class="privacy-banner">
      <span class="privacy-icon">🔒</span>
      <span>全部图片在本机处理，绝不上传服务器</span>
    </div>

    <!-- 功能入口 -->
    <div class="feature-list">
      <div
        v-for="item in features"
        :key="item.key"
        class="feature-card"
        @click="emit('navigate', item.key)"
      >
        <div class="feature-icon" :style="{ background: item.color + '1a' }">
          {{ item.icon }}
        </div>
        <div class="feature-info">
          <div class="feature-title">{{ item.title }}</div>
          <div class="feature-desc">{{ item.desc }}</div>
        </div>
        <div class="feature-arrow">›</div>
      </div>
    </div>

    <!-- 底部说明 -->
    <p class="tip-text footer-tip">
      提示：本工具为 PWA 应用，可在浏览器菜单中「添加到主屏幕」，使用体验更接近原生 App。
    </p>
  </div>
</template>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.home-header {
  text-align: center;
  padding: 32px 0 8px;
}

.home-logo {
  font-size: 52px;
  margin-bottom: 8px;
}

.home-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-main);
}

.home-subtitle {
  margin-top: 4px;
  font-size: 14px;
  color: var(--text-sub);
}

.privacy-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: #ecfdf5;
  color: #059669;
  font-size: 13px;
  font-weight: 500;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  padding: 16px;
  cursor: pointer;
  transition: transform 0.15s;
}

.feature-card:active {
  transform: scale(0.98);
}

.feature-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  flex-shrink: 0;
}

.feature-info {
  flex: 1;
  min-width: 0;
}

.feature-title {
  font-size: 16px;
  font-weight: 600;
}

.feature-desc {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-sub);
}

.feature-arrow {
  font-size: 22px;
  color: #c4c9d4;
  flex-shrink: 0;
}

.footer-tip {
  text-align: center;
}
</style>
