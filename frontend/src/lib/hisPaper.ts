/**
 * 醫聖列印紙張設定檔（非固定 A4）。
 *
 * 來源：`Z:\SC\Sc.ini` [PRINTER]
 * - `使用系統內部指定紙張長度=Y`
 * - `第二份執行 ORDER 紙張長度=1016` / `紙張寬度=1140`
 * - `單排執行 ORDER 紙張長度(mm)=1016.00`
 *
 * 醫聖慣用單位為 **0.1 mm**（十分之一毫米）：1140 → 114.0mm、1016 → 101.6mm。
 * 這是左右雙欄（藥單／收據）的橫短紙，不是 A4 直式。
 *
 * 掛號簿／現金帳總表：報表本身為橫式寬紙（截圖約 16:9），非 A4 直向。
 */

export type HisPaperId =
  | "a4"
  | "a4_landscape"
  | "a5"
  | "order_dual"
  | "register_book"
  | "slip";

export type HisPaperProfile = {
  id: HisPaperId;
  /** 狀態列／除錯顯示 */
  label: string;
  widthMm: number;
  heightMm: number;
  padXMm: number;
  padYMm: number;
  /** CSS @page size */
  pageCss: string;
  /** 預覽預設縮放 % */
  defaultZoom: number;
};

/** Sc.ini ORDER／左右雙欄收據：寬 1140、長 1016（0.1mm） */
const ORDER_W_TENTH_MM = 1140;
const ORDER_H_TENTH_MM = 1016;

export const HIS_PAPER_PROFILES: Record<HisPaperId, HisPaperProfile> = {
  a4: {
    id: "a4",
    label: "A4 直向",
    widthMm: 210,
    heightMm: 297,
    padXMm: 12,
    padYMm: 12,
    pageCss: "A4 portrait",
    defaultZoom: 85,
  },
  a4_landscape: {
    id: "a4_landscape",
    label: "A4 橫向",
    widthMm: 297,
    heightMm: 210,
    padXMm: 10,
    padYMm: 10,
    pageCss: "A4 landscape",
    defaultZoom: 80,
  },
  a5: {
    id: "a5",
    label: "A5",
    widthMm: 148,
    heightMm: 210,
    padXMm: 10,
    padYMm: 10,
    pageCss: "A5",
    defaultZoom: 100,
  },
  /** 執行 ORDER／藥單+收據左右並排（Sc.ini 內部指定） */
  order_dual: {
    id: "order_dual",
    label: "ORDER／收據左右雙欄",
    widthMm: ORDER_W_TENTH_MM / 10,
    heightMm: ORDER_H_TENTH_MM / 10,
    padXMm: 2,
    padYMm: 2,
    pageCss: `${ORDER_W_TENTH_MM / 10}mm ${ORDER_H_TENTH_MM / 10}mm`,
    defaultZoom: 100,
  },
  /**
   * 掛號簿／現金帳：寬 297mm。高度是原本 165mm 的三倍，給兩倍字用。
   */
  register_book: {
    id: "register_book",
    label: "掛號簿橫式",
    widthMm: 297,
    heightMm: 495,
    padXMm: 8,
    padYMm: 6,
    pageCss: "297mm 495mm",
    defaultZoom: 90,
  },
  slip: {
    id: "slip",
    label: "小張",
    widthMm: 80,
    heightMm: 140,
    padXMm: 4,
    padYMm: 4,
    pageCss: "80mm 140mm",
    defaultZoom: 100,
  },
};

export function resolveHisPaper(id: HisPaperId | undefined): HisPaperProfile {
  return HIS_PAPER_PROFILES[id || "a4"] || HIS_PAPER_PROFILES.a4;
}

/** 相容舊 HisPaperKind 字串 */
export function coerceHisPaperId(raw: string | undefined): HisPaperId {
  if (!raw) return "a4";
  if (raw in HIS_PAPER_PROFILES) return raw as HisPaperId;
  if (raw === "A4") return "a4";
  if (raw === "A5") return "a5";
  if (raw === "slip") return "slip";
  return "a4";
}
