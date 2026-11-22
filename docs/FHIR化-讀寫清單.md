# FHIR 化讀寫清單（遷移前盤點）

本機資料最終要全部改成標準 FHIR（TW Core 為底）。這份清單列出**目前每一種資料存在哪裡、哪些程式寫它、讀它、顯示它、印它、申報或上傳它、匯入它**。以後動任何一塊資料的儲存方式，先查這份，逐條勾完才算改完。

- 盤點日期：2026-11-22，依當時 `main` 的程式靜態搜尋，未開啟 `data/shadow.db`。
- 行號為約略值，程式改過就會偏移，以函式名為準。
- 新增欄位、新增列印、新增匯入腳本時，要回來補這份清單。

## 使用方式

1. 要遷移某一區資料前，先讀該區的「目前存放」與「陷阱」。
2. 依「觸點」逐一確認：每一個寫入點改成寫新格式；每一個讀取、顯示、列印、申報點都要用舊資料和新資料各跑一次，結果一致。
3. 「外部格式」那欄是健保或醫聖規定的格式，FHIR 化之後**照樣要產出一模一樣的檔案**。
4. 列印方向鎖定（`turnWidePortraitJob`、`Convert-SlipForFeed`、`ys-rot`、Sumatra 字串）不在遷移範圍，不准碰。

## 總覽

| 區 | 資料 | 目前主要存放 | 已是 FHIR 嗎 | 列印 | 申報／上傳 |
|----|------|--------------|--------------|------|-----------|
| 1 | 掛號、費用、讀卡 | Encounter 擴充 `encounter-reg`／`encounter-queue` + `encounter_index.fee_*` + `cash_return` | 半套：JSON 是 FHIR 外殼，內容全是自訂擴充 | 收據、押金單、掛號簿、現金帳 | 月申報、每日 IC |
| 2 | 病人主檔 | Patient + `patient_index` | 大致是，診所欄位全在自訂擴充 | 所有單據抬頭 | 月申報、IC |
| 3 | 病名 | `condition_index` 為主，`resource_cache` 常缺 | 半套：清單由索引合成，code 常無 system | 收據、處方箋、證明、轉診 | 月申報 |
| 4 | 處方／處置 | `medication_request_index` 為主 | 半套：擴充網址兩套並存 | 收據、處方箋、交付檢驗 | 月申報、IC |
| 5 | 主訴／SOAP | `encounter_index.chief_complaint` + Composition | 半套：三處來源合併 | 收據、轉診 | — |
| 6 | 生命徵象、過敏 | Observation／AllergyIntolerance + 索引；過敏另有主檔字串 | 是，但過敏雙軌 | 轉診 | — |
| 7 | 預問診 | Encounter 擴充 `patient-previsit` | 擴充，無索引 | 不印 | — |
| 8 | 診斷證明、預約單 | `visit_certificate` 專表 | 否 | 證明、預約單 | — |
| 9 | 轉診 | `referral_slip`／`referral_download`／`referral_accept` + Encounter 擴充 | 否 | 轉診單 | 轉診 XML、月申報 d55 |
| 10 | 論質檢驗 | `quality_lab_report` + zip 檔 | 否 | 無紙本 | type 26 |
| 11 | 照片 | LOOK 檔案樹 + `look_file`；病灶 Media 存 base64 | LOOK 否；病灶 Media 是 | — | — |
| 12 | 員工 | `clinic_staff` | 否（路由叫 `/fhir/staff` 但不是 Practitioner） | 醫師、藥師姓名 | 月申報 d31 |
| 13 | 院所設定 | `clinic_runtime_settings` 多個 JSON + 前端 localStorage | 否 | 所有抬頭 | 院所代號、科別 |
| 14 | 身分類別 | `id_category_settings` + Patient／Encounter 擴充 | 否 | 費用 | 部分負擔代碼 |
| 15 | 藥品、病名、用法主檔 | `frontend/public/yisheng_clinic_catalog.json` + `clinic_catalog_overrides_v1`；藥價在 Pack | 否 | 藥名、提醒 | 藥價、特定治療 |
| 16 | 同步與稽核 | `sync_queue`、`audit_modifications`、少量 AuditEvent | 部分 | — | 雲端（目前模擬） |

---

## 區 1：掛號、費用、讀卡

### 目前存放

- `resource_cache` 的 Encounter JSON：
  - `encounter-queue` 擴充：`queueNumber`、`queueStatus`。
  - `encounter-reg` 擴充：字串鍵 `REG_STRING_KEYS`、布林鍵 `REG_BOOL_KEYS`，定義在 `src/core/encounter_extensions.py`。包含案類、部分負擔代碼、就醫序號、卡片序號、簽章、醫師、藥師、各項費用、轉診、IC 上傳、`regCc`、`idCategory` 等約 60 個鍵。
  - `Encounter.status`、`period.start`、`subject`。
- `encounter_index`：`queue_*`、`copay_code`、`case_no`、`fee_deposit`／`fee_copay`／`fee_card_disc`／`fee_drug_disc`／`fee_drug_copay`／`fee_reg`／`fee_self`／`fee_total`／`fee_arrears`、`ic_upload_date`、`chief_complaint`、`shift`、`slot_time`、`times_no`、`owe_card`、`reg_cc`、`reg_remark`、`claim_doctor_id`、`claim_pharmacist_id`、`treat_seq`。
- `cash_return`：還單、退押現金，以看診日入帳。
- 寫入鏈：`create/update` → `cache_resource` → `_stamp_cash_book_marks`（會改 JSON）→ `_upsert_encounter_index` → `_write_cash_book_columns`。

