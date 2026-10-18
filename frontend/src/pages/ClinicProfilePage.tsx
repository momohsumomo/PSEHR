import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useEscLayer } from "@/hooks/useEscLayer";
import { loadPrintSettings, savePrintSettings, type PrintSettings } from "@/lib/printSettings";
import { PrintSetupPanel } from "@/components/clinic/PrintSetupPanel";
import {
  DEFAULT_FEES,
  DEFAULT_PROFILE,
  DEFAULT_WORKFLOW,
  loadClinicBundle,
  persistClinicBundle,
  type ClinicFees,
  type ClinicProfileFields,
  type ClinicWorkflow,
} from "@/lib/clinicProfile";
import {
  fetchCaseRules,
  fetchIdCategorySettings,
  fetchStaff,
  saveCaseRules,
  saveClinicDevice,
  type ApiStaffRecord,
  type CaseRulesPayload,
  type IdCategorySetting,
} from "@/api/clinicApi";
import { doctorDisplayName } from "@/lib/doctorName";
import { CaseClassPanel } from "@/components/clinic/CaseClassPanel";
import { SciniParamsEditor } from "@/components/clinic/SciniParamsEditor";
import {
  DEVICE_ROLE_OPTIONS,
  loadLocalDeviceMeta,
  saveLocalDeviceMeta,
  type DeviceRole,
  type LocalDeviceMeta,
} from "@/lib/clinicDevice";

type TabId = "profile" | "fees" | "workflow" | "printer" | "cases" | "scini" | "device";

