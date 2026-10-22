const DIRECT = "https://localhost:5066";

export type DeskSign = {
  clientRandom?: string;
  hospitalId?: string;
  samId?: string;
  signature?: string;
  hcId?: string;
  hcIdNo?: string;
  hpcId?: string;
  hpcIdNo?: string;
  serviceType?: string;
  statusCode?: number;
};

export class DeskCardError extends Error {}

const HELPER = "http://127.0.0.1:5310";

async function localCshisViaHelper(method: string, path: string, body?: unknown, timeoutMs = 45000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${HELPER}/tools/cshis`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ method, path, body: body ?? null }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    if (data.error === "unreachable") return null;
    if (Array.isArray(data.printers)) return null;
    return data;
  } catch {
    return null;
  }
}

async function cardSoftwareListening(): Promise<boolean> {
  try {
    const res = await fetch(`${HELPER}/health`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return false;
    const data = await res.json() as { card6?: { running?: boolean } };
    return data.card6?.running === true;
  } catch {
    return false;
  }
}

async function localCshisRaw(method: string, path: string, body?: unknown, timeoutMs = 45000): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${DIRECT}${path}`, {
      method,
      headers: body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const via = await localCshisViaHelper(method, path, body, timeoutMs);
    if (via) return via;
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new DeskCardError("\u8b80\u5361\u8edf\u9ad4\u9019\u6b21\u56de\u61c9\u592a\u4e45\u3002\u8acb\u6309\u53f3\u4e0a\u89d2\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f\u3002", { cause: err });
    }
    if (await cardSoftwareListening()) {
      throw new DeskCardError("\u8b80\u5361\u8edf\u9ad4\u5df2\u7d93\u958b\u8457\uff0c\u9019\u500b\u8996\u7a97\u554f\u4e0d\u5230\u5361\u3002", { cause: err });
    }
    throw new DeskCardError("\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4\u6c92\u6709\u56de\u61c9\u3002", { cause: err });
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    data = {};
  }
  if (!res.ok && typeof data.statusCode !== "number") data.statusCode = res.status;
  return data;
}

async function localCshis(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const data = await localCshisRaw(method, path, body);
  const code = data.statusCode;
  if (typeof code === "number" && code !== 0) throw cardFailed(code);
  return data;
}

function cardFailed(code: unknown): DeskCardError {
  if (code === 1102) return new DeskCardError("\u5361\u6c92\u6709\u63d2\u4e0a\u3002");
  return new DeskCardError("\u9019\u53f0\u8b80\u5361\u8edf\u9ad4\u56de\u8986\u5931\u6557\uff08" + String(code) + "\uff09\u3002");
}

function nestedStatus(data: Record<string, unknown>, key: string): number | null {
  const direct = data[key];
  if (direct && typeof direct === "object" && "status" in direct) {
    const value = (direct as { status?: unknown }).status;
    return typeof value === "number" ? value : null;
  }
  const inner = data.status;
  if (inner && typeof inner === "object") {
    const box = (inner as Record<string, unknown>)[key];
    if (box && typeof box === "object" && "status" in box) {
      const value = (box as { status?: unknown }).status;
      return typeof value === "number" ? value : null;
    }
  }
  return null;
}

export async function localReaderReachable(): Promise<boolean> {
  try {
    await localCshis("GET", "/api/common/v1/Status");
    return true;
  } catch {
    return false;
  }
}

export async function ensureLocalReader(): Promise<void> {
  let status = await localCshis("GET", "/api/common/v1/Status");
  const initialized = status.initialized === true
    || (typeof status.status === "object" && status.status !== null && (status.status as { initialized?: boolean }).initialized === true);
  if (!initialized) {
    await localCshis("POST", "/api/common/v1/Initial", {});
    status = await localCshis("GET", "/api/common/v1/Status");
  }
  if (nestedStatus(status, "sam") === 1) {
    await localCshis("POST", "/api/sam/v1/Verification", {});
  }
}