### 觸點

- **定義**：`encounter_extensions.py`（`put_reg_string`、`attach_reg_extension`、`extract_reg_meta`）。
- **寫入（後端）**：
  - `nhi_clinical_mappers.nhi_encounter_to_fhir`（新掛號初值）
  - `nhi.py`：`register_nhi_encounter`、`patch_encounter_reg`（F3）、`_link_incoming_referral`、`card_seq_next`、`card_write_visit`、`refund_deposit`、`cancel_register`
  - `encounter.py`：`create/update_encounter`、`transition_queue_status`
  - `sqlite_shadow_store.update_encounter_queue_status`
  - `referral.py._save_reg`
  - `deposit_refund.apply_refund` → `insert_cash_return`
- **讀取（後端）**：
  - `list_encounters_for_date`、`get_encounter_queue_meta`（組 queueMeta）
  - `list_encounters_for_patient`（只有六個基本欄位）
  - `cash_book_summary`（只加總索引）
  - `encounter.py`：`emr_lookup_encounters`、`cash_book_summary`
  - `kiosk.py`、`same_day.py`、`quality_lab.py`
  - `nhi_card_bridge`、`nhi_seq_bridge`、`nhi_treatment_bridge`、`register_guard`
  - `referral_inbox`、`patient_visit_history`、`reg_discount_report`
- **申報／上傳**：
  - `claims/engine.py`（`unfinished_visits`、月組檔）
  - `ic_daily_upload.py`（`collect_ic_day`、`_compose`）、`ic_upload_send.py`
  - `xml_export_nhi.py`（d29）、`media_check.py`、`deposit_refund.py`、`yisheng_rules.py`
- **前端**：
  - `useClinicWorkspace.mapQueueEntry`（幾乎讀全部 queueMeta）
  - 存檔時重算 `totalFee`
  - `EncounterQueuePanel`、`RegisterEditDialog`、`RegisterConfirmDialog`、`RegisterPage`、`ClinicOutpatientPage`、`BillingPage`、`EmrLookupPage`、`VisitSaveConfirmPanel`、`ClaimsPage`
  - `lib/cardIdentity.ts`、`visitFees.ts`、`emrLookupSort.ts`
- **列印**：`simpleSlip.ts`、`visitReceiptPrint.ts`、`clinicPrintDocs.ts`（押金單）、`registerBookReport.ts` + `HisRegisterBookPaper`、`HisCashDetailPaper`、`cashDetailXlsx.ts`。
- **匯入／修補腳本**：
  - 匯入：`import_yisheng_data.py`、`import_yisheng_lean.py`、`sync_yisheng_since.py`
  - 補資料：`backfill_cash_book.py`、`backfill_cash_columns.py`、`backfill_reg_cc.py`、`backfill_noid_patients.py`、`backfill_blank_odate_visits.py`、`backfill_claim_source.py`、`backfill_ic_upload_fields.py`、`backfill_cash_return_people.py`
  - 修復：`restore_selfpay_07y.py`、`repair_register_queue_meta.py`、`repair_imported_cc_and_appts.py`、`repair_register_slot_clock.py`

### 外部格式

- 月申報 XML（d29 就醫序號等）、每日 IC 上傳 XML、健保卡寫卡（6.0 雲端）。
- 醫聖 REGISTER、CC、備註欄位語意（匯入期）。

### 陷阱

1. 費用的正本在 reg JSON；`fee_*` 是報表快取。掛號簿只看索引，兩邊不同步就會對不上帳。
2. `update_encounter_queue_status` 只改索引和 `status`，不改 queue 擴充裡的 `queueStatus`。
3. `treat_seq` 索引欄存在，但日常存檔不寫，只有匯入腳本寫。
4. `reg_cc`、`reg_remark` 主要在索引。初診看第 4 字元 `$`，欠卡看「押」，掛號簿的 SQL 依此分桶。
5. 不在白名單的 reg 鍵（例如 `depositPaid`、`icRolledBack`）會被丟掉，不進 JSON。
6. 多處直接 `json.loads` 解析 reg，沒走統一讀取層（`reg_discount_report`、`engine`、`ic_daily_upload._load_reg`、`nhi_card_bridge`）。
7. `list_encounters_for_patient` 回傳的欄位很少，歷史畫面若靠它會缺費用與序號。
8. 還單算在看診日，退押上傳算在退押當日。
9. `chief_complaint`（醫師主訴）、`regCc`（醫聖 6 碼 CC）、`visitCc` 是三種不同東西。
10. `totalFee` 由前端組，後端 `patch_encounter_reg` 另有 `adjusted_visit_total`（已退押）。兩邊規則要一起搬。
11. 醫聖欄位對照散在 `backfill_cash_book._iter_fields`，申報和 IC 也在引用。
12. 相關測試：`test_deposit_cash*.py`、`test_reg_discount_report.py`、`test_queue_keep_closed.py`。

---

## 區 2：病人主檔

### 目前存放

- Patient JSON：`name`、`gender`、`birthDate`、`identifier`（內政部身分證、健保、病歷號 `https://clinic.org/chart-number`）、`telecom`、`address`。
- 擴充 `nhi-card-basic`：`idNo`、`birthdayRoc`、`sex`。
- 擴充 `https://clinic.org/fhir/StructureDefinition/patient-clinic-ext`：`memo`、`keymoney`、`arrearage`、`kind`、`idCategory`、`allergic`、`nhiCardNo`、`blood`、`marry`、`customId`、`copayDisc`、`postalCode`、`parentId`、`birthOrder`、護理之家欄位、聯絡人、`familyCareDate`、`familyCareCase`、`closeReason`、`medicalHistory` 等。
- `patient_index`：姓名、身分證、生日（西元與民國）、性別、病歷號、電話、地址、`id_category`，以及可能存在的 `phone2`。

