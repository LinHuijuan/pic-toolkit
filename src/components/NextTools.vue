<script setup lang="ts">
const props = defineProps<{ options: { key: string; label: string }[] }>()
const emit = defineEmits<{ pick: [key: string] }>()
</script>

<template>
  <div class="next-tools">
    <span class="next-label">换个方式处理</span>
    <div class="next-list">
      <button
        v-for="o in props.options"
        :key="o.key"
        class="next-btn"
        type="button"
        @click="emit('pick', o.key)"
      >
        <span class="next-dot" aria-hidden="true"></span>
        {{ o.label }}
        <span class="next-arrow" aria-hidden="true">›</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.next-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 与上方卡片文字保持同一水平对齐，避免下一站入口贴边 */
  padding: 0 14px;
}

.next-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-sub);
  padding-left: 2px;
}

.next-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.next-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--border);
  color: var(--text-main);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.next-btn:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 14px rgba(79, 110, 247, 0.12);
  transform: translateY(-1px);
}

.next-btn:active {
  transform: translateY(0);
}

.next-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--primary);
  opacity: 0.85;
}

.next-arrow {
  color: color-mix(in srgb, var(--primary) 60%, transparent);
  font-size: 15px;
  line-height: 1;
}
</style>