async function attachLocalSam(signed: Record<string, unknown>): Promise<DeskSign> {
  if (!signed.samId || !signed.hospitalId) {
    const sam = await localCshis("GET", "/api/sam/v1/Basic");
    signed.samId = signed.samId || sam.samId || "";
    signed.hospitalId = signed.hospitalId || sam.hospitalId || "";
  }
  if (!signed.samId || !signed.hospitalId) {
    throw new DeskCardError("\u9019\u53f0\u7684\u5b89\u5168\u6a21\u7d44\u6c92\u6709\u8b80\u5230\u9662\u6240\u4ee3\u865f\u3002\u8acb\u5728\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4 6.0 \u5b8c\u6210 SAM\u3002");
  }
  if (!signed.signature || !signed.clientRandom) {
    throw new DeskCardError("\u9019\u53f0\u7c3d\u7ae0\u4e0d\u5b8c\u6574\uff0c\u6c92\u6709\u62ff\u53bb\u5411\u5065\u4fdd\u5c40\u9001\u51fa\u3002");
  }
  return signed as DeskSign;
}

export async function readLocalHcBasic(): Promise<Record<string, unknown>> {
  await bindHealthCardReader();
  try {
    return await callCard("GET", "/api/hc/v1/Basic");
  } catch (err) {
    if (err instanceof DeskCardError && err.message.includes("\uff081102\uff09")) {
      throw new DeskCardError("\u9019\u500b\u69fd\u6c92\u6709\u63d2\u5361\u3002");
    }
    throw err;
  }
}

export async function readLocalSamBasic(): Promise<Record<string, unknown>> {
  await ensureLocalReader();
  return localCshis("GET", "/api/sam/v1/Basic");
}

export async function readLocalHpcBasic(): Promise<Record<string, unknown>> {
  await ensureLocalReader();
  return localCshis("GET", "/api/hpc/v1/Basic");
}

export async function readLocalCloudSam(): Promise<Record<string, unknown>> {
  await ensureLocalReader();
  return localCshis("GET", "/api/settings/v1/CloudSam");
}

export async function readLocalVirtualBasic(token: string): Promise<Record<string, unknown>> {
  await ensureLocalReader();
  await localCshis("POST", "/api/hc/v1/Verification/VirtualHc", { token });
  return localCshis("GET", "/api/hc/v1/Basic");
}

export async function signLocalHc(serviceType: string): Promise<DeskSign> {
  await bindHealthCardReader();
  const signed = await callCard("POST", "/api/hc/v1/Signature/Hc", { serviceType });
  if (!signed.hcId || !signed.hcIdNo) {
    const basic = await localCshis("GET", "/api/hc/v1/Basic");
    signed.hcId = signed.hcId || basic.cardId || basic.cardSn || "";
    signed.hcIdNo = signed.hcIdNo || basic.idNo || "";
  }
  return attachLocalSam(signed);
}

export async function signLocalSam(serviceType: string): Promise<DeskSign> {
  await ensureLocalReader();
  const signed = await localCshis("POST", "/api/sam/v1/Signature", { serviceType });
  return attachLocalSam(signed);
}

export async function signLocalHpc(serviceType: string): Promise<DeskSign> {
  await ensureLocalReader();
  const signed = await localCshis("POST", "/api/hpc/v1/Signature", { serviceType });
  return attachLocalSam(signed);
}

export async function signLocalHpcHc(serviceType: string): Promise<DeskSign> {
  await ensureLocalReader();
  const signed = await localCshis("POST", "/api/hc/v1/Signature/HpcHc", { serviceType });
  return attachLocalSam(signed);
}

export async function listLocalReaders(): Promise<string[]> {
  const data = await localCshis("GET", "/api/settings/v1/PcscReader/Readers");
  const readers = data.readers;
  if (!Array.isArray(readers)) return [];
  return readers.map((item) => String(item || "")).filter(Boolean);
}

