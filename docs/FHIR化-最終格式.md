# FHIR 化最終格式（禮拜三換版的完成標準）

定於 2026-11-22。目標：16 區一次換到最終格式；沒全部驗證一致就延後，不硬上。觸點與陷阱見 `docs/FHIR化-讀寫清單.md`。

## 完成標準（三條都要過）

1. **FHIR 完整**：所有病歷資料都在 `resource_cache` 的 FHIR JSON 裡，網址只用本文件列的正式網址。
2. **表格全由 FHIR 重建**：在副本上清空所有索引表與病歷專表，只靠 FHIR 重建（`scripts/rebuild_from_fhir.py`），`fhir_baseline.py` 對照轉換前的錄製結果要 `IDENTICAL`。這證明「傳上去的就是全部」。
3. **寫入先 FHIR**：每個寫入點先寫 FHIR，再由 FHIR 產生表格；沒有任何寫入只改表格不改 FHIR。

畫面讀的 API 輸出不變，所以前端只需改「自己寫網址」的地方（`patientMaster.ts` 等）。

## 網址

- 自訂：`https://polarissehr.eskincrux.com/fhir/StructureDefinition/<名稱>`，全小寫，定了不改。
- 自訂識別碼：`https://polarissehr.eskincrux.com/fhir/sid/<名稱>`。
- 病歷號只在一間院所內唯一：`https://polarissehr.eskincrux.com/fhir/sid/medical-record/<醫事機構代號>`。
- TW Core 官方（v1.0.0）：
  - 健保藥品：`https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw`
  - ICD-10-CM：`https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2023-tw`
  - 身分證：`http://www.moi.gov.tw`；居留證：`http://www.immigration.gov.tw`；護照：`http://hl7.org/fhir/sid/passport-TWN`
- HL7：condition-clinical、condition-ver-status、v2-0203（識別碼類型）、UCUM。
- 舊網址（`clinic.org`、`wundadi.tw`、`wundadi.local`、自編的 `nhidcc.nhi.gov.tw`、`http://www.moi.gov.tw/id`、hl7 `icd-10`）：轉換時整批改寫成新網址；程式只認新網址。`terminology.extract_terminology_stickers` 判斷規則要跟著改（新 ICD 網址裡沒有 `nhi`）。

## 各區最終資源

| 區 | 最終 FHIR | 現有表格的角色 |
|----|-----------|----------------|
| 1 掛號、費用、讀卡 | Encounter；`encounter-queue`、`encounter-reg` 改正式網址；`reg_cc`、`reg_remark`、`claim_*`、`treat_seq`、`chief_complaint` 等只在索引的欄位寫進 JSON；還單、退押寫成 Encounter 擴充 `encounter-cash-return`（一筆一個子擴充） | `encounter_index`、`cash_return` 由 FHIR 產生 |
| 2 病人 | Patient（TW Core 識別碼）；診所欄位改 `patient-clinic` 正式網址 | `patient_index` 由 FHIR 產生 |
| 3 病名 | Condition；`entered-in-error` 改放 `verificationStatus` | `condition_index` 由 FHIR 產生 |
| 4 處方 | MedicationRequest；計費擴充只留一套 `medication-billing` | `medication_request_index` 由 FHIR 產生 |
| 5 主訴、SOAP | Composition；主訴只認一個正本 | `clinical_note_index` 由 FHIR 產生 |
| 6 生命徵象、過敏 | Observation、AllergyIntolerance | 索引由 FHIR 產生 |
| 7 預問診 | Encounter 擴充 `encounter-previsit`（不再冒用健保署網址） | 無 |
| 8 診斷證明、預約單 | DocumentReference（每次看診一筆，欄位放擴充） | `visit_certificate` 由 FHIR 產生 |
| 9 轉診 | ServiceRequest（轉出、回覆各一筆；`sheet_json` 放擴充） | `referral_slip` 由 FHIR 產生；`referral_download` 是署端清單快取，不是病歷，維持表格 |
| 10 論質檢驗 | DiagnosticReport | `quality_lab_report` 由 FHIR 產生；zip 檔照舊 |
| 11 照片 | Media 指標（`content.url` 指 LOOK 相對路徑）；LOOK 檔案不動；病灶 Media 照舊 | `look_file` 由 FHIR 產生 |
| 12 員工 | Practitioner + PractitionerRole | `clinic_staff` 保留 PIN（資安設定，不進 FHIR），其餘由 FHIR 產生 |
| 13 院所 | Organization | 費率、Sc.ini、工作站、列印設定是程式設定，維持設定檔 |
| 14 身分類別 | 程式設定，不是病歷 | 維持 `id_category_settings`；看診當時的身分已在 Encounter |
| 15 藥品、病名、用法主檔 | 程式設定，不是病歷 | 維持主檔 JSON 與 Pack；處方本身已帶健保碼 |
| 16 同步與稽核 | 稽核維持本機 `audit_modifications`（記哪台電腦與時間）；同步程式拿掉雲端 DELETE、沒設雲端時不再假裝同步成功 | — |