### 觸點

- **寫入**：
  - `cache_resource`，Patient 時會自動補身分類別並寫稽核
  - `_upsert_patient_index`、`reevaluate_patient_id_category`
  - `patient.py`：`create_patient`、`update_patient`、`delete_patient`
  - `nhi.py.register_nhi_patient`；`nhi_fhir_mapper`（`nhi_intake_to_fhir_patient`、`merge_nhi_patient_update`）
- **讀取**：
  - `search_patients`、`list_patient_roster`、`address_for_home_phone`
  - `list_family_members`（用電話或地址比對，不是 `Patient.link`）
  - `_clinic_fields_from_payload`
  - `outpatient.py` workspace、`kiosk.py`、`quality_lab.py`、`referral_inbox`、`care_online_import`
- **申報**：`engine.py` JOIN `patient_index`、`xml_export_nhi.py`、`ic_daily_upload.py`、`deposit_refund.py`、`reg_discount_report.py`。
- **前端**：
  - `lib/patientMaster.ts`（`fhirToPatientRecord` / `patientRecordToFhir`，主檔編輯契約）
  - `PatientEditDialog`、`PatientListPage`、`RegisterPage`、`EmrLookupPage`、`RegisterConfirmDialog`、`SelfRegisterKioskPage`
- **列印**：所有單據的姓名、病歷號、身分證、生日、性別、年齡、住址、電話。
- **匯入**：`import_yisheng_data.py`、`import_yisheng_lean.py`、`sync_yisheng_since.py`、`backfill_noid_patients.py`、`backfill_patient_chart_fields.py`、`backfill_family_care.py`、`backfill_phone_allergy.py`、`repair_patient_id_category_ext.py`。

### 陷阱

1. 健保卡欄位和診所欄位分在兩個擴充；`id_category` 同時在索引和擴充，存檔時會被自動改寫。
2. 沒有身分證的病人要照樣存，病歷號當索引（醫聖匯入規則）。
3. 家族成員靠電話和地址的 SQL 比對，FHIR 化時要決定是否改成 `Patient.link` 或 `RelatedPerson`。
4. 過敏同時有主檔字串 `allergic` 和 AllergyIntolerance 資源；轉診單印的是哪一個要確認。
5. Patient DELETE 路徑仍存在（有就診會擋 409）。

---

## 區 3–5：病名、處方、主訴／SOAP

### 目前存放

- **Condition**：`condition_index`（`icd10_code`、`snomed_code`、`nhi_icd10_code`、`summary_text`、`clinical_status`）。`resource_cache` 在精簡匯入時常常沒有這筆。
- **MedicationRequest**：`medication_request_index`，加上 `useage`、`pay_mark`、`memo_mark`、`body_site`、`total_qty`、`use_type`、`line_sort`。擴充子鍵有 `daysSupply`、`quantity`、`unitPrice`、`packVersion`、`priceDate`、`bodySite`、`tradeName`、`payMark`、`memoMark`。
- **主訴**：`encounter_index.chief_complaint` → `clinical_note_index.chief_complaint` → `Encounter.reasonCode` → Composition（`STORED_CHIEF_COMPLAINT_SQL`）。
- **Composition**：LOINC section + 擴充 `outpatient-soap`；索引 `clinical_note_index`。

### 觸點

- **寫入**：
  - `_upsert_condition_index`、`_upsert_medication_request_index`、`_upsert_clinical_note_index`
  - `retain_encounter_chart`（沒在本次存檔中的舊病名改 entered-in-error，舊處方改 cancelled）
  - `condition.py`、`medication_request.py` CRUD
  - `nhi.py`：`register_nhi_condition`、`register_nhi_medication`（含藥價 Pack）、`register_nhi_soap`（同時寫 reasonCode 和 `set_encounter_chief_complaint`）
  - `nhi_clinical_mappers`、`nhi_soap_fhir_mapper`、`api/schemas/medication_request.to_fhir_dict`
- **讀取**：
  - `list_conditions`、`list_medication_requests`：由索引**合成** FHIR，不讀 cache
  - `lookup_chief_complaint`、`list_visit_summaries_for_patient`
  - `outpatient.py` workspace、`patient_visit_history`
  - `clinic_reports.py`（疾病、藥品、診療統計，直接 SQL）
  - `kiosk.py` 完診判斷、`nhi_card_bridge`（自費判斷）、`cc_learn.py`（主訴詞庫）
- **申報**：`engine.py`（病名碼、逐筆藥品、payMark 交／轉／材）、`case_rules.py`、`xml_export_nhi.py`（p24 交付檢驗）。
- **前端**：
  - `useClinicWorkspace`（`marksOf`、`persistChiefComplaint`、`ensureOutboundReferralOrder`、`ensureAcceptReferralOrder`）
  - `DiagnosesWidget`、`RxGrid`、`HistoryRxPanel`、`ClinicOutpatientPage`、`EmrLookupPage`、`DrugCatalogPage`
  - `lib/dittoRxLines.ts`、`caseMark.ts`、`drugCopay.ts`、`utils/nhiIntake.ts`
