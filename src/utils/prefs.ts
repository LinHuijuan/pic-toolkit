/**
 * 跨会话偏好记忆
 *
 * 某些工具参数（水印角度/稀疏度、切图行列/留缝、压缩档位…）是「用户上次怎么设、下次还怎么设」的
 * 高频重复项。这里给一个带版本的 localStorage 存储：初始化即回读上次的值，写入后自动持久化，
 * 换个会话再进来仍是上次的设定，不用每次重设。
 *
 * 只存可序列化的标量/简单对象（数字、字符串、布尔），不存图片等大对象。
 */
import { ref, watch, type Ref } from 'vue'

const NS = 'pic-toolkit:prefs:'
const VERSION = 1

function keyOf(name: string): string {
  return `${NS}v${VERSION}.${name}`
}

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(keyOf(name))
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 持久化偏好：把 ref 的默认值换成 usePref(name, 默认值)，读写与普通 ref 完全一致 */
export function usePref<T>(name: string, fallback: T): Ref<T> {
  const v = ref(read(name, fallback)) as Ref<T>
  watch(
    v,
    (cur) => {
      try {
        localStorage.setItem(keyOf(name), JSON.stringify(cur))
      } catch {
        /* 存储写满或被禁用时忽略，不阻塞交互 */
      }
    },
    { deep: true },
  )
  return v
}