## 不可變的

- 月申報 XML、每日 IC XML、轉診 XML、論質 zip、所有列印，和轉換前逐字一致。
- LOOK 照片檔案、資料夾、檔名不動。
- 列印方向鎖定、裝置歸屬、禁止 DELETE 病歷、不准動主機（等使用者當次明說）。

## 換版當天（禮拜三，整天休診）

1. 主機先備份影子庫。
2. 大廳按更新裝新版（使用者按）；在主機執行一次轉換腳本。
3. Agent 在主機副本跑對照；診所照測試清單實測看診、列印、照片、存檔、申報。
4. 沒問題就上線；有問題就還原備份、裝回舊版。

## 進度

| 項目 | 狀態 |
|------|------|
| 病名、處方補 JSON（`materialize_index_only.py`） | 副本驗證一致 |
| 網址集中（`fhir_urls.py`） | 完成 |
| 缺口報告（`scripts/fhir_gap_report.py`，只讀副本） | 完成，見下節 |
| 其餘 | 進行中，見 `docs/FHIR化-讀寫清單.md` |

## 缺口（2026-11-22 主機副本，補 JSON 之後）

用店家自己的建索引函式把每筆 JSON 解回去，和現有索引逐欄比。「只在索引」代表 FHIR 裡沒有，換版前要寫進 JSON。

- **Encounter（455,078）**：只在索引：`chief_complaint` 444,743、`slot_time` 452,501、`times_no` 450,497、`owe_card` 全部、`reg_cc` 445,418（和 JSON `regCc` 只有 2,712 筆相同）、`claim_doctor_id`、`claim_pharmacist_id`、`treat_seq`（和 JSON 幾乎相同）。兩邊不同：`case_no` 205、`fee_drug_copay` 108、`queue_status` 3。
- **MedicationRequest（1,298,532）**：匯入的 JSON 用法是「bid * 3天 (qty: 1.0)」合成字，索引是乾淨的 `bid`（1,171,705）；單價只在索引（1,176,498）；部位只在索引（210,975）；`use_type` 1,282,546、`total_qty` 104,863、`line_sort` 3,384 只在索引；`pay_mark` 不同 9,490；狀態不同 48（刪掛號只改索引）。
- **Condition（603,209）**：524,070 筆 JSON 只有國際 ICD-10，健保 ICD 只在索引；266 筆兩碼不同（兩個都留）；狀態不同 23（刪掛號）。
- **Composition**：JSON 2,786 筆，只在索引 440,870 筆。
- **Patient（103,760）**：`phone2` 90,134 筆只在索引；`phone` 不同 547。
- Observation、Media：0 筆。過敏 3 筆一致。

原則：畫面、申報讀哪一邊，哪一邊就是正本，寫進 JSON；每個「兩邊不同」的欄位要先查讀取端用哪邊，不可猜。
