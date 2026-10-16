/**
 * 載入 Medblocks UI（開源 Web Components，Apache-2.0）
 * 文件：https://medblocks.com/docs/medblocks-ui
 * npm：https://www.npmjs.com/package/medblocks-ui
 */
let loaded = false;

export async function ensureMedblocksUi(): Promise<void> {
  if (loaded || typeof window === "undefined") return;
  await import("medblocks-ui");
  loaded = true;
}
