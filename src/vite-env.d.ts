/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// onnxruntime-web 1.21.0 的打包入口没有随包提供类型（版本被 @imgly 的 peer 精确锁死），
// 调用方各自用结构化接口收敛，这里只补模块声明
declare module 'onnxruntime-web'
declare module 'onnxruntime-web/webgpu'