- **列印**：`simpleSlip.ts`、`visitReceiptPrint.ts`、`releaseRx.ts`、`delegateLabSlip.ts`、`clinicPrintDocs.ts`（轉診）。
- **匯入／修補腳本**：
  - 匯入：`import_yisheng_data.py`、`import_yisheng_lean.py`、`sync_yisheng_since.py`
  - 補資料：`backfill_blank_odate_visits.py`、`backfill_missing_real_dx.py`、`backfill_missing_rx.py`、`backfill_body_site.py`、`backfill_noid_patients.py`
  - 修復：`repair_h603_icd.py`、`repair_condition_shortcuts.py`、`repair_history_rx_marks.py`、`repair_maintell_chief_complaint.py`
  - 反向補 cache：`bulk_materialize_fhir_from_index.py`

### 陷阱

1. **索引才是正本**：清單由索引合成，`code.coding` 常只有 code 和 display、沒有 system；`clinicalStatus` 也沒有 HL7 網址。遷移第一步要先決定正本，並把只有索引的列補成完整 FHIR。
2. **處方擴充網址兩套**：寫入用 `https://wundadi.local/fhir/StructureDefinition/medication-billing/*`，讀取合成用 `https://clinic.org/fhir/StructureDefinition/billing/*`，靠 `endswith` 比對。
3. `pay_mark`／`memo_mark` 只有擴充裡**出現該鍵**時才更新索引；省略不等於清空。空白（健保）和「自」在申報分開處理。
4. 主訴三路合流；`regCc`、掛號 `reasonText`、預問診的 `chiefComplaint` 都**不是**醫師主訴。
5. 交付檢驗單沒有專表，是從 MedicationRequest 的 payMark 交／轉即時組出來的。只搬「文件表」會漏掉它。
6. `repair_condition_shortcuts.py` 會 DELETE 全部 Condition 再重寫（維運腳本，和禁止 DELETE 原則衝突）。

---

## 區 6–7：生命徵象、過敏、預問診

- **Observation**：`resource_cache` + `observation_index`。`list_observations` 用 INNER JOIN cache，只有索引沒有 cache 的不會出現在診間。寫入：`nhi.py.register_nhi_observation`、`nhi_observation_fhir_mapper`。讀取：`observation.py`、workspace。
- **AllergyIntolerance**：`resource_cache` + `allergy_index`。寫入：`nhi.py.register_nhi_allergy`、`allergy_intolerance.py`、`backfill_phone_allergy.py`。讀取：`list_allergy_payloads`、`outpatient._allergy_rows_for_patient`。另有主檔 `allergic` 字串。
- **預問診**：只存在 Encounter 擴充 `patient-previsit`（`completed`、`chiefComplaint`、`symptomTags`、`submittedAt`、`visitKind`），沒有索引。
  - 寫入：`attach_previsit_extension`、`kiosk.py` submit、`nhi.py.submit_previsit`。
  - 讀取：`previsit_text`，以及 workspace 的 `previsitText`／`visitKind`。
  - 不印、不當主訴（見 `docs/交接-目前進度.md`）。

---

## 區 8：診斷證明、預約單

### 目前存放

- `visit_certificate`：一個看診一列，只 UPDATE 不 DELETE。欄位有 `doc_no`（8 碼文號）、`visit_date`、`print_date`、`diagnosis`、`order_text`、`appointment_text`、`english`、`doctor`、`source`，以及病歷號與姓名快照。
- 設定鍵 `certificate.yishengMaxSerial`（醫聖文號上限）。
- 沒有 FHIR 資源。

### 觸點

- **寫入**：`visit_certificate.save_for_visit`、`import_yisheng_certificates`（主機啟動時在背景匯入，不覆蓋已存列）、`certificate.py` 的 `PUT /clinic/certificate`。
- **讀取**：`find_for_visit`、`next_serial`、`GET /clinic/certificate`。
- **前端**：`CertificateDialog`（A/B/D/E 分頁只是占位，不存）、`ClinicOutpatientPage`、`clinicApi.fetchVisitCertificate`／`saveVisitCertificate`。
- **列印**：`clinicPrintDocs.buildCertificateHtml`（210×297 直向）；預約單是 `CertificateDialog.printAppointment` 的內嵌 HTML，不走同一個範本。
- **測試**：`test_visit_certificate.py`。

### 外部格式

醫聖 `REGIOTH.Dat`、`DIAGSERN.Dat`、`REGISTER.Dat`（cp950）。

### 陷阱

1. 文號要全院唯一：DB 裡的 `doc_no` 和 `yishengMaxSerial` 要合併計算。
2. 預約單和診斷證明共用同一列。
3. 醫聖匯入的列常缺姓名與病歷號，顯示時靠當次看診資料補。

---

## 區 9：轉診

### 目前存放

- `referral_slip`：`kind` 有 out 和 reply 兩種。欄位包括轉往院所、科別、目的、醫師、病名、序號、效期、狀態、`history_text`、`treat_text`、`sheet_json`、`local_id`、`nhi_id`、`uploaded_at`。
- `referral_download`（署端清單快取，主鍵是 serial 加 kind）、`referral_accept`。
- 設定鍵 `referral_pull`、`referral_file_seq`。
- Encounter reg 擴充：`referralSeq`、`referralHospId`、`referralHospName`、`referralDate`、`acceptReferral`。
- 醫聖封存列 `ys-out-*`、`ys-reply-*`。

### 觸點

