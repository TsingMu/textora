/**
 * 安装一个内存版 `window.localStorage` 桩：vitest 的 jsdom 环境默认 opaque origin 下
 * `window.localStorage` 不可用，而生产 WebView 中始终存在。返回桩对象供断言与故障注入。
 */
export function installLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => storage,
  });
  return storage;
}

/** 移除 `installLocalStorageStub` 安装的桩，恢复原始环境。 */
export function removeLocalStorageStub(): void {
  delete (window as { localStorage?: Storage }).localStorage;
}
