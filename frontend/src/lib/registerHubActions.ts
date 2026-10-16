import type { HisStubId } from "@/components/clinic/HisStubDialog";

/** F2 掛號選項：依按鈕文字決定去向。空框只留給還沒接上的項目。 */
export type RegisterHubResult =
  | { kind: "readCard" }
  | { kind: "icInfo" }
  | { kind: "go"; path: string }
  | { kind: "referral" }
  | { kind: "cloud" }
  | { kind: "allergy" }
  | { kind: "say"; text: string }
  | { kind: "refund" }
  | { kind: "stub"; id: HisStubId };

const IC_WRITE =
  "健保 6.0 在診療 F9 存檔時就會寫入雲端，這裡不用另外寫";
const NOT_YET = "尚未接";

export function registerHubAction(label: string): RegisterHubResult {
  switch (label.trim()) {
    case "讀卡認證":
      return { kind: "readCard" };
    case "IC 資訊":
      return { kind: "icInfo" };
    case "每日上傳":
      return { kind: "go", path: "/upload-manager" };
    case "調閱S":
      return { kind: "go", path: "/emr-lookup" };
    case "收支":
      return { kind: "go", path: "/billing" };
    case "管藥":
      return { kind: "go", path: "/drug-control" };
    case "成健":
      return { kind: "go", path: "/preventive-care" };
    case "轉診":
      return { kind: "referral" };
    case "雲端":
      return { kind: "cloud" };
    case "過敏藥物":
      return { kind: "allergy" };
    case "IC 寫入":
      return { kind: "say", text: IC_WRITE };
    case "IC 退押":
      return { kind: "refund" };
    case "調閱退押":
      return { kind: "stub", id: "deposit" };
    case "疫苗":
      return { kind: "stub", id: "vaccine" };
    case "兒童":
      return { kind: "stub", id: "child" };
    case "銷售D":
      return { kind: "stub", id: "sale" };
    case "移至G":
    case "切換卡機":
    case "IC更新":
    case "戒菸":
    case "醫事登入":
      return { kind: "say", text: NOT_YET };
    default:
      return { kind: "say", text: NOT_YET };
  }
}