- **寫入**：`referral_desk.py`（`save_slip`、`mark_uploaded`、`remove_slip`（會 DELETE）、`take_incoming`、`ensure_yisheng_archive`、`attach_bureau_serial`）、`referral_inbox.py`（`remember_download`、`apply_list_rows`、`mark_accepted`）、`nhi._link_incoming_referral`。
- **組上傳檔**：`referral.py`（`_pack_upload` ETA／ETB、`_pack_accept` ETE、`_pack_delete` ETG／ETH、`referral_pull` type 27、`referral_query`）、`nhi_referral.py`（`build_*_xml`、`query_referrals`）。
- **申報**：`engine._outbound_referral_codes`、`_referral_fee_destination`（01036C）、`xml_export_nhi.py`（d16、d17、d18、d55）、`media_check.py`。
- **前端**：`ReferralSlipDialog`、`ReferralPage`、`ReferralReplyForm`、`ReferralAcceptDialogs`、`RegisterConfirmDialog`、`useClinicWorkspace`（01036C、01038C 醫令）、`clinicApi`（實際上傳經本機 5310 的 `/tools/referral-io`）、`clinicDevice.uploadReferralOnSave`。
- **列印**：`clinicPrintDocs.buildReferralSlipHtml`（210×297，可印多聯）；轉診單設定存在 localStorage `wundadi.referralSettings.v1`。
- **客戶端**：`客戶端/referral_io.ps1`、`referral_daily.ps1`、`desk_agent.ps1`、`轉診上傳工具/轉診上傳工具.ps1`。
- **測試**：`test_referral*.py`、`test_claims_nhi_check.py`。

### 外部格式

Big5 XML ETA、ETB、ETE、ETG、ETH；`NHI_DownloadB`（type 04、10）；`NHI_GetB`（type 27，Big5 CSV）；`GetRefData` HTTPS JSON；月申報 d16–d18、d55；醫聖 REFERRAL、REFERETURN。

### 陷阱

1. `sheet_json` 和一般欄位分家；FHIR 化後組 XML 時資料仍要齊全。
2. 轉診單允許有條件 DELETE，跟病歷禁刪的政策要另外定。
3. 未上傳的紙本單（`paper: Y`）不進 d55。
4. 「已接受」的狀態散在 slip、download、accept 三張表和 Encounter 擴充四個地方。
5. 上傳一定在開網頁的那台 5310 上做，主機只負責組檔。
6. 回覆單可能沒有綁 encounter。

---

## 區 10：論質檢驗（type 26）

- **存放**：
  - `quality_lab_report`（每次看診的每個處置一列；`report_text`、`slip_no`、`report_on`、`status` 為 saved 或 uploaded、`local_id`、`nhi_id`）
  - `{db 目錄}/quality-lab/*.zip`、`quality_lab_seq.json`
  - 白名單 `QUALITY_ORDERS`：目前只有 13017C
- **觸點**：
  - 後端：`quality_lab_desk.py`（save、mark_uploaded、list）、`quality_lab.py`（`build_lab_xml`、`pack_zip`、`alloc_serial`）、`api/routers/quality_lab.py`
  - 前端：`QualityLabPanel`、`RxGrid`、`ClinicOutpatientPage`、`clinicApi`（經 referral-io send type 26）
  - 客戶端工具：`論質上傳工具/`、`論質檢驗上傳小工具/`
- **外部格式**：Big5 XML `<checkup>`、ZIP 檔名（院所碼 + 民國日期 + 流水號）、`NHI_SendB` 和 `NHI_DownloadB` 兩條上傳路徑。
- **陷阱**：
  1. 面板上的影像只在瀏覽器記憶體，沒存。
  2. `slip_no` 由前端 sessionStorage 產生。
  3. 已上傳後 `/file` 會拒絕重送。

---

## 區 11：照片

### 目前存放

- **LOOK 主相簿**：`data/look/aa/bb/cc/`（病歷號 6 碼拆三層），檔名是病歷號 + 2 碼 base36 序號。可用 `WUNDADI_LOOK_DIR` 覆寫；舊路徑 `Z:\SC\IMG` 為退路；「刪除」的照片移到 `data/look-removed/`。
- `look_file`（檔名索引）、`look_sync_state`。
- 病灶 Media：`resource_cache` 存完整 JSON，`content.data` 是 base64；另有 `media_index`。

### 觸點

- `look_images.py`：
  - 讀取：`look_root`、`list_look_files`、`charts_with_images`（看檔案修改時間，不讀 DB）、`iter_chart_photos`、`resolve_look_file`
  - 寫入：`write_look_image`、`set_look_date`、`replace_look_file`、`retire_look_file`
- `sqlite_shadow_store`：`note_look_files`、`note_look_date`（寫稽核，類型 LookPhoto）、`charts_with_media`、`list_media`（遮蔽 base64）、`_upsert_media_index`。
- `media.py`：`/fhir/Media`、`look-folder`、`look-sync`、`look-file`（新增、替換、改日期、移出、取檔）、`get_media?includeData`。
- `nhi.py`：`register_nhi_media`（前端沒有呼叫它）、`list_media_by_encounter`；`nhi_media_fhir_mapper`。
- `encounter.py` emr-lookup 的 `hasImage` 篩選。
- **前端**：`PatientLookDialog`（先讀 LOOK，沒有才讀 FHIR）、`LesionPhotosWidget`（workspace 目前回空陣列）、`EmrLookupPage`、`LobbyPage`（對齊檔名）、`ImgManagerPage`（原型，不寫）、`clinicApi`。
- **其他**：`export_clinic_pack.write_look_index`；repo 外的照片分類工具 `clinic-image-categorize-master` 會呼叫 look-sync。
- **測試**：`test_look_images.py`。

