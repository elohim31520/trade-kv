export {};

declare global {
  interface Env {
    URTRADE_KV: KVNamespace;
    // 在這裡新增其他環境變數
    API_HOST: string;
  }
}