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
  /** MEDICAL.PRICE 主檔單價 */
  unitPrice?: number | null;
  /** MEDICAL.PRICE_SELF 診所自費賣價 */
  selfPayPrice?: number | null;
  batchNo?: string;
  company?: string;
  restrain?: string;
  unit?: string;
  dosimeter?: string;
  useType?: string;
  cast?: string;
  typeName?: string;
  dose?: number | null;
  dose2?: number | null;
  /** MEDICAL.SAFETY 存量 */
  stock?: number | null;
  /** MEDICAL.LOW 危量 */
  lowStock?: number | null;
  /** MEDICAL.COST 進價 */
  cost?: number | null;
  /** MEDICAL.U_COST 進貨單價 */
  unitCost?: number | null;
  totalPrice?: number | null;
  totalQty?: number | null;
  basePoint?: number | null;
  drugChg?: string;
  allergy?: string;
  mutual?: string;
  conflict?: string;
  sort?: number | null;
  typeSort?: number | null;
  indexFlag?: string;
  warning?: string;
  /** MEDICAL.ADAPT 適應症及備註（長文） */
  adapt?: string;
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
  indexFlag?: string;
  cast1?: string;
  cast2?: string;
  cast3?: string;
  remark?: string;
  nhiUsage?: string;
};

export type ClinicCatalog = {
  drugs: CatalogDrug[];
  diagnoses: CatalogDiagnosis[];
  packages: CatalogPackage[];
  usages?: CatalogUsage[];
  routes?: string[];
};
