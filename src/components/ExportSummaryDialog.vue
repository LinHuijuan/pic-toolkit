<script setup lang="ts">
import { exportSummary, rowLabel, totalLabel } from '../utils/exportConfirm'
import { stripExif, setStripExif } from '../utils/exportPrivacy'
</script>

<template>
  <Transition name="es-pop">
    <div v-if="exportSummary.visible" class="es-mask" @click.self="exportSummary.onCancel">
      <div class="es-panel" role="dialog" aria-label="导出确认">
        <div class="es-head">
          <span class="es-title">确认导出 {{ exportSummary.rows.length }} 个文件</span>
          <button class="es-close" @click="exportSummary.onCancel" aria-label="关闭">×</button>
        </div>

        <div class="es-list">
          <div v-for="(row, i) in exportSummary.rows" :key="row.name + i" class="es-row">
            <span class="es-name">{{ row.name }}</span>
            <span class="es-size">{{ rowLabel(row.size) }}</span>
          </div>
        </div>

        <div class="es-summary">
          <span>共 {{ exportSummary.rows.length }} 个文件 · 合计 {{ totalLabel() }}</span>
          <span class="es-zip">{{ exportSummary.zipName }}（ZIP）</span>
        </div>

        <!-- 导出隐私：默认移除拍摄信息 -->
        <div class="es-privacy">
          <div class="es-privacy-text">
            <div class="es-privacy-title">移除拍摄信息</div>
            <div class="es-privacy-desc">导出时不携带设备型号、拍摄时间、GPS 位置等原始信息</div>
          </div>
          <button
            class="es-switch"
            :class="{ on: stripExif }"
            role="switch"
            :aria-checked="stripExif"
            @click="setStripExif(!stripExif)"
          >
            <span class="es-knob"></span>
          </button>
        </div>

        <div class="es-foot">
          <button class="btn btn-ghost btn-sm" @click="exportSummary.onCancel">取消</button>
          <button class="btn btn-primary btn-sm" @click="exportSummary.onConfirm">确认导出</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.es-mask {
  position: fixed;
  inset: 0;
  z-index: 1005;
  background: rgba(31, 41, 55, 0.34);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.es-panel {
  width: min(480px, 100%);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: 0 24px 70px rgba(31, 41, 55, 0.28);
}

.es-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.es-title {
  font-size: 16px;
  font-weight: 650;
  color: var(--text-main);
}

.es-close {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--text-sub);
  cursor: pointer;
  padding: 2px 6px;
}

.es-list {
  flex: 1;
  overflow: auto;
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px 10px;
  max-height: 40vh;
}

.es-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
}

.es-row + .es-row {
  border-top: 1px dashed var(--border);
}

.es-name {
  flex: 1;
  color: var(--text-main);
  word-break: break-all;
}

.es-size {
  flex-shrink: 0;
  color: var(--text-sub);
}

.es-summary {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-sub);
}

.es-zip {
  color: var(--primary);
}

/*** 隐私开关行 ***/
.es-privacy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(79, 110, 247, 0.06);
  border: 1px solid rgba(79, 110, 247, 0.16);
}

.es-privacy-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
}

.es-privacy-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-sub);
}

.es-switch {
  flex-shrink: 0;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  border: none;
  background: #d7dbe6;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  padding: 0;
}

.es-switch.on {
  background: var(--primary);
}

.es-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s;
}

.es-switch.on .es-knob {
  transform: translateX(18px);
}

.es-foot {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.es-pop-enter-active,
.es-pop-leave-active {
  transition: opacity 0.2s ease;
}

.es-pop-enter-from,
.es-pop-leave-to {
  opacity: 0;
}
</style>