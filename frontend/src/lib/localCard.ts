const DIRECT = "https://127.0.0.1:5066";

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

async function localCshisViaHelper(method: string, path: string, body?: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${HELPER}/tools/cshis`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ method, path, body: body ?? null }),
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

async function localCshisRaw(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${DIRECT}${path}`, {
      method,
      headers: body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const via = await localCshisViaHelper(method, path, body);
    if (via) return via;
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
  await ensureLocalReader();
  const status = await localCshis("GET", "/api/common/v1/Status");
  if (nestedStatus(status, "hc") === 0) {
    throw new DeskCardError("\u5361\u6c92\u6709\u63d2\u4e0a\u3002");
  }
  return localCshis("GET", "/api/hc/v1/Basic");
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
  await ensureLocalReader();
  const signed = await localCshis("POST", "/api/hc/v1/Signature/Hc", { serviceType });
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

function liveWord(kind: "sam" | "hpc", status: number, expire: string): string {
  if (kind === "sam") {
    if (status === 2) return "SAM \u5df2\u9a57\u8b49" + (expire ? "\uff0c\u6709\u6548\u5230 " + expire : "");
    if (status === 1) return "SAM \u5df2\u8f09\u5165\uff0c\u9084\u6c92\u9a57\u8b49";
    return "SAM \u9084\u6c92\u9a57\u8b49";
  }
  if (status === 3) return "\u91ab\u4e8b\u4eba\u54e1\u5361 PIN \u5df2\u9a57\u8b49" + (expire ? "\uff0c\u6709\u6548\u5230 " + expire : "");
  if (status === 2) return "\u91ab\u4e8b\u4eba\u54e1\u5361\u5df2\u9a57\u8b49\uff0c\u9084\u6c92\u6253 PIN";
  if (status === 1) return "\u91ab\u4e8b\u4eba\u54e1\u5361\u5728\u8b80\u5361\u6a5f\u4e0a\uff0c\u9084\u6c92\u9a57 PIN";
  return "\u91ab\u4e8b\u4eba\u54e1\u5361\u6c92\u6709\u63d2\u4e0a";
}

export async function refreshLocalReader(): Promise<{ note: string; live: LocalCardLive }> {
  const names = await listLocalReaders();
  let live = await readLocalCardLive();
  if (!live.reachable) {
    return { live, note: "\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4\u6c92\u6709\u56de\u61c9\u3002" };
  }
  if (names.length === 0) {
    return { live, note: "\u9019\u53f0\u6c92\u6709\u770b\u5230\u8b80\u5361\u6a5f\u3002\u8acb\u78ba\u8a8d\u8b80\u5361\u6a5f\u6709\u63d2\u4e0a\uff0c\u518d\u6309\u4e00\u6b21\u3002" };
  }
  if (names.length === 1 && !live.readerName) {
    await localCshis("POST", "/api/settings/v1/PcscReader/Default", { readerName: names[0] });
    live = await readLocalCardLive();
  }
  const reader = live.readerName || names[0];
  return {
    live,
    note:
      "\u8b80\u5361\u6a5f\u5df2\u91cd\u65b0\u6574\u7406\u3002\u73fe\u5728\u9019\u53f0\u662f\u300c" +
      reader +
      "\u300d\u3002" +
      liveWord("sam", live.sam, live.samExpire) +
      "\u3002" +
      liveWord("hpc", live.hpc, live.hpcExpire) +
      "\u3002\u63a5\u8457\u6309 SAM\u9a57\u8b49\uff0c\u518d\u6309\u91ab\u4e8b\u4eba\u54e1\u5361\u9a57\u8b49\u3002",
  };
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

export async function verifyLocalHpc(pin: string): Promise<LocalCardLive> {
  const trimmed = pin.trim();
  if (!trimmed) throw new DeskCardError("\u8acb\u5148\u8f38\u5165\u91ab\u4e8b\u4eba\u54e1\u5361 PIN\u3002");
  await verifyLocalSam();
  const result = await localCshisRaw("POST", "/api/hpc/v1/Verification/Hpc", { pin: trimmed });
  const code = result.statusCode;
  if (code === 1102 || code === 1400) throw new DeskCardError("\u91ab\u4e8b\u4eba\u54e1\u5361\u6c92\u6709\u63d2\u5728\u73fe\u5728\u9019\u53f0\u8b80\u5361\u6a5f\u3002");
  if (code === 1410) throw new DeskCardError("\u91ab\u4e8b\u4eba\u54e1\u5361 PIN \u4e0d\u5c0d\u3002");
  if (typeof code === "number" && code !== 0) throw new DeskCardError("\u91ab\u4e8b\u4eba\u54e1\u5361\u9a57\u8b49\u5931\u6557\uff08" + String(code) + "\uff09\u3002");
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