function statusBox(data: Record<string, unknown>): Record<string, unknown> {
  const inner = data.status;
  if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  return data;
}

export type LocalCardLive = {
  reachable: boolean;
  sam: number;
  samExpire: string;
  hpc: number;
  hpcExpire: string;
  readerName: string;
};

function clock(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return pad(date.getMonth() + 1) + "/" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function liveFrom(data: Record<string, unknown>): LocalCardLive {
  const box = statusBox(data);
  const sam = box.sam && typeof box.sam === "object" ? box.sam as Record<string, unknown> : null;
  const hpc = box.hpc && typeof box.hpc === "object" ? box.hpc as Record<string, unknown> : null;
  return {
    reachable: true,
    sam: typeof sam?.status === "number" ? sam.status : 0,
    samExpire: clock(sam?.expireTime),
    hpc: typeof hpc?.status === "number" ? hpc.status : 0,
    hpcExpire: clock(hpc?.expireTime),
    readerName: typeof box.readerName === "string" ? box.readerName : "",
  };
}

const LIVE_DOWN: LocalCardLive = { reachable: false, sam: 0, samExpire: "", hpc: 0, hpcExpire: "", readerName: "" };

export async function readLocalCardLive(): Promise<LocalCardLive> {
  try {
    return liveFrom(await localCshisRaw("GET", "/api/common/v1/Status"));
  } catch {
    return LIVE_DOWN;
  }
}


async function quietCard(method: string, path: string, body?: unknown): Promise<void> {
  try {
    await localCshisRaw(method, path, body, 8000);
  } catch {
    // Releasing a slot is allowed to fail when that card is not in it.
  }
}

async function listedReaders(): Promise<string[]> {
  const data = await localCshisRaw("GET", "/api/settings/v1/PcscReader/Readers", undefined, 8000);
  const readers = data.readers;
  if (!Array.isArray(readers)) return [];
  return readers.map((item) => String(item || "")).filter(Boolean);
}

async function detectInsertedReader(): Promise<string> {
  const data = await localCshisRaw("POST", "/api/settings/v1/PcscReader/AutoDetected", undefined, 20000);
  if (typeof data.statusCode === "number" && data.statusCode !== 0) return "";
  return typeof data.readerName === "string" ? data.readerName : "";
}

/** One physical reader. One name: use it. Several names: follow the card, never Interface 1. */
async function readerForThisPc(): Promise<string> {
  const names = await listedReaders();
  if (names.length === 1) return names[0];
  if (names.length === 0) return "";
  const found = await detectInsertedReader();
  if (found && names.includes(found)) return found;
  const live = await readLocalCardLive();
  if (live.readerName && names.includes(live.readerName)) return live.readerName;
  throw new DeskCardError("\u9019\u53f0\u770b\u5230\u4e0d\u6b62\u4e00\u500b\u8b80\u5361\u6a5f\u540d\u7a31\uff0c6.0 \u4e00\u6b21\u53ea\u9023\u4e00\u53f0\u3002\u8acb\u53ea\u7559\u73fe\u5728\u8981\u7528\u7684\u90a3\u4e00\u53f0\uff0c\u518d\u6309\u53f3\u4e0a\u89d2\u91cd\u65b0\u6574\u7406\u3002");
}

async function bindThisReader(): Promise<void> {
  const reader = await readerForThisPc();
  if (!reader) throw new DeskCardError("\u9019\u53f0\u6c92\u6709\u770b\u5230\u8b80\u5361\u6a5f\u3002\u8acb\u78ba\u8a8d\u8b80\u5361\u6a5f\u6709\u63d2\u4e0a\uff0c\u518d\u6309\u53f3\u4e0a\u89d2\u91cd\u65b0\u6574\u7406\u3002");
  await selectLocalReader(reader);
}

const HC_READER_KEY = "psehr.hcReader";

export function savedHealthCardReader(): string {
  try {
    return localStorage.getItem(HC_READER_KEY) || "";
  } catch {
    return "";
  }
}

function rememberHealthCardReader(name: string): void {
  localStorage.setItem(HC_READER_KEY, name);
}

async function selectNamedReader(reader: string): Promise<void> {
  try {
    await selectLocalReader(reader);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const stuck = message.includes("\u6c92\u6709\u63db\u904e\u53bb") || message.includes("1199") || message.includes("\uff081101\uff09");
    if (!stuck) throw err;
    await quietCard("POST", "/api/common/v1/Finalize", {});
    await selectLocalReader(reader);
  }
}

/** One physical reader. A driver may still list Interface 0 and Interface 1. */
function soleReader(names: string[]): string {
  if (names.length === 0) {
    throw new DeskCardError("\u9019\u53f0\u6c92\u6709\u770b\u5230\u8b80\u5361\u6a5f\u3002\u8acb\u78ba\u8a8d\u8b80\u5361\u6a5f\u6709\u63d2\u4e0a\uff0c\u518d\u6309\u4e00\u6b21\u3002");
  }
  if (names.length === 1) return names[0];
  const contact = names.find((name) => /interface\s*0$/i.test(name));
  if (contact) return contact;
  const other = names.find((name) => !/interface\s*1$/i.test(name));
  return other || names[0];
}

/** Health-card reads use the reader designated on this computer. */
async function bindHealthCardReader(): Promise<void> {
  const names = await listedReaders();
  const saved = savedHealthCardReader();
  const reader = saved && names.includes(saved) ? saved : soleReader(names);
  await selectNamedReader(reader);
  if (reader !== saved) rememberHealthCardReader(reader);
}

export async function assignHealthCardReader(): Promise<string> {
  const reader = soleReader(await listedReaders());
  await selectNamedReader(reader);
  rememberHealthCardReader(reader);
  return "\u5df2\u6307\u5b9a\u8b80\u5361\u6a5f\u3002\u4e4b\u5f8c\u53ef\u4ee5\u8b80\u5065\u4fdd\u5361\u3002";
}

function refreshNote(reader: string, data: Record<string, unknown>): string {
  const hpc = nestedStatus(data, "hpc") ?? 0;
  const hc = nestedStatus(data, "hc") ?? 0;
  let card = "\u63d2\u91ab\u4e8b\u4eba\u54e1\u5361\u53ef\u4ee5\u9a57\u8b49\uff0c\u63d2\u5065\u4fdd\u5361\u53ef\u4ee5\u76f4\u63a5\u639b\u865f\u3002";
  if (hpc >= 1 && hc < 1) card = "\u4e0a\u9762\u662f\u91ab\u4e8b\u4eba\u54e1\u5361\uff0c\u53ef\u4ee5\u6309\u9a57\u8b49\u3002";
  else if (hc >= 1 && hpc < 1) card = "\u4e0a\u9762\u662f\u5065\u4fdd\u5361\uff0c\u53ef\u4ee5\u76f4\u63a5\u639b\u865f\u3002";
  else if (hpc >= 1 && hc >= 1) card = "\u9019\u500b\u69fd\u540c\u6642\u770b\u5230\u5169\u7a2e\u5361\u3002\u4e00\u6b21\u53ea\u63d2\u4e00\u5f35\u3002";
  return "\u5df2\u653e\u958b\u8b80\u5361\u6a5f\u4e26\u91cd\u65b0\u8b80\u53d6\u3002\u73fe\u5728\u9019\u53f0\u662f\u300c" + reader + "\u300d\u3002" + card;
}

export async function refreshLocalReader(): Promise<{ note: string; live: LocalCardLive }> {
  const probe = await readLocalCardLive();
  if (!probe.reachable) {
    return { live: probe, note: "\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4\u6c92\u6709\u56de\u61c9\u3002" };
  }
  await quietCard("DELETE", "/api/hc/v1/Logout");
  await quietCard("DELETE", "/api/hpc/v1/Logout");
  await quietCard("DELETE", "/api/settings/v1/PcscReader/Default");
  const names = await listedReaders();
  if (names.length === 0) {
    return { live: await readLocalCardLive(), note: "\u9019\u53f0\u6c92\u6709\u770b\u5230\u8b80\u5361\u6a5f\u3002\u8acb\u78ba\u8a8d\u8b80\u5361\u6a5f\u6709\u63d2\u4e0a\uff0c\u518d\u6309\u4e00\u6b21\u3002" };
  }
  let reader = names.length === 1 ? names[0] : await detectInsertedReader();
  if (!reader) {
    return {
      live: await readLocalCardLive(),
      note: "\u770b\u5230\u591a\u500b\u8b80\u5361\u6a5f\u540d\u7a31\uff0c6.0 \u4e00\u6b21\u53ea\u9023\u4e00\u53f0\u3002\u8acb\u53ea\u7559\u73fe\u5728\u8981\u7528\u7684\u90a3\u4e00\u53f0\uff0c\u518d\u6309\u4e00\u6b21\u3002",
    };
  }
  try {
    await selectLocalReader(reader);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const stuck = message.includes("\u6c92\u6709\u63db\u904e\u53bb") || message.includes("1199") || message.includes("\uff081101\uff09");
    if (!stuck) throw err;
    await quietCard("POST", "/api/common/v1/Finalize", {});
    await selectLocalReader(reader);
  }
  const data = await localCshisRaw("GET", "/api/common/v1/Status");
  return { live: liveFrom(data), note: refreshNote(reader, data) };
}

async function cloudSamId(): Promise<string> {
  const list = await localCshis("GET", "/api/settings/v1/CloudSam");
  const sams = list.sams;
  const first = Array.isArray(sams) ? sams[0] as Record<string, unknown> : undefined;
  return String(first?.samId || "");
}

export async function verifyLocalSam(): Promise<LocalCardLive> {
  const samId = await cloudSamId();
  if (!samId) throw new DeskCardError("\u9019\u53f0\u9084\u6c92\u532f\u5165 SAM\u3002");
  let data = await localCshis("GET", "/api/common/v1/Status");
  const box = statusBox(data);
  const initialized = box.initialized === true;
  const name = typeof box.name === "string" ? box.name : "";
  const restart = !initialized || name !== samId;
  if (restart && initialized) {
    await localCshis("POST", "/api/common/v1/Finalize", {});
  }
  if (restart) {
    await localCshis("POST", "/api/common/v1/Initial", { name: samId });
    data = await localCshis("GET", "/api/common/v1/Status");
  }
  if (nestedStatus(data, "sam") !== 2) {
    await localCshis("POST", "/api/sam/v1/Verification", {});
  }
  return readLocalCardLive();
}

const CARD_CODES: Record<number, string> = {
  1000: "\u63a7\u5236\u8edf\u9ad4\u9084\u6c92\u521d\u59cb\u5316",
  1002: "\u627e\u4e0d\u5230\u5b89\u5168\u6a21\u7d44",
  1100: "\u6c92\u6709\u767c\u73fe\u8b80\u5361\u6a5f",
  1101: "\u9084\u6c92\u6307\u5b9a\u8b80\u5361\u6a5f\u69fd",
  1102: "\u9019\u500b\u69fd\u6c92\u6709\u63d2\u5361",
  1103: "\u5361\u7247\u61c9\u7528\u7a0b\u5f0f\u5207\u63db\u5931\u6557",
  1199: "\u8b80\u5361\u6a5f\u767c\u751f\u5176\u5b83\u932f\u8aa4\u3002\u8acb\u6309\u53f3\u4e0a\u89d2\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f",
  1302: "\u91ab\u4e8b\u6a5f\u69cb\u5df2\u8d85\u904e\u5408\u7d04\u671f\u9593",
  1303: "\u91ab\u4e8b\u6a5f\u69cb\u5df2\u505c\u6b0a",
  1304: "SAM \u5df2\u8a3b\u92b7",
  1400: "\u91ab\u4e8b\u4eba\u54e1\u5361\u9032\u5165\u6a21\u5f0f\u4e00\u5931\u6557",
  1401: "\u91ab\u4e8b\u4eba\u54e1\u5361\u9032\u5165\u6a21\u5f0f\u4e8c\u5931\u6557",
  1402: "\u91ab\u4e8b\u4eba\u54e1\u5361\u9084\u6c92\u9a57\u904e PIN",
  1410: "\u91ab\u4e8b\u4eba\u54e1\u5361 PIN \u4e0d\u5c0d",
  1422: "\u91ab\u4e8b\u4eba\u54e1\u6191\u8b49\u4e0d\u5728\u6709\u6548\u671f\uff0c\u6216\u91ab\u5e2b\u5361\u5df2\u904e\u671f",
  1500: "\u5065\u4fdd\u5361\u9032\u5165\u6a21\u5f0f\u4e00\u5931\u6557\u3002\u96f2\u7aef\u85e5\u6b77\u82e5\u986f\u793a 2461500\uff0c\u5c31\u662f\u9019\u4e00\u500b 1500",
  1501: "\u5065\u4fdd\u5361\u9032\u5165\u6a21\u5f0f\u4e8c\u5931\u6557\uff0c\u8acb\u78ba\u8a8d SAM \u5df2\u9a57\u8b49",
  1502: "\u5065\u4fdd\u5361\u9032\u5165\u6a21\u5f0f\u4e09\u5931\u6557",
  1516: "\u9019\u500b\u69fd\u540c\u6642\u770b\u5230\u5169\u7a2e\u5361\u3002\u4e00\u53f0\u8b80\u5361\u6a5f\u5c31\u5206\u958b\u63d2\uff1b\u5169\u53f0\u5c31\u5404\u63d2\u5404\u7684",
  1600: "\u9019\u500b\u8b80\u5361\u6a5f\u540d\u7a31\u5df2\u7d93\u4e0d\u5728",
  1610: "SAM \u6a94\u683c\u5f0f\u4e0d\u5c0d",
  1611: "\u627e\u4e0d\u5230\u9019\u500b\u96f2\u7aef\u5b89\u5168\u6a21\u7d44",
  1700: "\u9023\u4e0d\u5230\u5065\u4fdd\u7f72\uff0c\u8acb\u5148\u78ba\u8a8d\u91ab\u7642\u7db2",
  1703: "\u8ddf\u5065\u4fdd\u7f72\u7684\u9023\u7dda\u903e\u671f\uff0c\u8acb\u518d\u6309\u4e00\u6b21\u9a57\u8b49 SAM",
};

function cardCodeText(code: number): string {
  const text = CARD_CODES[code];
  if (text) return text + "\uff08" + String(code) + "\uff09";
  return "\u8b80\u5361\u8edf\u9ad4\u56de\u5831\u932f\u8aa4 " + String(code);
}

async function callCard(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const data = await localCshisRaw(method, path, body);
  const code = data.statusCode;
  if (typeof code === "number" && code !== 0) throw new DeskCardError(cardCodeText(code));
  return data;
}

async function selectLocalReader(reader: string): Promise<void> {
  if (!reader) throw new DeskCardError("\u8acb\u5148\u9078\u64c7\u8b80\u5361\u6a5f\u3002");
  const samId = await cloudSamId();
  if (!samId) throw new DeskCardError("\u9019\u53f0\u9084\u6c92\u532f\u5165 SAM\u3002\u6309\u300c\u532f\u5165 SAM\u300d\u3002");
  let data = await callCard("GET", "/api/common/v1/Status");
  let box = statusBox(data);
  let live = typeof box.readerName === "string" ? box.readerName : "";
  if (live !== reader) {
    await callCard("POST", "/api/settings/v1/PcscReader/Default", { readerName: reader });
  }
  const initialized = box.initialized === true;
  const name = typeof box.name === "string" ? box.name : "";
  const restart = !initialized || name !== samId;
  if (restart && initialized) {
    await callCard("POST", "/api/common/v1/Finalize", {});
  }
  if (restart) {
    await callCard("POST", "/api/common/v1/Initial", { name: samId });
    data = await callCard("GET", "/api/common/v1/Status");
    box = statusBox(data);
    live = typeof box.readerName === "string" ? box.readerName : "";
  }
  if (nestedStatus(data, "sam") !== 2) {
    await callCard("POST", "/api/sam/v1/Verification", {});
    data = await callCard("GET", "/api/common/v1/Status");
    box = statusBox(data);
    live = typeof box.readerName === "string" ? box.readerName : "";
  }
  if (live && live !== reader) {
    const hpc = box.hpc && typeof box.hpc === "object" ? box.hpc as Record<string, unknown> : null;
    const hpcStatus = typeof hpc?.status === "number" ? hpc.status : 0;
    let until = "";
    if (hpcStatus >= 2) {
      const shown = clock(hpc?.expireTime);
      if (shown) until = "\u91ab\u4e8b\u4eba\u54e1\u5361\u9a57\u8b49\u6709\u6548\u5230 " + shown + "\u3002";
    }
    throw new DeskCardError(
      "6.0 \u73fe\u5728\u7684\u9023\u7dda\u5728\u300c" + live + "\u300d\u3002" + until +
      "\u9019\u6b21\u8981\u7684\u662f\u300c" + reader + "\u300d\u3002\u5df2\u9a57\u8b49\u7684\u72c0\u614b\u9084\u5728\uff0c\u6c92\u6709\u6e05\u6389\uff0c\u6240\u4ee5\u6c92\u6709\u63db\u904e\u53bb\u3002\u8acb\u6309\u53f3\u4e0a\u89d2\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f\u3002",
    );
  }
}

export async function verifyLocalHpc(pin: string): Promise<LocalCardLive> {
  const trimmed = pin.trim();
  if (!trimmed) throw new DeskCardError("\u8acb\u5148\u8f38\u5165\u91ab\u4e8b\u4eba\u54e1\u5361 PIN\u3002");
  await bindThisReader();
  let result: Record<string, unknown>;
  try {
    result = await callCard("POST", "/api/hpc/v1/Verification/Hpc", { pin: trimmed });
  } catch (err) {
    if (err instanceof DeskCardError && err.message.includes("\uff081102\uff09")) {
      throw new DeskCardError("\u91ab\u4e8b\u4eba\u54e1\u5361\u6c92\u63d2\uff0c\u53ef\u4ee5\u7e7c\u7e8c\u3002");
    }
    throw err;
  }
  if (result.statusCode === 1102) throw new DeskCardError("\u91ab\u4e8b\u4eba\u54e1\u5361\u6c92\u63d2\uff0c\u53ef\u4ee5\u7e7c\u7e8c\u3002");
  await callCard("GET", "/api/hpc/v1/Basic");
  return readLocalCardLive();
}

async function pointReader(readerName: string): Promise<void> {
  const cloud = await localCshis("GET", "/api/settings/v1/CloudSam");
  const sams = cloud.sams;
  const first = Array.isArray(sams) ? sams[0] as Record<string, unknown> : undefined;
  const samId = String(first?.samId || "");
  if (!samId) {
    throw new DeskCardError("\u9019\u53f0\u9084\u6c92\u532f\u5165 SAM\u3002");
  }
  await localCshis("POST", "/api/settings/v1/PcscReader/Default", { readerName });
  let status = await localCshis("GET", "/api/common/v1/Status");
  const box = statusBox(status);
  const initialized = box.initialized === true;
  const restart = !initialized || String(box.name || "") !== samId || String(box.readerName || "") !== readerName;
  if (restart && initialized) {
    await localCshis("POST", "/api/common/v1/Finalize", {});
  }
  if (restart) {
    await localCshis("POST", "/api/common/v1/Initial", { name: samId });
  }
  status = await localCshis("GET", "/api/common/v1/Status");
  if (nestedStatus(status, "sam") !== 2) {
    await localCshis("POST", "/api/sam/v1/Verification", {});
  }
}

function replyCode(data: Record<string, unknown>): number {
  return typeof data.statusCode === "number" ? data.statusCode : -1;
}

export async function readHcOnReader(readerName: string): Promise<string> {
  await pointReader(readerName);
  const basic = await localCshis("GET", "/api/hc/v1/Basic");
  return String(basic.name || "");
}

const HPC_SEEN = new Set([0, 1402, 1410, 1422]);
const EMPTY_SLOT = new Set([1100, 1101, 1102]);

export async function identifyLocalSlots(readers: string[]): Promise<{ hcReader: string; hpcReader: string; note: string }> {
  if (readers.length === 0) {
    return { hcReader: "", hpcReader: "", note: "\u9019\u53f0\u6c92\u6709\u770b\u5230\u8b80\u5361\u6a5f\u3002" };
  }
  const seen: { name: string; hc: number; hpc: number }[] = [];
  for (const name of readers) {
    await pointReader(name);
    const hc = replyCode(await localCshisRaw("GET", "/api/hc/v1/Basic"));
    if (hc === 0) {
      seen.push({ name, hc, hpc: -1 });
      continue;
    }
    const hpc = replyCode(await localCshisRaw("GET", "/api/hpc/v1/Basic"));
    seen.push({ name, hc, hpc });
  }
  const hpcItem = seen.find((item) => HPC_SEEN.has(item.hpc) && item.hc !== 0);
  let hcItem = seen.find((item) => item.hc === 0 && item.name !== hpcItem?.name);
  if (!hcItem && hpcItem) {
    hcItem = seen.find((item) => item.name !== hpcItem.name && !EMPTY_SLOT.has(item.hc));
  }
  if (readers.length === 1) {
    const only = seen[0];
    if (hpcItem) {
      return { hcReader: "", hpcReader: only.name, note: "\u9019\u4e00\u53f0\u63d2\u7684\u662f\u91ab\u4e8b\u4eba\u54e1\u5361\u3002" };
    }
    await pointReader(only.name);
    const note = only.hc === 0
      ? "\u9019\u4e00\u53f0\u63d2\u7684\u662f\u5065\u4fdd\u5361\u3002"
      : "\u9019\u4e00\u53f0\u9810\u8a2d\u8b80\u5065\u4fdd\u5361\u3002";
    return { hcReader: only.name, hpcReader: "", note };
  }
  const occupied = seen.filter((item) => HPC_SEEN.has(item.hpc) || !EMPTY_SLOT.has(item.hc));
  if (occupied.length === 0) {
    return { hcReader: "", hpcReader: "", note: "\u5169\u500b\u69fd\u90fd\u6c92\u63d2\u5361\uff0c\u7121\u5f9e\u5224\u65b7\u3002" };
  }
  const hcReader = hcItem?.name || "";
  const hpcReader = hpcItem?.name || "";
  if (hcReader) await pointReader(hcReader);
  const note = hcReader && hpcReader
    ? "\u5065\u4fdd\u5361\u5728\u300c" + hcReader + "\u300d\uff0c\u91ab\u4e8b\u4eba\u54e1\u5361\u5728\u300c" + hpcReader + "\u300d\u3002"
    : hcReader
      ? "\u5065\u4fdd\u5361\u5728\u300c" + hcReader + "\u300d\u3002\u91ab\u4e8b\u4eba\u54e1\u5361\u6c92\u63d2\u3002"
      : hpcReader
        ? "\u91ab\u4e8b\u4eba\u54e1\u5361\u5728\u300c" + hpcReader + "\u300d\u3002\u5065\u4fdd\u5361\u6c92\u63d2\u3002"
        : "\u5169\u500b\u69fd\u5206\u4e0d\u51fa\u4f86\u3002";
  return { hcReader, hpcReader, note };
}
