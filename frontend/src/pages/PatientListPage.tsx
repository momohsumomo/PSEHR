import { useState, useEffect, useMemo, useRef, useCallback, type RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { mockPatients } from "@/mocks";
import { isApiMode, fetchPatient, fetchPatientRoster, updatePatient, createPatient, type ApiPatient, fetchIdCategorySettings, fetchNextMedicalNo, fetchPatientModifications, type PatientModification, fetchAuditStatus, type IdCategorySetting, type PatientRosterItem } from "@/api/clinicApi";
import { useEscLayer } from "@/hooks/useEscLayer";
import { useListNav } from "@/hooks/useListNav";
import { Fido2BindingModal } from "@/components/Fido2BindingModal";
import { PatientMasterForm } from "@/components/clinic/PatientMasterForm";
import {
  emptyPatientRecord,
  fhirToPatientRecord,
  patientRecordToFhir,
  type PatientRecord,
} from "@/lib/patientMaster";
import { HisWinTitle, HisCatalogFBar } from "@/components/clinic/HisPageFrame";
import { HIS, HIS_FBAR_COLORS, hisFontStyle } from "@/lib/hisTheme";

export function PatientListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const apiMode = isApiMode();
  
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // 狀態機模式: "browse" (瀏覽) | "edit" (修改) | "add" (新增)
  const [mode, setMode] = useState<"browse" | "edit" | "add">("browse");

  // 側欄與選取狀態
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [roster, setRoster] = useState<PatientRosterItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 當前顯示/編輯表單資料
  const [editForm, setEditForm] = useState<PatientRecord | null>(null);
  // 保留編輯前備份以供「離開/取消」使用
  const [originalForm, setOriginalForm] = useState<PatientRecord | null>(null);

  // 條碼標籤預覽視窗狀態
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [sideModal, setSideModal] = useState<null | "contact" | "consult">(null);

  // 身份類別設定（代碼＋押金對照）
  const [dbCategorySettings, setDbCategorySettings] = useState<IdCategorySetting[]>([]);

  // FIDO2 密鑰視窗狀態
  const [showFidoModal, setShowFidoModal] = useState(false);

  // PIN 碼安全防線狀態
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinModalCallback, setPinModalCallback] = useState<((pin: string) => void) | null>(null);

  // 修改紀錄（責任機制）
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditRows, setAuditRows] = useState<PatientModification[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditEnabled, setAuditEnabled] = useState(false);

  useEffect(() => {
    if (!apiMode) return;
    fetchAuditStatus()
      .then((s) => setAuditEnabled(!!s.recordingEnabled))
      .catch(() => setAuditEnabled(false));
  }, [apiMode]);

  // 1a. 載入自訂身份類別代碼
  useEffect(() => {
    if (apiMode) {
      fetchIdCategorySettings()
        .then(data => {
          setDbCategorySettings(data);
        })
        .catch(err => console.error("Failed to fetch initial categories", err));
    } else {
      setDbCategorySettings([
        { code: "老人優", deposit: 0, reg_fee: 0, copay: 0 },
        { code: "S", deposit: 0, reg_fee: 50, copay: 0 },
        { code: "D", deposit: 0, reg_fee: 0, copay: 50 },
      ]);
    }
  }, [apiMode]);

  // 收集所有唯一身份類別（包含預設選項與從 DB 匯入之自訂類別）
  const idCategories = useMemo(() => {
    const categories = new Set<string>(dbCategorySettings.map((d) => d.code));
    categories.add("自費");
    categories.add("身重度");
    categories.add("身中度");
    categories.add("老+福");
    categories.add("老+榮");
    categories.add("老+重");
    roster.forEach(p => {
      if (p.idCategory && p.idCategory.trim()) {
        categories.add(p.idCategory.trim());
      }
    });
    return Array.from(categories);
  }, [roster, dbCategorySettings]);

  const idCategoryOptions = useMemo(() => {
    const byCode = new Map<string, IdCategorySetting>();
    for (const s of dbCategorySettings) byCode.set(s.code, s);
    for (const code of idCategories) {
      if (!byCode.has(code)) {
        byCode.set(code, { code, deposit: 0, reg_fee: 0, copay: 0 });
      }
    }
    return Array.from(byCode.values());
  }, [dbCategorySettings, idCategories]);

  const recordCache = useRef<Map<string, PatientRecord>>(new Map());

  const openRecord = async (id: string) => {
    const cached = recordCache.current.get(id);
    if (cached) {
      setEditForm({ ...cached });
      setOriginalForm({ ...cached });
      return;
    }
    if (!apiMode) return;
    setLoading(true);
    try {
      const rec = fhirToPatientRecord(await fetchPatient(id));
      recordCache.current.set(id, rec);
      setEditForm(rec);
      setOriginalForm({ ...rec });
    } catch (err) {
      console.error(err);
      setError("讀取病患資料失敗");
    } finally {
      setLoading(false);
    }
  };

  // 1. 載入完整名單（索引），不因搜尋重抓
  useEffect(() => {
    if (!apiMode) {
      const mapped = Object.entries(mockPatients).map(([id, p]) =>
        fhirToPatientRecord({ ...(p as ApiPatient), id }),
      );
      mapped.sort((a, b) => a.medicalNo.localeCompare(b.medicalNo, "zh-Hant"));
      mapped.forEach((p) => recordCache.current.set(p.id, p));
      setRoster(
        mapped.map((p) => ({
          id: p.id,
          medicalNo: p.medicalNo,
          name: p.name,
          idNo: p.idNo,
          birthdayRoc: p.birthday,
          phone: p.phone,
          idCategory: p.idCategory,
        })),
      );
      setTotalCount(mapped.length);
      const last = mapped[mapped.length - 1];
      if (last) {
        setSelectedPatientId(last.id);
        setEditForm(last);
        setOriginalForm(last);
      }
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchPatientRoster()
      .then((res) => {
        if (cancelled) return;
        const items = res.items ?? [];
        setRoster(items);
        setTotalCount(res.total ?? items.length);
        const last = items[items.length - 1];
        if (last) {
          setSelectedPatientId(last.id);
          void openRecord(last.id);
        }
        setTimeout(() => {
          const el = listContainerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        }, 80);
      })
      .catch((err) => {
        console.error("Failed to fetch patients", err);
        if (!cancelled) setError("無法聯動 API 取得病患資料");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // 名單只在進頁時抓一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiMode]);

  // 監聽選中病患的切換
  const handleSelectPatient = (id: string) => {
    if (mode !== "browse") {
      alert("請先完成當前修改或新增存檔，或是按「離開」放棄變更。");
      return;
    }
    setSelectedPatientId(id);
    setError("");
    setSuccess("");
    void openRecord(id);
  };

  // 動作按鈕邏輯
  const handleEnterEditMode = () => {
    if (!editForm) return;
    setOriginalForm({ ...editForm });
    setMode("edit");
    setError("");
    setSuccess("");
  };

  const handleEnterAddMode = async () => {
    let nextMedNo = "100001";
    if (apiMode) {
      try {
        nextMedNo = await fetchNextMedicalNo();
      } catch {
        nextMedNo =
          roster.length > 0
            ? String(Math.max(...roster.map((p) => parseInt(p.medicalNo, 10) || 0)) + 1).padStart(6, "0")
            : "100001";
      }
    } else {
      nextMedNo =
        roster.length > 0
          ? String(Math.max(...roster.map((p) => parseInt(p.medicalNo, 10) || 0)) + 1).padStart(6, "0")
          : "100001";
    }

    setEditForm(
      emptyPatientRecord({
        id: `new-temp-${Date.now()}`,
        medicalNo: nextMedNo,
      }),
    );
    setMode("add");
    setError("");
    setSuccess("");
  };

  const openedAddRef = useRef(false);
  const openedEditRef = useRef(false);
  useEffect(() => {
    if (openedAddRef.current) return;
    if (searchParams.get("add") !== "1") return;
    openedAddRef.current = true;
    handleEnterAddMode();
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 掛號 A 鍵只在進頁時開一次新增
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id || openedEditRef.current || !roster.length) return;
    const hit = roster.find((p) => p.id === id);
    if (!hit) return;
    openedEditRef.current = true;
    setSelectedPatientId(hit.id);
    setMode("edit");
    void openRecord(hit.id);
    setSearchParams({}, { replace: true });
  }, [roster, searchParams, setSearchParams]);

  const handleFilterFocus = () => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  };

  const handlePinSubmit = (pin: string) => {
    setPinError("");
    if (pinModalCallback) {
      pinModalCallback(pin);
    }
  };

  const handleSave = async (pin?: string) => {
    if (!editForm) return;
    if (!editForm.name.trim() || !editForm.idNo.trim()) {
      setError("姓名與身分證字號為必填欄位");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      if (mode === "edit") {
        if (apiMode) {
          const fhirPayload = patientRecordToFhir(editForm);
          const updated = await updatePatient(editForm.id, fhirPayload, pin);
          if (pin) {
            sessionStorage.setItem("clinic_operator_pin", pin);
            sessionStorage.setItem("clinic_operator_pin_time", Date.now().toString());
          }
          const mapped = fhirToPatientRecord(updated);
          recordCache.current.set(mapped.id, mapped);
          setRoster((prev) =>
            prev.map((p) =>
              p.id === mapped.id
                ? {
                    ...p,
                    medicalNo: mapped.medicalNo,
                    name: mapped.name,
                    idNo: mapped.idNo,
                    birthdayRoc: mapped.birthday,
                    phone: mapped.phone,
                    idCategory: mapped.idCategory,
                  }
                : p,
            ),
          );
          setEditForm(mapped);
          setOriginalForm(mapped);
        } else {
          recordCache.current.set(editForm.id, editForm);
          setOriginalForm(editForm);
        }
        setSuccess("資料修改存檔成功！");
        setMode("browse");
      } else if (mode === "add") {
        if (apiMode) {
          const fhirPayload = patientRecordToFhir(editForm);
          delete fhirPayload.id; // 讓後端指派新 ID
          const created = await createPatient(fhirPayload, pin);
          if (pin) {
            sessionStorage.setItem("clinic_operator_pin", pin);
            sessionStorage.setItem("clinic_operator_pin_time", Date.now().toString());
          }
          const mapped = fhirToPatientRecord(created);
          recordCache.current.set(mapped.id, mapped);
          setRoster((prev) => [
            ...prev,
            {
              id: mapped.id,
              medicalNo: mapped.medicalNo,
              name: mapped.name,
              idNo: mapped.idNo,
              birthdayRoc: mapped.birthday,
              phone: mapped.phone,
              idCategory: mapped.idCategory,
            },
          ]);
          setTotalCount((n) => n + 1);
          setSelectedPatientId(mapped.id);
          setEditForm(mapped);
          setOriginalForm(mapped);
        } else {
          recordCache.current.set(editForm.id, editForm);
          setRoster((prev) => [
            ...prev,
            {
              id: editForm.id,
              medicalNo: editForm.medicalNo,
              name: editForm.name,
              idNo: editForm.idNo,
              birthdayRoc: editForm.birthday,
              phone: editForm.phone,
              idCategory: editForm.idCategory,
            },
          ]);
          setSelectedPatientId(editForm.id);
          setOriginalForm(editForm);
        }
        setSuccess("建立新病患存檔成功！");
        setMode("browse");
      }
      setShowPinModal(false);
      setPinInput("");
      setPinError("");
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("401") || errMsg.includes("403") || errMsg.includes("PIN_")) {
        setPinError(errMsg.includes("403") || errMsg.includes("PIN_INVALID") ? "PIN 碼錯誤，請重新輸入！" : "");
        setShowPinModal(true);
        setPinInput("");
        setPinModalCallback(() => (submittedPin: string) => handleSave(submittedPin));
      } else {
        setError("存檔失敗：" + errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAudit = async () => {
    if (!editForm?.id || editForm.id.startsWith("new-temp")) {
      setError("請先選擇已存檔的病患以查看修改紀錄");
      return;
    }
    if (!apiMode) {
      setError("離線示範模式無修改紀錄");
      return;
    }
    setAuditLoading(true);
    setShowAuditModal(true);
    setError("");
    try {
      const rows = await fetchPatientModifications(editForm.id, 80);
      setAuditRows(rows);
    } catch (err) {
      setAuditRows([]);
      setError("載入修改紀錄失敗：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAuditLoading(false);
    }
  };

  const handleExit = () => {
    if (mode === "browse") {
      navigate("/");
    } else {
      // 取消修改或新增，還原資料
      setEditForm(originalForm);
      setMode("browse");
      setError("");
      setSuccess("");
    }
  };

  useEscLayer([
    { open: showPinModal, close: () => setShowPinModal(false) },
    { open: showFidoModal, close: () => setShowFidoModal(false) },
    { open: showAuditModal, close: () => setShowAuditModal(false) },
    { open: showBarcodeModal, close: () => setShowBarcodeModal(false) },
    { open: sideModal != null, close: () => setSideModal(null) },
    {
      open: mode !== "browse",
      close: () => {
        setEditForm(originalForm);
        setMode("browse");
        setError("");
        setSuccess("");
      },
    },
    { open: true, close: () => navigate("/") },
  ]);

  const filteredPatients = useMemo(() => {
    const q = search.trim();
    if (!q) return roster;
    const bday = q.match(/^(\d{1,3})[./](\d{1,2})[./](\d{1,2})$/);
    if (bday) {
      const month = Number(bday[2]);
      const day = Number(bday[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const key = `${bday[1].padStart(3, "0")}${bday[2].padStart(2, "0")}${bday[3].padStart(2, "0")}`;
        const bare = key.replace(/^0+/, "");
        return roster.filter((p) => {
          const stored = (p.birthdayRoc || "").replace(/\D/g, "");
          return stored === key || stored === bare;
        });
      }
    }
    const lower = q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    return roster.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.idNo.toLowerCase().includes(lower) ||
        p.medicalNo.includes(q) ||
        (digits.length > 0 && p.phone.replace(/\D/g, "").includes(digits)),
    );
  }, [roster, search]);

  const filteredRef = useRef(filteredPatients);
  filteredRef.current = filteredPatients;
  const selectPatientRef = useRef(handleSelectPatient);
  selectPatientRef.current = handleSelectPatient;
  const onRosterIndex = useCallback((i: number) => {
    const row = filteredRef.current[i];
    if (row) selectPatientRef.current(row.id);
  }, []);
  const rosterIndex = filteredPatients.findIndex((p) => p.id === selectedPatientId);
  useListNav({
    active: mode === "browse",
    length: filteredPatients.length,
    index: rosterIndex,
    onIndex: onRosterIndex,
    scrollerRef: listContainerRef,
    rowPx: ROSTER_ROW,
    moveWhileTyping: true,
    wheelRows: 2,
  });

  // 找出目前病患在清單中的索引
  const currentIndex = useMemo(() => {
    if (!editForm) return 0;
    return filteredPatients.findIndex(p => p.id === editForm.id) + 1;
  }, [filteredPatients, editForm]);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden text-black select-none"
      style={{ ...hisFontStyle, background: HIS.patientFace }}
    >
      <HisWinTitle
        title={`病患基本資料 -- ${mode === "browse" ? "瀏覽模式" : mode === "edit" ? "修改模式" : "新增模式"}`}
        trailing={
          <span className="text-[10px] font-normal">
            {loading ? "同步中" : apiMode ? "API" : "Mock"} / {totalCount}
          </span>
        }
      />

      {/* 訊息狀態欄 */}
      {(error || success) && (
        <div className="mt-1.5 px-3 py-1 text-xs rounded border flex justify-between shrink-0 font-bold">
          {error && <span className="text-red-700 bg-red-100 border-red-300 w-full px-2 py-0.5 rounded">⚠️ 錯誤提示：{error}</span>}
          {success && <span className="text-emerald-700 bg-emerald-100 border-emerald-300 w-full px-2 py-0.5 rounded">✨ 提示資訊：{success}</span>}
        </div>
      )}

      <div className="mt-1 flex min-h-0 flex-1 overflow-hidden">
        <section
          className="flex min-h-0 flex-[78] flex-col overflow-hidden border-r p-1 high-contrast-form"
          style={{ background: HIS.patientFace, borderColor: HIS.chromeBorder }}
        >
          {editForm ? (
            <PatientMasterForm
              value={editForm}
              onChange={setEditForm}
              readOnly={mode === "browse"}
              showSpeak
              className="min-h-0 flex-1"
              idCategoryOptions={idCategoryOptions}
            />
          ) : (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-[#404040]"
              style={{ fontSize: HIS.fs.secondary }}
            >
              <p className="font-bold">請從右側選擇病歷號碼</p>
              <p style={{ fontSize: HIS.fs.tertiary }}>或按 F2 新增病歷</p>
            </div>
          )}
        </section>

        <section
          className="flex min-h-0 w-[22%] shrink-0 flex-col overflow-hidden border-l p-1"
          style={{ background: HIS.patientRight, borderColor: HIS.chromeBorder }}
        >
          <div
            className="shrink-0 border py-0.5 text-center font-mono font-bold text-white"
            style={{ background: "#000000", borderColor: HIS.chromeBorder, fontSize: HIS.fs.secondary }}
          >
            {currentIndex > 0 ? `${currentIndex} / ${filteredPatients.length}` : `0 / ${filteredPatients.length}`}
          </div>

          <div className="mt-1 shrink-0 font-bold" style={{ fontSize: HIS.fs.secondary }}>
            <span>鍵值 &lt;V&gt;</span>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="病歷號 / 姓名 / 生日 / 電話"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-0.5 w-full border bg-white px-1 py-0.5 font-mono outline-none focus:border-[#000080]"
              style={{ borderColor: HIS.chromeBorder, fontSize: HIS.fs.secondary, color: HIS.inputBlue }}
            />
          </div>

          <div
            ref={listContainerRef}
            className="mt-1 min-h-0 flex-1 overflow-y-auto border bg-white select-none"
            style={{ borderColor: HIS.chromeBorder, fontSize: HIS.fs.secondary }}
          >
            {filteredPatients.length > 0 ? (
              <PatientRosterList
                rows={filteredPatients}
                selectedId={selectedPatientId}
                listRef={listContainerRef}
                onSelect={handleSelectPatient}
              />
            ) : (
              <p className="py-8 text-center font-bold text-[#808080]" style={{ fontSize: HIS.fs.tertiary }}>
                (查無病歷)
              </p>
            )}
          </div>

          <div
            className="shrink-0 pt-0.5 text-center font-bold"
            style={{ fontSize: HIS.fs.tertiary, color: "#404040" }}
          >
            顯示 {filteredPatients.length} / 總計 {totalCount} 筆
          </div>
        </section>
      </div>

      <HisCatalogFBar
        items={[
          { key: "F2", label: "新增", color: HIS_FBAR_COLORS.F2, onClick: handleEnterAddMode, disabled: mode !== "browse" },
          {
            key: "F3",
            label: "修改",
            color: HIS_FBAR_COLORS.F3,
            onClick: handleEnterEditMode,
            disabled: !editForm || mode !== "browse",
          },
          { key: "F4", label: "篩選", color: HIS_FBAR_COLORS.F4, onClick: handleFilterFocus },
          {
            key: "F5",
            label: "標籤",
            color: HIS_FBAR_COLORS.F5,
            onClick: () => setShowBarcodeModal(true),
            disabled: !editForm || mode !== "browse",
          },
          {
            key: "F6",
            label: "紀錄",
            color: HIS_FBAR_COLORS.F6,
            onClick: () => void handleOpenAudit(),
            disabled: !editForm || mode !== "browse",
          },
          { key: "F9", label: "存檔", color: HIS_FBAR_COLORS.F9, onClick: () => void handleSave(), disabled: mode === "browse" },
          {
            key: "Esc",
            label: mode === "browse" ? "離開" : "取消",
            color: HIS_FBAR_COLORS.Esc,
            onClick: handleExit,
          },
        ]}
      />

      {sideModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSideModal(null)}>
          <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sideModal === "contact" ? (
              <>
                <h3 className="mb-3 text-sm font-bold">聯絡人</h3>
                <label className="block text-[11px] font-bold text-slate-600">姓名</label>
                <input
                  className="mb-2 w-full rounded border px-2 py-1 text-xs"
                  value={editForm.contactName}
                  onChange={(e) => {
                    if (mode === "browse") {
                      setOriginalForm({ ...editForm });
                      setMode("edit");
                    }
                    setEditForm({ ...editForm, contactName: e.target.value });
                  }}
                />
                <label className="block text-[11px] font-bold text-slate-600">電話</label>
                <input
                  className="mb-3 w-full rounded border px-2 py-1 text-xs"
                  value={editForm.contactPhone}
                  onChange={(e) => {
                    if (mode === "browse") {
                      setOriginalForm({ ...editForm });
                      setMode("edit");
                    }
                    setEditForm({ ...editForm, contactPhone: e.target.value });
                  }}
                />
                <p className="mb-3 text-[10px] text-slate-500">寫入病患主檔擴充欄；請再按底列存檔。無資料顯示空白，不編造。</p>
              </>
            ) : (
              <>
                <h3 className="mb-3 text-sm font-bold">初診會談／病史記載</h3>
                <textarea
                  className="mb-3 h-40 w-full rounded border p-2 text-xs"
                  value={editForm.medicalHistory}
                  onChange={(e) => {
                    if (mode === "browse") {
                      setOriginalForm({ ...editForm });
                      setMode("edit");
                    }
                    setEditForm({ ...editForm, medicalHistory: e.target.value });
                  }}
                />
                <p className="mb-3 text-[10px] text-slate-500">寫入病史記載；請再按底列存檔。</p>
              </>
            )}
            <div className="flex justify-end">
              <button type="button" className="rounded bg-sky-700 px-3 py-1 text-xs font-bold text-white" onClick={() => setSideModal(null)}>
                確定
              </button>
            </div>
          </div>
        </div>
      )}

      {showFidoModal && editForm && (
        <Fido2BindingModal
          patientId={editForm.id}
          patientName={editForm.name}
          onClose={() => setShowFidoModal(false)}
        />
      )}

      {/* 條碼標籤預覽彈出視窗 */}
      {showBarcodeModal && editForm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-mono select-none">
          <div className="bg-white rounded-lg shadow-xl border border-slate-300 max-w-sm w-full overflow-hidden flex flex-col p-5 gap-4">
            
            <header className="border-b pb-2 flex items-center justify-between">
              <span className="text-xs font-black text-slate-700">🏷️ 病歷資料條碼標籤貼紙</span>
              <button
                type="button"
                onClick={() => setShowBarcodeModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-sm"
              >
                ✕
              </button>
            </header>

            {/* 條碼貼紙本體 (模擬列印效果) */}
            <div className="border border-dashed border-slate-400 bg-white p-4 rounded text-black text-center flex flex-col items-center gap-1.5 shadow-inner">
              <div className="text-[14px] font-black tracking-widest">{editForm.name}</div>
              <div className="text-[10px] text-slate-600 flex gap-3">
                <span>{editForm.sex === "男" ? "♂" : "♀"} {editForm.sex}</span>
                <span>出生: {editForm.birthday}</span>
              </div>
              
              {/* 條碼圖案 (SVG 繪製) */}
              <div className="py-2.5 w-full flex justify-center">
                <svg className="w-48 h-10" viewBox="0 0 100 20" preserveAspectRatio="none">
                  {/* 用直條紋模擬一個 Code39 / Code128 條碼 */}
                  <rect x="0" y="0" width="1.5" height="20" fill="black" />
                  <rect x="2.5" y="0" width="0.5" height="20" fill="black" />
                  <rect x="4" y="0" width="1.0" height="20" fill="black" />
                  <rect x="6" y="0" width="2.0" height="20" fill="black" />
                  <rect x="9" y="0" width="0.5" height="20" fill="black" />
                  <rect x="11" y="0" width="1.5" height="20" fill="black" />
                  <rect x="13.5" y="0" width="1.0" height="20" fill="black" />
                  <rect x="15" y="0" width="2.5" height="20" fill="black" />
                  <rect x="18.5" y="0" width="0.5" height="20" fill="black" />
                  <rect x="20" y="0" width="1.5" height="20" fill="black" />
                  <rect x="22" y="0" width="1.0" height="20" fill="black" />
                  <rect x="24.5" y="0" width="0.5" height="20" fill="black" />
                  <rect x="26" y="0" width="2.0" height="20" fill="black" />
                  <rect x="29" y="0" width="1.0" height="20" fill="black" />
                  <rect x="31" y="0" width="1.5" height="20" fill="black" />
                  <rect x="33.5" y="0" width="0.5" height="20" fill="black" />
                  <rect x="35" y="0" width="2.5" height="20" fill="black" />
                  <rect x="38.5" y="0" width="1.0" height="20" fill="black" />
                  <rect x="40.5" y="0" width="1.5" height="20" fill="black" />
                  <rect x="43" y="0" width="0.5" height="20" fill="black" />
                  <rect x="44.5" y="0" width="2.0" height="20" fill="black" />
                  <rect x="47.5" y="0" width="1.0" height="20" fill="black" />
                  <rect x="49.5" y="0" width="1.5" height="20" fill="black" />
                  <rect x="52" y="0" width="0.5" height="20" fill="black" />
                  <rect x="53.5" y="0" width="2.5" height="20" fill="black" />
                  <rect x="57" y="0" width="1.0" height="20" fill="black" />
                  <rect x="59" y="0" width="1.5" height="20" fill="black" />
                  <rect x="61.5" y="0" width="0.5" height="20" fill="black" />
                  <rect x="63" y="0" width="2.0" height="20" fill="black" />
                  <rect x="66" y="0" width="1.0" height="20" fill="black" />
                  <rect x="68" y="0" width="1.5" height="20" fill="black" />
                  <rect x="70.5" y="0" width="0.5" height="20" fill="black" />
                  <rect x="72" y="0" width="2.5" height="20" fill="black" />
                  <rect x="75.5" y="0" width="1.0" height="20" fill="black" />
                  <rect x="77.5" y="0" width="1.5" height="20" fill="black" />
                  <rect x="80" y="0" width="0.5" height="20" fill="black" />
                  <rect x="81.5" y="0" width="2.0" height="20" fill="black" />
                  <rect x="84.5" y="0" width="1.0" height="20" fill="black" />
                  <rect x="86.5" y="0" width="1.5" height="20" fill="black" />
                  <rect x="89" y="0" width="0.5" height="20" fill="black" />
                  <rect x="90.5" y="0" width="2.5" height="20" fill="black" />
                  <rect x="94" y="0" width="1.0" height="20" fill="black" />
                  <rect x="96" y="0" width="1.5" height="20" fill="black" />
                  <rect x="98.5" y="0" width="1.5" height="20" fill="black" />
                </svg>
              </div>

              <div className="text-[12px] font-mono font-bold tracking-widest">{editForm.medicalNo}</div>
              <div className="text-[9px] text-slate-500 font-sans mt-0.5">身分證號: {editForm.idNo}</div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  alert("標籤機尚未接上，沒有送出列印命令。");
                  setShowBarcodeModal(false);
                }}
                className="flex-1 rounded py-2 bg-[#004D00] hover:bg-[#003300] text-white text-xs font-bold shadow-sm transition"
              >
                🖨️ 列印標籤
              </button>
              <button
                type="button"
                onClick={() => setShowBarcodeModal(false)}
                className="w-20 rounded py-2 border border-slate-300 hover:bg-slate-50 text-xs text-slate-700 font-bold transition"
              >
                關閉
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 盲打式 PIN 碼存檔驗證視窗 */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white border-2 border-red-500 rounded-lg p-5 w-80 shadow-2xl">
            <div className="text-center">
              <span className="text-3xl">🔒</span>
              <h3 className="text-sm font-bold text-slate-800 mt-2">病患主檔存檔：身分驗證</h3>
              <p className="text-[10px] text-slate-500 mt-1 mb-4 leading-normal">
                新增／修改病患資料必須留下操作者紀錄（責任機制）。請輸入您的個人 PIN 碼：
              </p>
            </div>
            
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (pinInput.trim()) {
                  handlePinSubmit(pinInput.trim());
                }
              }}
              className="flex flex-col gap-3"
            >
              <input
                type="password"
                autoComplete="new-password"
                className="w-full text-center tracking-widest text-lg font-mono rounded border-2 border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 py-1 outline-none bg-white text-slate-800"
                placeholder="••••••"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                autoFocus
                ref={(input) => input && input.focus()}
              />
              
              {pinError && (
                <div className="text-[10px] text-red-600 font-bold text-center bg-red-50 py-1 rounded border border-red-200">
                  {pinError}
                </div>
              )}
              
              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  className="flex-1 rounded py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow transition"
                >
                  確認授權
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPinModal(false);
                    setPinInput("");
                    setPinError("");
                    setLoading(false);
                  }}
                  className="w-20 rounded py-2 border border-slate-300 hover:bg-slate-50 text-xs text-slate-700 font-bold transition"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 修改紀錄（責任機制） */}
      {showAuditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-2 border-[#004D00] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-[#80C080] bg-[#E8F8E8] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#004D00]">修改紀錄</h3>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  {editForm?.medicalNo} {editForm?.name} — 哪台電腦、何時、改了什麼
                  {!auditEnabled && "（正式上線前：稽核尚未啟用）"}
                </p>
              </div>
              <button
                type="button"
                className="text-xs font-bold px-2 py-1 rounded border border-slate-300 hover:bg-white"
                onClick={() => setShowAuditModal(false)}
              >
                關閉
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 text-[11px]">
              {auditLoading && <p className="text-slate-500">載入中…</p>}
              {!auditLoading && auditRows.length === 0 && (
                <p className="text-slate-500">
                  {auditEnabled
                    ? "尚無修改紀錄。"
                    : "稽核尚未正式啟用。資料庫正式上線當日請執行「正式上線-啟用修改稽核.bat」，之後的修改才會留痕。"}
                </p>
              )}
              {!auditLoading &&
                auditRows.map((row) => (
                  <div
                    key={row.id}
                    className="mb-2 rounded border border-[#B0DDB0] bg-[#F7FCF7] px-2 py-1.5"
                  >
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-[#004D00]">
                      <span>{row.timestamp}</span>
                      <span className="font-bold">{row.action === "create" ? "建檔" : "變更"}</span>
                      <span>{row.operatorIdentity}</span>
                      <span className="text-slate-500">{row.machineId}</span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-700 font-mono max-h-28 overflow-y-auto">
                      {JSON.stringify(row.changedFields, null, 2)}
                    </pre>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* 身份類別自訂下拉清單對照 */}
      <datalist id="id-categories-datalist">
        {idCategories.map(cat => (
          <option key={cat} value={cat} />
        ))}
      </datalist>

    </div>
  );
}

const ROSTER_ROW = 22;

function PatientRosterList({
  rows,
  selectedId,
  listRef,
  onSelect,
}: {
  rows: PatientRosterItem[];
  selectedId: string | null;
  listRef: RefObject<HTMLDivElement>;
  onSelect: (id: string) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const watch = new ResizeObserver(() => setViewH(el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    watch.observe(el);
    setViewH(el.clientHeight);
    setScrollTop(el.scrollTop);
    return () => {
      el.removeEventListener("scroll", onScroll);
      watch.disconnect();
    };
  }, [listRef, rows.length]);

  const start = Math.max(0, Math.floor(scrollTop / ROSTER_ROW) - 6);
  const count = Math.ceil(viewH / ROSTER_ROW) + 14;
  const slice = rows.slice(start, start + count);

  return (
    <div style={{ height: rows.length * ROSTER_ROW, position: "relative" }}>
      {slice.map((p, i) => {
        const isSelected = selectedId === p.id;
        return (
          <div
            key={p.id}
            id={`patient-item-${p.id}`}
            onClick={() => onSelect(p.id)}
            className="flex cursor-pointer items-center justify-between border-b px-2 font-mono"
            style={{
              position: "absolute",
              top: (start + i) * ROSTER_ROW,
              height: ROSTER_ROW,
              left: 0,
              right: 0,
              borderColor: "#C0C0C0",
              background: isSelected ? "#A0A0A0" : undefined,
              fontWeight: isSelected ? 700 : undefined,
            }}
          >
            <span>{p.medicalNo}</span>
            <span style={{ fontSize: HIS.fs.tertiary }}>{p.name}</span>
          </div>
        );
      })}
    </div>
  );
}
