export type CatalogDrug = {
  drugNo: string;
  customName: string;
  shortName: string;
  /** MEDICAL.ALIAS_NO 輸入快碼 */
  alias?: string;
  nhiCode: string;
  sig: string;
  days: number;
  qty: number;
  /** MEDICAL.CAST/TYPE: oral|topical|injection|treatment|exam|material */
  route: "topical" | "oral" | "injection" | "treatment" | "exam" | "material" | string;
  selfPay: boolean;
  /** MEDICAL.ISSELF：空白健保、自、交（交付檢驗） */
  payMark?: "" | "\u81ea" | "\u4ea4";
  /** MEDICAL.MEMO：開立時帶入的註記，例如 [ */
  memo?: string;
  /** MEDICAL.TRADE_NAME 健保商品名 */
  name: string;
  /** MEDICAL.NOTE 成分說明 */
  generic: string;
  /** MEDICAL.INDEX＝Y 才是診所開放可開的藥；整檔裡未開放的不進看診下拉 */
  clinicIndex?: boolean;
};

export type CatalogDiagnosis = {
  icd10: string;
  text: string;
  short?: string;
  snomed: string;
  nhiIcd10: string;
  /** DIAGNOSE.A_CODE，ICD-9 */
  icd9?: string;
  nameEn?: string;
  nameZh?: string;
  /** DIAGNOSE.ACODE */
  aCode?: string;
  category?: string;
  special?: string;
  /** DIAGNOSE.INDEX：Y 才進看診選單 */
  enabled?: string;
};

export type CatalogPackageLine = {
  drugNo: string;
  qty: number;
  sig: string;
  days: number;
  useType?: string;
};

export type CatalogPackage = {
  id: string;
  name: string;
  lines: CatalogPackageLine[];
  code: string;
  dxCode: string;
  items: any[];
};

export type CatalogUsage = {
  code: string;
  frequency?: number;
  isTotal?: string;
  eatType?: string;
  label?: string;
  useageNo?: string;
};

export type ClinicCatalog = {
  drugs: CatalogDrug[];
  diagnoses: CatalogDiagnosis[];
  packages: CatalogPackage[];
  usages?: CatalogUsage[];
  routes?: string[];
};