### 陷阱

1. 三種東西不同：LOOK 檔案、病灶 Media（base64 存在 DB）、`look_file` 索引。FHIR 化建議把影像本體放 Binary 或外部檔案，DB 只放 Media／DocumentReference 指標，不要把相簿塞進 base64。
2. 「有圖像」的篩選看檔案修改時間加 `media_index`，`look_file` 不參與。
3. LOOK 刪除是移檔，不碰 FHIR；LOOK 改日期的稽核記在 `audit_modifications`，不是 Media。
4. `delete_cached_resource` 不會清 `media_index`；`reindex_from_cache.py` 不重建 Media 和 Composition 的索引。
5. 醫美相片知識庫（KAN-24）是另一件事，不在這裡改。

---

## 區 12：員工

### 目前存放

- `clinic_staff`：`id`、`name`、`role`、`nhi_id`、`cert_no`、`pin`、`status`、`room`。
- Encounter reg 擴充：`doctorId`、`doctorName`、`pharmacist`。藥師欄可能存員工 id，也可能直接存姓名。
- `encounter_index.claim_doctor_id`、`claim_pharmacist_id`：只有匯入和 backfill 會寫。
- `audit_modifications.operator_identity`（由 PIN 解析）。

### 觸點

- **寫入**：
  - `save_staff`、`delete_staff`（DELETE）
  - `staff.py`、`import_yisheng_clinic_settings.py`（整表替換）
  - `nhi.py` 存檔時寫入 doctorId／pharmacist
  - `sync_yisheng_since.py`、`backfill_claim_source.py`
- **讀取**：
  - `get_staff_list`、`verify_pin`、`main.py` middleware（`x-pin-code`）
  - `engine._load_staff_maps`、`_default_pharmacist_id`、`claim_month_reports`（藥師點數）
  - `referral.py`（醫師代號）、`nhi.py` 破窗雙 PIN、`ic_daily_upload.py`
- **前端**：`StaffPage`、`VisitSaveConfirmPanel`、`ClinicOutpatientPage`、`RegisterConfirmDialog`、`ClinicSessionGate`、`RegisterPage`、`ClinicProfilePage`、`lib/doctorName.ts`。
- **列印**：`simpleSlip.ts`、`visitReceiptPrint.ts`、`registerBookReport.ts`、`delegateLabSlip.ts`（醫師代號）、`releaseRx.ts`、`cashDetailXlsx.ts`。
- **申報**：`xml_export_nhi.py` d31（藥師）。

### 陷阱

1. 同一個人有三種識別：內部 id、姓名、健保身分證。藥師常只存姓名，申報時用姓名對照表轉 NHI；對照失敗就變空白或改用預設藥師。
2. `claim_*` 索引和日常存檔脫鉤。
3. 列印前常重新抓員工表，所以印出的名字可能和存檔當下不同。
4. PIN 屬於本機資安設定，不放進 FHIR。
5. FHIR 目標：Practitioner + PractitionerRole，看診改用 `Encounter.participant` 參照。

---

## 區 13：院所設定

### 目前存放

- `clinic_runtime_settings` 各鍵：
  - `clinic_profile_v1`：profile、fees、workflow 三塊
  - `yisheng_scini_v1`：醫聖 Sc.ini 全文
  - `clinic_devices_v1`：工作站與裝置的列印設定
  - `clinic_role_overrides_v1`
  - `clinic_case_rules_v1`
  - `clinic_catalog_overrides_v1`
  - `yisheng_id_categories_v1`
  - 另有稽核、轉診序號、IC 紀錄等鍵
- 程式預設：`clinic_settings.DEFAULT_PROFILE` 含示範機構資料；前端 `clinicProfile.ts` 的 `DEFAULT_*`。
- 前端 localStorage：`wundadi.printSettings.v1`、裝置 meta、當班 session、`readLocalClinicBundle()`（院所資料鏡像，**列印抬頭多半讀這裡**）。

### 觸點

- **寫入**：`clinic_settings.py`（`put_clinic_profile`、`put_scini_settings`、`put_device`、`put_role_overrides`、`put_case_rules`）、`import_yisheng_clinic_settings.py`、`clinicProfile.persistClinicBundle`。
- **讀取**：
  - `engine.py`（`_clinic_dept_code`、`_clinic_lab_code`、調劑型態）
  - `ic_upload.py`、`referral.py`、`quality_lab.py`、`claims.py`
  - `get_effective_settings`（院所、角色、裝置三層合併）、`db_backup.py`
- **前端**：`ClinicProfilePage`、`SciniParamsEditor`、`CaseClassPanel`、`SelfRegisterKioskPage`、`ClinicOutpatientPage`。
- **列印**：`clinicPrintDocs.ts`、`simpleSlip.ts`、`visitReceiptPrint.ts`、`registerBookReport.ts`、`delegateLabSlip.ts`、`releaseRx.ts`（院所名、代號、執照、地址、電話、科別）。

### 陷阱

1. 掛號費同時存在 profile 的 fees 和身分類別表，兩邊會疊加。
2. 列印設定分別存在裝置設定和 localStorage 兩處，要先決定以哪邊為準。
3. 後端預設值是示範機構，新環境還沒匯入時看起來像真資料。
4. `mainDept`、`dispenseType` 是「說明字串 + 數字」，申報靠正則抽數字；FHIR 化要改成代碼。
5. FHIR 目標：Organization + Location。費率、Sc.ini、工作站、列印設定屬於程式設定，不必 FHIR 化。

