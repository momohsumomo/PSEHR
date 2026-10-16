import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClinicWorkspace } from "@/hooks/useClinicWorkspace";
import type { QueueEntry } from "@/mocks/clinicMocks";

interface EligibilityResult {
  programName: string;
  eligible: boolean | null;
  frequency: string;
  reason: string;
}

function parseAgeYears(pat: QueueEntry): number | null {
  const raw = (pat.age ?? "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const m = (pat.ageSex ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseSex(pat: QueueEntry): "M" | "F" | null {
  if (pat.sex === "M" || pat.sex === "F") return pat.sex;
  if ((pat.ageSex ?? "").endsWith("M")) return "M";
  if ((pat.ageSex ?? "").endsWith("F")) return "F";
  return null;
}

function checkEligibility(pat: QueueEntry): EligibilityResult[] {
  const age = parseAgeYears(pat);
  const sex = parseSex(pat);
  const unknown = "年齡或性別未進本系統，無法判定";

  const adultOk = age === null ? null : age >= 40;
  const papOk = age === null || sex === null ? null : sex === "F" && age >= 30;
  const mammoOk = age === null || sex === null ? null : sex === "F" && age >= 45;
  const fobtOk = age === null ? null : age >= 50 && age <= 74;

  return [
    {
      programName: "成人預防保健",
      eligible: adultOk,
      frequency: "40–64歲每3年一次；65歲以上每年一次",
      reason: adultOk === null ? unknown : adultOk ? "年齡符合區間" : "未達40歲",
    },
    {
      programName: "子宮頸抹片檢查",
      eligible: papOk,
      frequency: "30歲以上婦女每年一次",
      reason:
        papOk === null ? unknown : papOk ? "年齡與性別符合" : sex === "M" ? "性別不符" : "年齡低於30歲",
    },
    {
      programName: "乳房X光攝影檢查",
      eligible: mammoOk,
      frequency: "45–69歲或40–44歲二等親內乳癌史每2年一次",
      reason:
        mammoOk === null ? unknown : mammoOk ? "年齡符合篩檢區間" : sex === "M" ? "性別不符" : "未達45歲",
    },
    {
      programName: "大腸癌篩檢（定量免疫糞便潛血）",
      eligible: fobtOk,
      frequency: "50–74歲每2年一次",
      reason: fobtOk === null ? unknown : fobtOk ? "符合篩檢年齡" : "非50至74歲",
    },
  ];
}

export function PreventiveCarePage() {
  const navigate = useNavigate();
  const { queue } = useClinicWorkspace();
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [checklist, setChecklist] = useState<EligibilityResult[]>([]);
  const [records, setRecords] = useState<
    { id: string; name: string; date: string; program: string; result: string }[]
  >([]);

  const activePatient = queue.find((p) => p.patientId === selectedPatientId);

  const handleSelectPatient = (id: string) => {
    setSelectedPatientId(id);
    const pat = queue.find((p) => p.patientId === id);
    setChecklist(pat ? checkEligibility(pat) : []);
  };

  const handleRegisterExam = (programName: string) => {
    if (!activePatient) return;
    const newRecord = {
      id: `draft-${Date.now().toString().slice(-6)}`,
      name: activePatient.patientDisplay || activePatient.patientName || "—",
      date: new Date().toISOString().slice(0, 10),
      program: programName,
      result: "本畫面暫存，尚未寫入申報、也未上健保 VPN 收案",
    };
    setRecords([newRecord, ...records]);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-6 flex flex-col font-sans">
      <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-sm"
          >
            <span>🏠</span> 回主選單
          </button>
          <div className="h-5 w-[1px] bg-slate-300" />
          <div>
            <h1 className="text-lg font-black tracking-wide text-slate-800">預防保健作業</h1>
            <p className="text-[10px] text-slate-500">
              資格只依已有年齡／性別套健保區間；缺欄顯示無法判定。不編造身分證，不假裝 VPN 收案
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden min-h-0">
        <section className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-4 overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold text-slate-500 border-b pb-2 mb-3">選擇病患</h3>
            <select
              value={selectedPatientId}
              onChange={(e) => handleSelectPatient(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">— 請選擇門診病患 —</option>
              {queue.map((pat) => (
                <option key={pat.encounterId} value={pat.patientId}>
                  {pat.patientDisplay || pat.patientName || "—"}（病歷號: {pat.medicalNo || "—"}）
                </option>
              ))}
            </select>
          </div>

          {selectedPatientId && activePatient && (
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>姓名</span>
                <span className="font-bold text-slate-800">
                  {activePatient.patientDisplay || activePatient.patientName || "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>性別</span>
                <span className="font-mono">{parseSex(activePatient) ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>年齡</span>
                <span className="font-mono">{parseAgeYears(activePatient) ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>生日</span>
                <span className="font-mono">{activePatient.birthday || "—"}</span>
              </div>
            </div>
          )}

          {selectedPatientId ? (
            <div className="space-y-3">
              <h4 className="text-[10px] text-slate-500 font-bold">篩檢資格（依已有欄位）</h4>
              <div className="space-y-2">
                {checklist.map((c) => (
                  <div
                    key={c.programName}
                    className={`p-3 rounded-lg border text-xs flex flex-col gap-1.5 ${
                      c.eligible === true
                        ? "bg-emerald-50 border-emerald-200"
                        : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-800">{c.programName}</span>
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-white border">
                        {c.eligible === true ? "符合區間" : c.eligible === false ? "不符" : "無法判定"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">{c.frequency}</p>
                    <div className="flex justify-between items-center mt-1 border-t border-slate-200 pt-1.5">
                      <span className="text-[9px] text-slate-500">{c.reason}</span>
                      {c.eligible === true && (
                        <button
                          type="button"
                          onClick={() => handleRegisterExam(c.programName)}
                          className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-800 text-white font-bold text-[9px]"
                        >
                          本機暫存
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-xs text-slate-400">請選擇病患後依年齡／性別判定區間</div>
          )}
        </section>

        <section className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 flex flex-col overflow-hidden">
          <h3 className="text-xs font-bold text-slate-500 border-b pb-2 mb-4 shrink-0">
            本機暫存清單（非健保收案）
          </h3>
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 sticky top-0 text-left border-b">
                <tr>
                  <th className="px-3 py-2">暫存號</th>
                  <th className="px-3 py-2">姓名</th>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">項目</th>
                  <th className="px-3 py-2">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                      尚無暫存。上傳收案請人上診所健保 VPN，系統不代操。
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5 font-mono text-slate-500">{r.id}</td>
                      <td className="px-3 py-2.5 font-bold">{r.name}</td>
                      <td className="px-3 py-2.5 font-mono">{r.date}</td>
                      <td className="px-3 py-2.5">{r.program}</td>
                      <td className="px-3 py-2.5 text-slate-500">{r.result}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
