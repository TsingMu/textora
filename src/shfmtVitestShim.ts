/**
 * vitest 专用垫片：`@wasm-fmt/shfmt/vite` 的 `shfmt.wasm?init` 胶水在 jsdom 环境下无法解析
 * 资源 URL，测试经 vite.config.ts 的 vitest alias 把该入口替换为本文件，改走同一 WASM 的
 * Node 加载路径（自动同步初始化）。格式化行为与生产路径一致，生产构建不引用本文件。
 */
export { format } from "@wasm-fmt/shfmt/node";

export default async function initShfmtForTests(): Promise<void> {};