---

## 區 14：身分類別

- **存放**：
  - `id_category_settings` 欄位：`code`、`deposit`、`reg_fee`（掛號費減免額）、`copay`（大於 0 代表免收部分負擔，是開關不是金額）、年齡範圍、`is_default`
  - Patient 與 Encounter 擴充的 `idCategory`、`patient_index.id_category`
- **觸點**：
  - 後端：`patient.py`（save、delete，刪除後會重新判定病人身分）、`sqlite_shadow_store`（`get_default_category_by_age`、`_auto_fill_patient_id_category`、`reevaluate_patient_id_category`）、`nhi._stamp_id_category`、`_child_copay_code`（902 等）、`reg_discount_report.py`、`niis_adapter.py`
  - 前端：`IdCategoryTableDialog`、`ClinicProfilePage`、`PatientMasterForm`、`PatientEditDialog`、`PatientListPage`、`lib/idCategory.ts`（`identityVisitFees`）、`lib/ageFee.ts`、`SelfRegisterKioskPage`、`RegisterConfirmDialog`
  - 匯入：`import_yisheng_id_categories.py`、`import_yisheng_clinic_settings.py`、`import_yisheng_data.py`、`sync_yisheng_since.py`、`repair_patient_id_category_ext.py`
- **陷阱**：
  1. 身分減免和年齡減免可能同時套用，計算順序要原樣搬過去。
  2. 有別名（「老優」「自」等），由 `canonicalIdCategory` 處理。
  3. Encounter 上的身分是看診當時的快照，不能用病人現在的身分回推。

---

## 區 15：藥品、病名、用法主檔

### 目前存放

- `frontend/public/yisheng_clinic_catalog.json`：藥品、病名、藥組、用法、途徑。
- `frontend/public/yisheng_drug_types.json`：劑型。
- `clinic_runtime_settings.clinic_catalog_overrides_v1`：診所增刪改的差異；刪除用 `deletedDrugKeys` 做軟刪。
- 藥價：`rule_package`（Pack，依看診日的價期）。
- 規則檔：`rules/nopay_indicators.json`、`config/yisheng_dx_special.json`。

### 觸點

- **產生**：`export_yisheng_clinic_catalog.py`（`map_drug`、`map_dx`、`map_usage`、`map_packages`）、`build_diagnose_master.py`、`export_clinic_pack.py`。
- **讀寫差異檔**：`clinic_settings.py`（`get/put_catalog_overrides`）、`maintenance.py`。
- **前端載入與編輯**：`useClinicCatalog.ts`（`reload`、`persistOverrides`）、`DrugCatalogPage`、`UsageCatalogPage`、`DiagnosesDbPage`、`DrugPackagesPage`、`DrugControlPage`、`DrugPickDialog`、`CaseClassPanel`、`EmrLookupPage`、`types/clinicCatalog.ts`。
- **開藥與計量**：`utils/rxTotal.ts`、`RxGrid`、`utils/catalogRx.ts`（歷史藥名對 MAKING、`patientRemind`）。
- **後端**：
  - `engine.py`（`_catalog_lookup`、`_shipped_catalog`、`_spec_treat_codes`、`_dx_special_map`）
  - `spoke/drug_price.lookup_drug_price`、`medication_request.py`、`nhi.py`
  - `nopay_check.py`、`nopay_rules.py`、`case_rules.py`、`media_check.py`
  - `spoke/hydrator.py`、`pack_store.py`、`packages.py`、`drug_price_refresh.py`
- **列印**：所有藥名都先過 `applyClinicDrugDisplayNames`；`simpleSlip.ts` 印 `patientRemind`；`visitReceiptPrint.ts` 讀 catalog。
- **匯入**：`import_yisheng_data.py`、`sync_yisheng_since.py`（MAKING 藥名）。

### 陷阱

1. 主檔有兩層（隨程式發佈的 JSON + DB 差異檔），前端合併時 `drugNo` 和 `alias` 可能撞鍵。
2. 開藥畫面顯示主檔的 `unitPrice`，申報用 Pack 依看診日的價格，兩者可能不同。藥價一律用看診當日的價期。
3. 畫面藥名以 MAKING（診所自訂名）為準。同一健保碼可能有多列不同快碼，不可合併。
4. 健保全國藥價留在 Pack，不屬於診所主檔。
5. FHIR 目標：Medication（TW Core）、病名用 ValueSet／CodeSystem；用法和藥組可先維持本地定義。

---

## 區 16：同步與稽核

- **存放**：`sync_queue`、`audit_modifications`、開關 `audit_recording`／`audit_go_live_at`、少量 `AuditEvent` 資源；`chart_presence` 只存在記憶體（病歷開啟中的狀態，重啟就消失）。
- **觸點**：
  - `enqueue_sync`、`dequeue_sync_batch`、`mark_sync_done`
  - `sync_worker._process_sync_queue`、`local_fhir_repository`（唯一的標準 FHIR 寫入門）
  - `cache_resource` 內的稽核 diff、`write_audit_event`、`_insert_audit_row`、`list_audit_modifications`
  - `patient.py`（audit-status、modifications）、`enable_audit_go_live`（可清空稽核表）
  - `nhi.py` 破窗（AuditEvent 和 audit_modifications 都寫）
  - `main.py`（啟動 worker、手動標記同步）