export function ClinicProfilePage() {
  const navigate = useNavigate();
  useEscLayer([{ open: true, close: () => navigate("/") }]);
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  const [profile, setProfile] = useState<ClinicProfileFields>({ ...DEFAULT_PROFILE });
  const [fees, setFees] = useState<ClinicFees>({ ...DEFAULT_FEES });
  const [idCats, setIdCats] = useState<IdCategorySetting[]>([]);
  const [workflow, setWorkflow] = useState<ClinicWorkflow>({ ...DEFAULT_WORKFLOW });
  const [printer, setPrinter] = useState<PrintSettings>(() => loadPrintSettings());
  const [staff, setStaff] = useState<ApiStaffRecord[]>([]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [deviceMeta, setDeviceMeta] = useState<LocalDeviceMeta>(() => loadLocalDeviceMeta());
  const [caseRules, setCaseRules] = useState<CaseRulesPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bundle = await loadClinicBundle();
      if (cancelled) return;
      setProfile(bundle.profile);
      setFees(bundle.fees);
      setWorkflow(bundle.workflow);
      setPrinter(loadPrintSettings());
      setDeviceMeta(loadLocalDeviceMeta());
      try {
        const list = await fetchStaff();
        if (!cancelled) setStaff(list.filter((s) => (s.status || "在職") === "在職"));
      } catch {
        /* ignore */
      }
      try {
        const cats = await fetchIdCategorySettings();
        if (!cancelled) setIdCats(cats);
      } catch {
        /* ignore */
      }
      try {
        const rules = await fetchCaseRules();
        if (!cancelled) setCaseRules(rules.data);
      } catch {
        /* offline: case page stays empty until the API is up */
      }
      if (bundle.source === "local") {
        setSaveNotice("後端未連線：目前用本機快取。連上 API 後再存檔會寫入影子庫。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    savePrintSettings(printer);
    const meta = saveLocalDeviceMeta(deviceMeta);
    setDeviceMeta(meta);
    const where = await persistClinicBundle({ profile, fees, workflow });
    try {
      await saveClinicDevice(meta.id, {
        label: meta.label,
        role: meta.role,
        printSettings: printer as unknown as Record<string, unknown>,
      });
    } catch {
      /* offline */
    }
    let caseNote = "";
    if (caseRules) {
      try {
        const saved = await saveCaseRules({
          orderRules: caseRules.orderRules,
          chronicRules: caseRules.chronicRules,
          projectDrugFloor: caseRules.projectDrugFloor || 0,
          outsideLabCodes: caseRules.outsideLabCodes || [],
        });
        setCaseRules(saved.data);
        caseNote = "\u6848\u4ef6\u5206\u985e\u5df2\u5beb\u5165\u3002";
      } catch (err) {
        caseNote = err instanceof Error ? err.message : "\u6848\u4ef6\u5206\u985e\u6c92\u5beb\u5165\u3002";
      }
    }
    setSaveNotice(
      (where === "api"
        ? "\u5df2\u5beb\u5165\u9662\u6240\u8a2d\u5b9a\uff08\u5168\u9ad4\uff09\uff0b\u672c\u6a5f\u89d2\u8272\uff0f\u5217\u5370\uff08\u6b64\u5de5\u4f5c\u7ad9\uff09\u3002\u639b\u8cbb\uff0f\u62bc\u91d1\u53ea\u6d3b\u5728\u4f3a\u670d\u5668\u3002"
        : "\u5f8c\u7aef\u5beb\u5165\u5931\u6557\uff0c\u5df2\u5148\u5b58\u672c\u6a5f\u5feb\u53d6\u3002") + caseNote,
    );
  };

  const doctors = staff.filter((s) => /院長|醫師/.test(String(s.role)));
  const pharmacists = staff.filter((s) => String(s.role).includes("藥師"));

  return (
    <div className="min-h-screen flex flex-col font-sans select-none text-[12px]" style={{ background: "#D4D0C8", color: "#000" }}>
      {/* Top Header Bar */}
      <header className="px-2 py-0.5 border-b flex items-center justify-between z-10 shrink-0" style={{ background: "#ECE9D8", borderColor: "#808080" }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1 px-2 py-0.5 border text-[11px] font-bold cursor-pointer"
            style={{ borderColor: "#808080", background: "#D4D0C8" }}
          >
            Esc {"\u96e2\u958b"}
          </button>
          <div className="h-4 w-[1px]" style={{ background: "#808080" }} />
          <div>
            <h1 className="text-[13px] font-bold leading-none">
              B 院所資料（院所政策＋其他參數＋本機）
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] border px-2 py-0.5" style={{ borderColor: "#808080", background: "#fff" }}>
            {"\u6a5f\u69cb\u4ee3\u865f"}：{profile.clinicCode}
          </span>
          <button
            onClick={handleSave}
            className="px-2 py-0.5 border text-[11px] font-bold cursor-pointer"
            style={{ borderColor: "#808080", background: "#7FFFD4" }}
          >
            {"\u5b58\u6a94"} [F9]
          </button>
        </div>
      </header>
      {saveNotice && (
        <p className="px-2 py-0.5 text-[11px] border-b bg-[#FFFFCC]" style={{ borderColor: "#808080" }}>
          {saveNotice}
        </p>
      )}

      {/* Main Workspace with Tabs */}
      <main className="flex-1 p-1 max-w-6xl mx-auto w-full flex flex-col min-h-0">
        {/* Navigation Tabs */}
        <div className="flex border-b gap-0 mb-1" style={{ borderColor: "#808080" }}>
          <button
            onClick={() => setActiveTab("profile")}
            className={`px-2 py-0.5 text-[11px] font-bold border-t border-x border-b-0 ${
              activeTab === "profile" ? "" : "opacity-80"
            }`}
            style={{
              borderColor: "#808080",
              background: activeTab === "profile" ? "#B8E0E0" : "#A0A0A0",
              color: activeTab === "profile" ? "#000" : "#fff",
            }}
          >
            1. {"\u9662\u6240\u57fa\u672c"}
          </button>
          <button
            onClick={() => setActiveTab("fees")}
            className={`px-2 py-0.5 text-[11px] font-bold border-t border-x border-b-0 ${
              activeTab === "fees" ? "" : "opacity-80"
            }`}
            style={{
              borderColor: "#808080",
              background: activeTab === "fees" ? "#B8E0E0" : "#A0A0A0",
              color: activeTab === "fees" ? "#000" : "#fff",
            }}
          >
            2. {"\u9580\u8a3a\u8cbb\u7528"}
          </button>
          <button
            onClick={() => setActiveTab("workflow")}
            className={`px-2 py-0.5 text-[11px] font-bold border-t border-x border-b-0 ${
              activeTab === "workflow" ? "" : "opacity-80"
            }`}
            style={{
              borderColor: "#808080",
              background: activeTab === "workflow" ? "#B8E0E0" : "#A0A0A0",
              color: activeTab === "workflow" ? "#000" : "#fff",
            }}
          >
            3. {"\u6d41\u7a0b\u9810\u8a2d"}
          </button>
          <button
            onClick={() => setActiveTab("printer")}
            className={`px-2 py-0.5 text-[11px] font-bold border-t border-x border-b-0 ${
              activeTab === "printer" ? "" : "opacity-80"
            }`}
            style={{
              borderColor: "#808080",
              background: activeTab === "printer" ? "#B8E0E0" : "#A0A0A0",
              color: activeTab === "printer" ? "#000" : "#fff",
            }}
          >
            4. {"\u5217\u5370\u8a2d\u5b9a"}
          </button>
          <button
            onClick={() => setActiveTab("cases")}
            className={`px-2 py-0.5 text-[11px] font-bold border-t border-x border-b-0 ${
              activeTab === "cases" ? "" : "opacity-80"
            }`}
            style={{
              borderColor: "#808080",
              background: activeTab === "cases" ? "#B8E0E0" : "#A0A0A0",
              color: activeTab === "cases" ? "#000" : "#fff",
            }}
          >
            5. {"\u6848\u4ef6\u5206\u985e"}
          </button>
          <button
            onClick={() => setActiveTab("scini")}
            className={`px-2 py-0.5 text-[11px] font-bold border-t border-x border-b-0 ${
              activeTab === "scini" ? "" : "opacity-80"
            }`}
            style={{
              borderColor: "#808080",
              background: activeTab === "scini" ? "#B8E0E0" : "#A0A0A0",
              color: activeTab === "scini" ? "#000" : "#fff",
            }}
          >
            O. 其他參數
          </button>
          <button
            onClick={() => setActiveTab("device")}
            className={`px-2 py-0.5 text-[11px] font-bold border-t border-x border-b-0 ${
              activeTab === "device" ? "" : "opacity-80"
            }`}
            style={{
              borderColor: "#808080",
              background: activeTab === "device" ? "#B8E0E0" : "#A0A0A0",
              color: activeTab === "device" ? "#000" : "#fff",
            }}
          >
            本機工作站
          </button>
        </div>

        {/* Tab 1: Profile */}
        {activeTab === "profile" && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-none p-2 space-y-2 animate-in fade-in duration-200">
            <h2 className="text-sm font-bold text-sky-400 border-b border-slate-700 pb-2 flex items-center gap-2">
              <span>🏢</span> 衛生福利部登記開業資料
            </h2>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <label className="block text-slate-400 mb-0.5">院所等級</label>
                <input
                  type="text"
                  value={profile.clinicGrade}
                  onChange={(e) => setProfile({ ...profile, clinicGrade: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">開業地區</label>
                <input
                  type="text"
                  value={profile.region}
                  onChange={(e) => setProfile({ ...profile, region: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">機構健保代碼 (10碼)</label>
                <input
                  type="text"
                  value={profile.clinicCode}
                  onChange={(e) => setProfile({ ...profile, clinicCode: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 font-mono font-bold text-amber-300 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-slate-400 mb-0.5">院所中文全銜</label>
                <input
                  type="text"
                  value={profile.clinicName}
                  onChange={(e) => setProfile({ ...profile, clinicName: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-base font-bold text-slate-100 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">主要科別代碼</label>
                <input
                  type="text"
                  value={profile.mainDept}
                  onChange={(e) => setProfile({ ...profile, mainDept: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-0.5">執業執照字號</label>
                <input
                  type="text"
                  value={profile.licenseNo}
                  onChange={(e) => setProfile({ ...profile, licenseNo: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">管制藥品登記證號</label>
                <input
                  type="text"
                  value={profile.controlCertNo}
                  onChange={(e) => setProfile({ ...profile, controlCertNo: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">調劑方式</label>
                <input
                  type="text"
                  value={profile.dispenseType}
                  onChange={(e) => setProfile({ ...profile, dispenseType: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">預設看診醫師（人事）</label>
                <select
                  value={profile.defaultDoctorId}
                  onChange={(e) => setProfile({ ...profile, defaultDoctorId: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                >
                  <option value="">（未指定）</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {doctorDisplayName(d.name, d.id) || d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">預設批價藥師（人事）</label>
                <select
                  value={profile.defaultPharmacistId}
                  onChange={(e) => setProfile({ ...profile, defaultPharmacistId: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                >
                  <option value="">（未指定）</option>
                  {pharmacists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {doctorDisplayName(d.name, d.id) || d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-0.5">院所電話</label>
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 font-mono text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">郵遞區號</label>
                <input
                  type="text"
                  value={profile.zipCode}
                  onChange={(e) => setProfile({ ...profile, zipCode: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 font-mono text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">中文開業地址</label>
                <input
                  type="text"
                  value={profile.address}
                  onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 text-slate-200 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <div className="col-span-3">
                <label className="block text-slate-400 mb-0.5">英文開業地址 (English Address)</label>
                <input
                  type="text"
                  value={profile.engAddress}
                  onChange={(e) => setProfile({ ...profile, engAddress: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-none px-1 py-0.5 font-mono text-xs text-slate-300 focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Fees & Pricing */}
        {activeTab === "fees" && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-none p-2 space-y-2 animate-in fade-in duration-200">
            <h2 className="text-sm font-bold text-emerald-400 border-b border-slate-700 pb-2 flex items-center justify-between">
              <span className="flex items-center gap-2"><span>💵</span> 門診掛號費、押金與身份優惠單一設定</span>
              <span className="text-[10px] text-slate-400 font-normal">統一管理收費規則，取消舊版分散選單</span>
            </h2>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-4 rounded-none bg-slate-900/80 border border-slate-700/80 space-y-3">
                <h3 className="font-bold text-amber-300 border-b border-slate-800 pb-1.5">預設基本費用 (Base Fees)</h3>
                <div>
                  <label className="block text-slate-400 mb-1">一般門診掛號費 ($)</label>
                  <input
                    type="number"
                    value={fees.regFeeOutpatient}
                    onChange={(e) => setFees({ ...fees, regFeeOutpatient: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-base font-bold text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">急診掛號費 ($)</label>
                  <input
                    type="number"
                    value={fees.regFeeEmerg}
                    onChange={(e) => setFees({ ...fees, regFeeEmerg: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-base font-bold text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">純自費門診預設掛號費 ($)</label>
                  <input
                    type="number"
                    value={fees.regFeeSelfPay}
                    onChange={(e) => setFees({ ...fees, regFeeSelfPay: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-base font-bold text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">預設診察費／申報點數 ($)</label>
                  <input
                    type="number"
                    value={fees.consultFeeDefault}
                    onChange={(e) => setFees({ ...fees, consultFeeDefault: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-base font-bold text-emerald-400"
                  />
                </div>
              </div>

              <div className="p-4 rounded-none bg-slate-900/80 border border-slate-700/80 space-y-3">
                <h3 className="font-bold text-sky-300 border-b border-slate-800 pb-1.5">欠卡押單設定 (Deposits)</h3>
                <div>
                  <label className="block text-slate-400 mb-1">未帶卡預設押單金額 ($)</label>
                  <input
                    type="number"
                    value={fees.depositAmount}
                    onChange={(e) => setFees({ ...fees, depositAmount: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-base font-bold text-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">補刷卡還單期限 (天)</label>
                  <input
                    type="number"
                    value={fees.depositDaysLimit}
                    onChange={(e) => setFees({ ...fees, depositDaysLimit: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
              </div>

              <div className="p-4 rounded-none bg-slate-900/80 border border-slate-700/80 space-y-3">
                <h3 className="font-bold text-purple-300 border-b border-slate-800 pb-1.5">{"\u639b\u865f\u8cbb\u8207\u90e8\u5206\u8ca0\u64d4"}</h3>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {"\u672a\u6eff\u6307\u5b9a\u6b72\u6578\u514d\u90e8\u5206\u8ca0\u64d4\uff0c\u639b\u865f\u8cbb\u7167\u6536\u3002\u6eff\u90a3\u500b\u6b72\u6578\u5230\u672a\u6eff\u300c\u81ea\u52d5\u6e1b\u514d\u5230\u300d\uff0c\u639b\u865f\u8cbb\u81ea\u52d5\u6e1b\u3002\u518d\u5230\u300c\u8981\u8a62\u554f\u5230\u300d\u9019\u500b\u6b72\u6578\uff0c\u53ea\u6709\u6ac3\u53f0\u639b\u865f\u624d\u554f\u662f\u4e0d\u662f\u5b78\u751f\uff0c\u8981\u770b\u5b78\u751f\u8b49\u3002\u81ea\u52a9\u639b\u865f\u9019\u500b\u6b72\u6578\u4e0d\u6e1b\u3002\u6eff\u5e74\u9577\u6b72\u6578\u81ea\u52d5\u6e1b\uff0c\u4e0d\u8ddf\u5b78\u751f\u6e1b\u514d\u91cd\u758a\u3002"}
                </p>
                <div>
                  <label className="block text-slate-400 mb-1">{"\u672a\u6eff\u5e7e\u6b72\u514d\u90e8\u5206\u8ca0\u64d4\uff08\u639b\u865f\u8cbb\u7167\u6536\uff09"}</label>
                  <input
                    type="number"
                    value={fees.childFreeAge}
                    onChange={(e) => setFees({ ...fees, childFreeAge: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">{"\u5b78\u751f\uff0f\u7fa9\u52d9\u6559\u80b2\u639b\u865f\u8cbb\u6e1b\u591a\u5c11"}</label>
                  <input
                    type="number"
                    value={fees.studentDiscount}
                    onChange={(e) => setFees({ ...fees, studentDiscount: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">{"\u81ea\u52d5\u6e1b\u514d\u5230\u672a\u6eff\u5e7e\u6b72"}</label>
                  <input
                    type="number"
                    value={fees.studentAutoUntil}
                    onChange={(e) => setFees({ ...fees, studentAutoUntil: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">{"\u8981\u8a62\u554f\u662f\u5426\u5b78\u751f\uff0c\u5230\u5e7e\u6b72\uff08\u542b\uff09"}</label>
                  <input
                    type="number"
                    value={fees.studentAskUntil}
                    onChange={(e) => setFees({ ...fees, studentAskUntil: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">{"\u5e74\u9577\u81ea\u52d5\u6e1b\u514d\uff0c\u5e7e\u6b72\u4ee5\u4e0a"}</label>
                  <input
                    type="number"
                    value={fees.seniorAge}
                    onChange={(e) => setFees({ ...fees, seniorAge: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">{"\u5e74\u9577\u639b\u865f\u8cbb\u6e1b\u591a\u5c11"}</label>
                  <input
                    type="number"
                    value={fees.seniorDiscount}
                    onChange={(e) => setFees({ ...fees, seniorDiscount: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div className="pt-1">
                  <p className="mb-1 text-[11px] text-slate-400">
                    {"\u8eab\u5206\u985e\u5225\u7684\u639b\u8cbb\u512a\u5f85\u91d1\u984d\uff0c\u4ee5\u53ca\u90e8\u5206\u8ca0\u64d4\u8981\u4e0d\u8981\u512a\u5f85\u3002\u639b\u865f\u78ba\u8a8d\u6703\u4f9d\u9019\u5f35\u8868\u5e36\u5be6\u6536\u3002"}
                  </p>
                  <button
                    type="button"
                    className="mb-1 border border-slate-600 px-2 py-0.5 text-[11px]"
                    onClick={() => {
                      void fetchIdCategorySettings()
                        .then(setIdCats)
                        .catch(() => setIdCats([]));
                    }}
                  >
                    載入身分類別優惠表
                  </button>
                  {idCats.length > 0 && (
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="text-left text-slate-400">
                          <th className="border border-slate-700 px-1">身分</th>
                          <th className="border border-slate-700 px-1">{"\u639b\u8cbb\u512a\u5f85"}</th>
                          <th className="border border-slate-700 px-1">{"\u8ca0\u64d4\u512a\u5f85"}</th>
                          <th className="border border-slate-700 px-1">年齡</th>
                        </tr>
                      </thead>
                      <tbody>
                        {idCats.map((c) => (
                          <tr key={c.code}>
                            <td className="border border-slate-800 px-1 font-bold text-purple-200">{c.code}</td>
                            <td className="border border-slate-800 px-1 font-mono">{c.reg_fee}</td>
                            <td className="border border-slate-800 px-1 font-mono">{Number(c.copay) > 0 ? "\u512a\u5f85" : "\u6536"}</td>
                            <td className="border border-slate-800 px-1 font-mono">
                              {c.min_age ?? ""}–{c.max_age ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Public Health Zero-Fee Table */}
            <div className="pt-2">
              <h3 className="text-xs font-bold text-slate-300 mb-2">特定公衛健檢案件預設掛號費 ($)</h3>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-none bg-slate-900 border border-slate-800">
                  <span className="text-slate-400">A3 成人健檢掛號費</span>
                  <input
                    type="number"
                    value={fees.regFeeAdultCheckup}
                    onChange={(e) => setFees({ ...fees, regFeeAdultCheckup: Number(e.target.value) })}
                    className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-right font-mono text-emerald-400 font-bold"
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-none bg-slate-900 border border-slate-800">
                  <span className="text-slate-400">兒童預防保健掛號費</span>
                  <input
                    type="number"
                    value={fees.regFeeChildCare}
                    onChange={(e) => setFees({ ...fees, regFeeChildCare: Number(e.target.value) })}
                    className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-right font-mono text-emerald-400 font-bold"
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-none bg-slate-900 border border-slate-800">
                  <span className="text-slate-400">癌症與口腔篩檢掛號費</span>
                  <input
                    type="number"
                    value={fees.regFeeCancerScreen}
                    onChange={(e) => setFees({ ...fees, regFeeCancerScreen: Number(e.target.value) })}
                    className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-right font-mono text-emerald-400 font-bold"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Workflow & NHI API */}
        {activeTab === "workflow" && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-none p-2 space-y-2 animate-in fade-in duration-200">
            <div className="flex flex-wrap items-center gap-3 bg-slate-900/80 border border-amber-700/60 px-4 py-3 text-base font-bold text-amber-100">
              <span>{"\u4e0a\u5348"}</span>
              <input type="time" aria-label={"\u4e0a\u5348\u958b\u59cb"} value={workflow.morningFrom || "08:00"} onChange={(e) => setWorkflow({ ...workflow, morningFrom: e.target.value || "08:00" })} className="bg-slate-950 border border-slate-600 px-2 py-1 font-mono text-slate-100" />
              <input type="time" aria-label={"\u4e0a\u5348\u7d50\u675f"} value={workflow.morningTo || "12:00"} onChange={(e) => setWorkflow({ ...workflow, morningTo: e.target.value || "12:00" })} className="bg-slate-950 border border-slate-600 px-2 py-1 font-mono text-slate-100" />
              <span>{"\u4e0b\u5348"}</span>
              <input type="time" aria-label={"\u4e0b\u5348\u958b\u59cb"} value={workflow.afternoonFrom || "12:00"} onChange={(e) => setWorkflow({ ...workflow, afternoonFrom: e.target.value || "12:00" })} className="bg-slate-950 border border-slate-600 px-2 py-1 font-mono text-slate-100" />
              <input type="time" aria-label={"\u4e0b\u5348\u7d50\u675f"} value={workflow.afternoonTo || "18:00"} onChange={(e) => setWorkflow({ ...workflow, afternoonTo: e.target.value || "18:00" })} className="bg-slate-950 border border-slate-600 px-2 py-1 font-mono text-slate-100" />
              <span>{"\u665a\u4e0a"}</span>
              <input type="time" aria-label={"\u665a\u4e0a\u958b\u59cb"} value={workflow.eveningFrom || "18:00"} onChange={(e) => setWorkflow({ ...workflow, eveningFrom: e.target.value || "18:00" })} className="bg-slate-950 border border-slate-600 px-2 py-1 font-mono text-slate-100" />
              <input type="time" aria-label={"\u665a\u4e0a\u7d50\u675f"} value={workflow.eveningTo || "21:00"} onChange={(e) => setWorkflow({ ...workflow, eveningTo: e.target.value || "21:00" })} className="bg-slate-950 border border-slate-600 px-2 py-1 font-mono text-slate-100" />
            </div>
            <h2 className="text-sm font-bold text-amber-400 border-b border-slate-700 pb-2 flex items-center justify-between">
              <span className="flex items-center gap-2"><span>🩺</span> 臨床看診與健保局控制軟體 6.0 API 流程設定</span>
              <span className="text-[10px] text-slate-400 font-normal">全自動呼叫健保局 6.0 官方 RESTful API，免手動維護晶片次數</span>
            </h2>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-4 rounded-none bg-slate-900/80 border border-slate-700/80 space-y-3">
                <h3 className="font-bold text-slate-200 border-b border-slate-800 pb-1.5">處方與開藥預設值</h3>
                <div>
                  <label className="block text-slate-400 mb-1">急性門診常用用藥天數 (天)</label>
                  <input
                    type="number"
                    value={workflow.defaultMedDays}
                    onChange={(e) => setWorkflow({ ...workflow, defaultMedDays: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">小兒磨粉提示年齡上限 (歲以下)</label>
                  <input
                    type="number"
                    value={workflow.grindMaxAge}
                    onChange={(e) => setWorkflow({ ...workflow, grindMaxAge: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">成人預設用法頻率</label>
                  <input
                    type="text"
                    value={workflow.adultUsageDefault}
                    onChange={(e) => setWorkflow({ ...workflow, adultUsageDefault: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
              </div>

              <div className="p-4 rounded-none bg-slate-900/80 border border-slate-700/80 space-y-3">
                <h3 className="font-bold text-slate-200 border-b border-slate-800 pb-1.5">病歷調閱與上限管控</h3>
                <div>
                  <label className="block text-slate-400 mb-1">看診自動載入歷史病歷 (次)</label>
                  <input
                    type="number"
                    value={workflow.historyVisitsCount}
                    onChange={(e) => setWorkflow({ ...workflow, historyVisitsCount: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">單次藥價提醒上限 ($)</label>
                  <input
                    type="number"
                    value={workflow.medPriceCap}
                    onChange={(e) => setWorkflow({ ...workflow, medPriceCap: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">單次處置預設上限 ($)</label>
                  <input
                    type="number"
                    value={workflow.procedurePriceCap}
                    onChange={(e) => setWorkflow({ ...workflow, procedurePriceCap: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-none px-3 py-1.5 font-mono text-slate-200"
                  />
                <p className="text-[10px] text-slate-500 leading-relaxed">開藥時不會用這個數字擋下處方。這不是健保規定的藥價上限，自費也不在這裡計算。</p>
                </div>
              </div>

              <div className="p-4 rounded-none bg-slate-900/80 border border-slate-700/80 space-y-3">
                <h3 className="font-bold text-sky-300 border-b border-slate-800 pb-1.5">健保局讀卡機控制軟體 6.0 API 聯動</h3>
                <div className="p-2.5 rounded-none bg-slate-950 border border-slate-800 space-y-2 text-[11px]">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">主控台 REST API 端點</span>
                    <span className="font-mono text-emerald-400 font-bold">https://localhost:5066</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">實體 IC 卡 / SAM 金鑰</span>
                    <span className="text-sky-400 font-bold">6.0 API 自動讀寫</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">虛擬健保卡 (SDK/QR)</span>
                    <span className="text-purple-400 font-bold">線上 API 自動驗證</span>
                  </div>
                </div>
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workflow.checkAllergyIC}
                      onChange={(e) => setWorkflow({ ...workflow, checkAllergyIC: e.target.checked })}
                      className="rounded border-slate-700 text-amber-500 focus:ring-amber-500"
                    />
                    <span>看診自動比對 IC 卡歷史過敏藥物 (CDSS)</span>
                  </label>
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workflow.checkCatastropheIC}
                      onChange={(e) => setWorkflow({ ...workflow, checkCatastropheIC: e.target.checked })}
                      className="rounded border-slate-700 text-amber-500 focus:ring-amber-500"
                    />
                    <span>自動帶入 IC 卡重大傷病免部分負擔</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Printer & Output */}
        {activeTab === "printer" && (
          <div className="border bg-white p-2" style={{ borderColor: "#808080" }}>
            <h2 className="mb-2 border-b pb-1 text-[13px] font-bold" style={{ borderColor: "#808080" }}>
              列印設定
            </h2>
            <PrintSetupPanel value={printer} onChange={setPrinter} />
            <p className="mt-2 text-[11px] leading-relaxed">
              這張表跟這台電腦走。存檔後寫進此工作站，不改其他電腦，也不改掛費和押金。
            </p>
          </div>
        )}

        {activeTab === "cases" && (
          caseRules ? (
            <CaseClassPanel
              lines={caseRules.lines}
              minDays={caseRules.minDays}
              officialChronic={caseRules.officialChronic}
              orderRules={caseRules.orderRules}
              chronicRules={caseRules.chronicRules}
              projectDrugFloor={caseRules.projectDrugFloor || 0}
              outsideLabCodes={caseRules.outsideLabCodes || []}
              onChange={(next) => setCaseRules({ ...caseRules, ...next })}
            />
          ) : (
            <p className="border bg-white p-2 text-[12px]" style={{ borderColor: "#808080" }}>
              {"\u6848\u4ef6\u5206\u985e\u8981\u7b49\u5f8c\u7aef\u9023\u4e0a\u624d\u80fd\u8b80\u3002\u9023\u4e0a\u4e4b\u5f8c\u91cd\u65b0\u958b\u9019\u4e00\u9801\u3002"}
            </p>
          )
        )}

        {activeTab === "scini" && (
          <div className="flex-1 flex flex-col min-h-0">
            <SciniParamsEditor onNotice={setSaveNotice} />
          </div>
        )}

        {activeTab === "device" && (
          <div className="border p-3 space-y-3" style={{ borderColor: "#808080", background: "#fff" }}>
            <h2 className="text-[12px] font-bold border-b pb-1" style={{ borderColor: "#808080" }}>
              本機工作站（每台客戶端只暫存這裡）
            </h2>
            <p className="text-[11px] leading-relaxed opacity-80">
              介面與院所政策來自本地伺服器；此頁只決定「這台是掛號台還是看診」、顯示名稱，以及之後少數本機覆寫。
              設定存在這台主機，不把整包程式分到另一個資料夾。
            </p>
            <div className="grid grid-cols-2 gap-3 text-[12px] max-w-xl">
              <div>
                <label className="block mb-0.5">裝置 ID</label>
                <input
                  className="w-full border px-1 py-0.5 font-mono"
                  style={{ borderColor: "#808080", background: "#EEE" }}
                  value={deviceMeta.id}
                  readOnly
                />
              </div>
              <div>
                <label className="block mb-0.5">顯示名稱</label>
                <input
                  className="w-full border px-1 py-0.5"
                  style={{ borderColor: "#808080" }}
                  value={deviceMeta.label}
                  onChange={(e) => setDeviceMeta({ ...deviceMeta, label: e.target.value })}
                  placeholder="例如：掛號1、看診室"
                />
              </div>
              <div className="col-span-2">
                <label className="block mb-0.5">工作站角色</label>
                <select
                  className="w-full border px-1 py-0.5"
                  style={{ borderColor: "#808080" }}
                  value={deviceMeta.role}
                  onChange={(e) =>
                    setDeviceMeta({ ...deviceMeta, role: e.target.value as DeviceRole })
                  }
                >
                  {DEVICE_ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-start gap-2 text-[13px] font-bold max-w-xl border px-2 py-2" style={{ borderColor: "#808080", background: "#FFF8D0" }}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deviceMeta.uploadCloudOnSave ?? deviceMeta.role === "register"}
                onChange={(e) => setDeviceMeta({ ...deviceMeta, uploadCloudOnSave: e.target.checked })}
              />
              <span>
                {"\u9019\u53f0\u96fb\u8166\u6309\u5b58\u6a94\u6642\u5beb\u5165\u5065\u4fdd\u96f2\u7aef"}
                <span className="mt-1 block text-[11px] font-normal leading-relaxed">
                  {"\u770b\u8a3a\u96fb\u8166\u4e0d\u8981\u52fe\u3002\u6ac3\u53f0\u90a3\u53f0\u8981\u52fe\uff0c\u63d2\u597d\u75c5\u60a3\u5065\u4fdd\u5361\u518d\u6309\u4e00\u6b21\u5b58\u6a94\u624d\u6703\u9001\u96f2\u7aef\u3002\u52fe\u9078\u53ea\u8ddf\u9019\u53f0\u96fb\u8166\uff0c\u6309\u4e0a\u65b9\u5b58\u6a94\u5f8c\u751f\u6548\u3002\u9084\u6c92\u52fe\u904e\u6642\uff0c\u639b\u865f\u53f0\u9810\u8a2d\u8981\u5beb\uff0c\u5176\u4ed6\u89d2\u8272\u9810\u8a2d\u4e0d\u5beb\u3002"}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[13px] font-bold max-w-xl border px-2 py-2" style={{ borderColor: "#808080", background: "#E8F8E8" }}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deviceMeta.printOnSave ?? (deviceMeta.role === "outpatient" || deviceMeta.role === "pharmacy")}
                onChange={(e) => setDeviceMeta({ ...deviceMeta, printOnSave: e.target.checked })}
              />
              <span>
                {"\u9019\u53f0\u96fb\u8166\u5b58\u6a94\u5f8c\u8df3\u51fa\u5217\u5370"}
                <span className="mt-1 block text-[11px] font-normal leading-relaxed">
                  {"\u770b\u8a3a\u3001\u85e5\u5c40\u8981\u52fe\uff0c\u5b58\u6a94\u5f8c\u6703\u958b\u7c21\u5f0f\u4ea4\u4ed8\u8655\u65b9\u7c3d\u3002\u639b\u865f\u53f0\u4e0d\u8981\u52fe\uff0c\u907f\u514d\u6ac3\u53f0\u518d\u5370\u4e00\u6b21\u3002\u52fe\u9078\u53ea\u8ddf\u9019\u53f0\u96fb\u8166\uff0c\u6309\u4e0a\u65b9\u5b58\u6a94\u5f8c\u751f\u6548\u3002\u9084\u6c92\u52fe\u904e\u6642\uff0c\u770b\u8a3a\u548c\u85e5\u5c40\u9810\u8a2d\u8981\u8df3\uff0c\u639b\u865f\u53f0\u9810\u8a2d\u4e0d\u8df3\u3002"}
                </span>
              </span>
            </label>
            <p className="text-[11px]">
              {"\u6309\u4e0a\u65b9\u300c\u5b58\u6a94 [F9]\u300d\u6703\u5beb\u5165\u672c\u6a5f\u4e26\u540c\u6b65\u5230\u4f3a\u670d\u5668\u88dd\u7f6e\u8868\u3002\u5176\u4ed6\u53c3\u6578\u82e5\u9078\u300c\u672c\u6a5f\u8986\u5beb\u300d\uff0c\u4e5f\u639b\u5728\u6b64\u88dd\u7f6e ID \u4e0b\u3002"}
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-6 py-3 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between items-center shrink-0">
        <div>
          <span>★ 院所政策在伺服器 · 本機只存角色／列印／覆寫</span>
          <span className="ml-2 text-slate-600">|</span>
          <span className="ml-2">版本: 18.061</span>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/")}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold transition"
          >
            取消關閉 [Esc]
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition"
          >
            儲存變更 [F9]
          </button>
        </div>
      </footer>
    </div>
  );
}

