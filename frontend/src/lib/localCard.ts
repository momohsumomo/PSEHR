const DIRECT = "https://127.0.0.1:5066";

function cardBases(): string[] {
  const host = typeof location === "undefined" ? "" : location.hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "") return [DIRECT];
  return [DIRECT, `${location.origin}/cshis`];
}

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

async function localCshis(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let res: Response | null = null;
  let lastError: unknown;
  for (const base of cardBases()) {
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      break;
    } catch (err) {
      lastError = err;
      res = null;
    }
  }
  if (!res) {
    throw new DeskCardError("\u5de5\u4f5c\u7ad9\u5fc5\u9808\u7528\u300c\u958b\u555f\u9580\u8a3a.exe\u300d\u958b\u555f\u624d\u80fd\u8b80\u9019\u53f0\u7684\u5361\u3002\u7528 Chrome \u6216\u76f4\u63a5\u8cbc\u7db2\u5740\u9032\u4f86\uff0c\u8b80\u4e0d\u5230\u9019\u53f0\u96fb\u8166\u7684\u8b80\u5361\u6a5f\u3002", { cause: lastError });
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    data = {};
  }
  const code = data.statusCode;
  if (!res.ok || (typeof code === "number" && code !== 0)) {
    throw new DeskCardError("\u9019\u53f0\u8b80\u5361\u8edf\u9ad4\u56de\u8986\u5931\u6557\uff08" + String(code ?? res.status) + "\uff09\u3002");
  }
  return data;
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