- **陷阱**：
  1. 沒設 `CLOUD_FHIR_URL` 時，worker **假裝同步成功**，佇列全部標成已同步。不能當備份，也不能當雲端已有資料的證據。
  2. worker 會對雲端送 DELETE，這和禁刪原則衝突。真要上雲之前要先拿掉。
  3. 日常修改記在 `audit_modifications`，不是 FHIR AuditEvent。FHIR 化要決定是否改成 AuditEvent／Provenance。

---

## 列印總表

| 單據 | 範本 | 資料來源 | 紙張（mm） |
|------|------|----------|-----------|
| 簡式收據／藥單 | `simpleSlip.ts` `buildSimpleSlipHtml` | workspace + 佇列 + 藥品主檔 + 院所 localStorage | 114×101.6（預覽 210×93 規則見列印鎖定） |
| 押金單 | `clinicPrintDocs.ts` `buildDepositSlipHtml` | queueMeta + 院所 | 114×101.6 |
| 交付調劑處方箋 | `releaseRx.ts` | 佇列 + 當次處方、病名 | 297×210 橫 |
| 交付檢驗處方箋 | `delegateLabSlip.ts` | 佇列 + 處方 payMark 交／轉 | 297×210 橫 |
| 診斷證明書 | `clinicPrintDocs.ts` `buildCertificateHtml` | `visit_certificate` + 看診資料 | 210×297 |
| 預約單 | `CertificateDialog` 內嵌 | `appointment_text` | 210×297 |
| 轉診單 | `clinicPrintDocs.ts` `buildReferralSlipHtml` | `referral_slip` + workspace | 210×297 |
| 掛號簿總表 | `HisRegisterBookPaper` + `registerBookReport.ts` | `/fhir/Encounter/cash-book`（索引 fee_*） | 297×495 |
| 現金帳明細 | `HisCashDetailPaper`、`cashDetailXlsx.ts` | 區間 Encounter + `cash_return` | 297×495 |
| 費用統計各表 | `HisReportPaper` | `/maintenance/reports/{kind}`（索引 SQL） | 297×210 橫 |
| 診斷主檔 | `DiagnosesDbPage` | 主檔 + 差異檔 | A4 |
| 掛號台簡易收據 | `printJob` lines 模式 | 當筆 queueMeta | receipt 設定 |
| 藥袋、繁式處方、抽審表、病歷標籤 | `printSetupPreview.ts`、`PatientListPage` | 只有預覽或尚未接線 | — |

列印要注意：

1. **列印時才算出來的金額**：收據的 `resolvedSelfPay`、`payable`、`drugFeeShown`，押金的 `yuanWhole`，掛號簿的 `day.total`。這些不在 DB，搬資料不會出錯，但讀取欄位名稱一改就算錯。
2. 看診中列印用的是畫面上的**草稿**（`saveDraft`），不是 DB。
3. 院所抬頭讀 localStorage，不是每次都打 API。
4. 交付檢驗單的卡號（`labCardSeq`）和收據的卡號（`slipVisitSeq`）規則不同。
5. 掛號簿的初診、欠卡分桶靠 `reg_cc` 和 `reg_remark`；取消的掛號不計；月申報類報表依費用年月計算。

---

## 跨區最容易漏的地方（優先處理）

1. **索引才是正本的資料**：病名、處方、費用、`reg_cc`、`claim_*`。只改 FHIR JSON 會讓清單、報表、申報讀到舊值。
2. **同一件事存兩處**：queue 狀態、身分類別、過敏、列印設定、主訴、掛號費。
3. **直接 SQL 或 `json.loads` 繞過存取層**：`engine.py`、`ic_daily_upload.py`、`clinic_reports.py`、`reg_discount_report.py`、`quality_lab.py`、`same_day.py`、`nhi_card_bridge.py`、`referral_inbox.py`，以及幾乎所有 `scripts/`。
4. **自訂擴充網址不統一**：`wundadi.tw`、`wundadi.local`、`clinic.org`、`nhidcc.nhi.gov.tw` 四種前綴並存。
5. **不在 FHIR 的專表**：`visit_certificate`、`referral_*`、`quality_lab_report`、`cash_return`、`clinic_staff`、`id_category_settings`、`look_file`、`audit_modifications`。
6. **前端自己算或自己存的東西**：`totalFee`、列印金額、localStorage 院所與列印設定、sessionStorage 的論質單號。
7. **DELETE 殘留**：Patient、員工、身分類別、轉診單、`repair_condition_shortcuts.py`、`sync_worker` 送雲端 DELETE、`enable_audit_go_live` 清空稽核表。

## 建議遷移順序

依「先改寫入、舊表留作衍生、新舊並行每日比對、讀取最後換」的原則：

1. 統一擴充網址與 code system（不動資料語意，只正規化）。
2. 把只有索引的病名和處方補成完整 FHIR（`bulk_materialize_fhir_from_index.py` 類），之後改成 FHIR 為正本、索引由 FHIR 重建。
3. Organization／Location ← 院所 profile；Practitioner／PractitionerRole ← 員工，看診改用 participant。
4. 診斷證明、轉診、論質 → DocumentReference／ServiceRequest／DiagnosticReport。外部 XML 輸出照舊。
5. 照片：LOOK 檔案保留，加上 Media／DocumentReference 指標。
6. 掛號費用、現金帳最後做（Account／ChargeItem），因為牽涉帳務與掛號簿。
7. 每一步都過官方 validator，且月申報 XML、IC XML、轉診 XML、論質 zip 和遷移前逐位元比對一致。
