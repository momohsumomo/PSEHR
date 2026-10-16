/** This workstation identity (thin local layer; clinic policy lives on server). */

export type DeviceRole =
  | "register"
  | "outpatient"
  | "billing"
  | "pharmacy"
  | "admin"
  | "other";

export const DEVICE_ROLE_OPTIONS: { value: DeviceRole; label: string }[] = [
  { value: "register", label: "掛號台" },
  { value: "outpatient", label: "看診／診療" },
  { value: "billing", label: "批價" },
  { value: "pharmacy", label: "藥局／調劑" },
  { value: "admin", label: "行政／申報" },
  { value: "other", label: "其他" },
];

const DEVICE_ID_KEY = "wundadi.deviceId.v1";
const DEVICE_META_KEY = "wundadi.deviceMeta.v1";

export type LocalDeviceMeta = {
  id: string;
  label: string;
  role: DeviceRole;
  /** 這台電腦按存檔時要不要寫健保雲端。沒設過時，只有掛號台預設要寫。 */
  uploadCloudOnSave?: boolean;
  /** 這台電腦存檔後要不要跳出列印。沒設過時，看診和藥局要跳，掛號台不跳。 */
  printOnSave?: boolean;
};

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `dev-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `dev-${Date.now().toString(36)}`;
}

export function getOrCreateDeviceId(): string {
  try {
    const legacy = localStorage.getItem("machine_id");
    let id = localStorage.getItem(DEVICE_ID_KEY) || legacy || "";
    if (!id.trim()) {
      id = randomId();
    }
    localStorage.setItem(DEVICE_ID_KEY, id);
    if (!legacy) localStorage.setItem("machine_id", id);
    return id;
  } catch {
    return "dev-unknown";
  }
}

export function loadLocalDeviceMeta(): LocalDeviceMeta {
  const id = getOrCreateDeviceId();
  try {
    const raw = localStorage.getItem(DEVICE_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalDeviceMeta>;
      return {
        id,
        label: String(parsed.label || id),
        role: (parsed.role as DeviceRole) || "other",
        uploadCloudOnSave:
          typeof parsed.uploadCloudOnSave === "boolean" ? parsed.uploadCloudOnSave : undefined,
        printOnSave: typeof parsed.printOnSave === "boolean" ? parsed.printOnSave : undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return { id, label: id, role: "other" };
}

export function saveLocalDeviceMeta(meta: Omit<LocalDeviceMeta, "id"> & { id?: string }): LocalDeviceMeta {
  const id = meta.id || getOrCreateDeviceId();
  const next: LocalDeviceMeta = {
    id,
    label: meta.label.trim() || id,
    role: meta.role || "other",
    uploadCloudOnSave: meta.uploadCloudOnSave,
    printOnSave: meta.printOnSave,
  };
  localStorage.setItem(DEVICE_ID_KEY, id);
  localStorage.setItem(DEVICE_META_KEY, JSON.stringify(next));
  localStorage.setItem("machine_id", id);
  return next;
}

/** 看診電腦預設不送；櫃台（掛號台）預設要送。本機工作站勾過就以勾選為準。 */
export function thisPcUploadsCloudOnSave(meta: LocalDeviceMeta = loadLocalDeviceMeta()): boolean {
  if (typeof meta.uploadCloudOnSave === "boolean") return meta.uploadCloudOnSave;
  return meta.role === "register";
}

/** 看診、藥局預設存檔後跳列印。掛號台預設只存檔。本機工作站勾過就以勾選為準。 */
export function thisPcPrintsOnSave(meta: LocalDeviceMeta = loadLocalDeviceMeta()): boolean {
  if (typeof meta.printOnSave === "boolean") return meta.printOnSave;
  return meta.role === "outpatient" || meta.role === "pharmacy";
}
