<script setup lang="ts">
import { applyPwaUpdate, pwaUpdate } from '../composables/pwa'
</script>

<template>
  <Transition name="up-pop">
    <div v-if="pwaUpdate" class="up-banner" role="alert">
      <div class="up-text">
        <span class="up-copy">发现新版本，刷新即可获得最新体验</span>
      </div>
      <button class="up-btn" @click="applyPwaUpdate">刷新</button>
    </div>
  </Transition>
</template>

<style scoped>
.up-banner {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 14px;
  width: min(480px, calc(100vw - 32px));
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(28, 30, 38, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.24);
  color: #fff;
}

.up-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
}

.up-btn {
  flex-shrink: 0;
  padding: 6px 16px;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: #b91c1c;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.up-btn:hover {
  background: #ffe4e6;
}

.up-pop-enter-active,
.up-pop-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.up-pop-enter-from,
.up-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>