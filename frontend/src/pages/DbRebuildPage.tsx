import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEscLayer } from "@/hooks/useEscLayer";

export function DbRebuildPage() {
  const navigate = useNavigate();
  useEscLayer([{ open: true, close: () => navigate("/") }]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const handleRebuild = () => {
    setRunning(false);
    setProgress(0);
    setLogs([
      "資料重整尚未接 FHIR／影子庫索引作業。",
      "不掃描 Z:\\SC\\DAT，不重建 CDX，不假裝修復成功。",
      "此畫面只留資料重整入口，尚未接到影子庫。",
    ]);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-6 flex flex-col font-sans">
      <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-sm"
          >
            <span>🏠</span> 回主選單
          </button>
          <div className="h-5 w-[1px] bg-slate-300" />
          <div>
            <h1 className="text-lg font-black tracking-wide text-slate-800">
              D 資料庫修復與索引重整 (Modistru.exe)
            </h1>
            <p className="text-[10px] text-slate-500">
              清理資料表冗餘空間、重新產生 CDX 檔案以解決就醫序號重號或資料存取損壞問題
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-h-0 overflow-hidden">
        {/* Left Control Panel */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4 h-fit">
          <h2 className="text-sm font-bold text-slate-800 border-b pb-2">
            索引重建控制台
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            當系統在診療寫入健保 IC 卡、調閱歷史病歷、或掛號搜尋時發生卡頓，建議執行此修復重整程序。
          </p>

          {running && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-bold text-slate-500">
                <span>正在重整中...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-sky-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={running}
            onClick={handleRebuild}
            className="w-full py-2.5 rounded-lg bg-sky-700 hover:bg-sky-850 text-white font-bold text-xs transition shadow-sm"
          >
            {running ? "執行中…" : "開始重整（尚未接）"}
          </button>
        </section>

        {/* Right Output Log console */}
        <section className="col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col overflow-hidden">
          <h2 className="text-sm font-bold text-slate-800 border-b pb-2 mb-3">
            修復重整日誌 (Modistru Output)
          </h2>
          <div className="flex-1 bg-slate-950 rounded-lg p-4 font-mono text-xs text-emerald-400 overflow-y-auto space-y-1">
            <p className="text-slate-500">等待使用者啟動修復...</p>
            {logs.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
