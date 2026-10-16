import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClinicWorkspace } from "@/hooks/useClinicWorkspace";

export function SpeakerPage() {
  const navigate = useNavigate();
  const { queue } = useClinicWorkspace();
  const [currentCall, setCurrentCall] = useState<{ id: string; name: string; number: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speechPitch, setSpeechPitch] = useState(1.0);
  const [history, setHistory] = useState<{ time: string; text: string }[]>([]);

  // Filter calling or outpatient waiting list
  const waitingPatients = queue.filter(
    (p) => p.queueStatus === "waiting" || p.queueStatus === "in_progress"
  );

  const speakName = (name: string, number: number) => {
    if (!("speechSynthesis" in window)) {
      alert("您的瀏覽器不支援語音合成功能，改採模擬廣播。");
      mockSpeak(name, number);
      return;
    }

    setIsPlaying(true);
    const text = `請 ${number} 號 ${name} 看診`;
    
    // Add to history log
    const time = new Date().toLocaleTimeString();
    setHistory((prev) => [{ time, text }, ...prev.slice(0, 19)]);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-TW";
    utterance.rate = speechRate;
    utterance.pitch = speechPitch;
    
    utterance.onend = () => {
      setIsPlaying(false);
    };
    utterance.onerror = () => {
      setIsPlaying(false);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const mockSpeak = (name: string, number: number) => {
    setIsPlaying(true);
    const text = `【廣播】請 ${number} 號 ${name} 看診`;
    const time = new Date().toLocaleTimeString();
    setHistory((prev) => [{ time, text }, ...prev.slice(0, 19)]);
    setTimeout(() => {
      setIsPlaying(false);
    }, 2500);
  };

  const handleCallPatient = (patient: typeof queue[0]) => {
    const name = patient.patientDisplay || "無名氏";
    const num = patient.queueNumber || 0;
    setCurrentCall({
      id: patient.encounterId,
      name,
      number: num,
    });
    speakName(name, num);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 flex flex-col font-sans relative overflow-hidden">
      {/* Visual background lights */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-amber-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-red-600/5 blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="mb-6 flex items-center justify-between border-b border-slate-800 pb-3 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold transition shadow-sm"
          >
            <span>🏠</span> 回主選單
          </button>
          <div className="h-5 w-[1px] bg-slate-700" />
          <div>
            <h1 className="text-lg font-black tracking-wide text-amber-400">
              🔊 語音叫號廣播系統 (Patientspeak.exe)
            </h1>
            <p className="text-[10px] text-slate-400">
              門診即時叫號、多媒體廣播與候診清單同步模組
            </p>
          </div>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden min-h-0 z-10">
        
        {/* Left LED Screen & Controls */}
        <section className="lg:col-span-2 flex flex-col gap-6 overflow-y-auto pr-1">
          {/* LED Panel */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl relative flex flex-col items-center justify-center min-h-[260px] overflow-hidden">
            <div className="absolute top-2 left-4 flex gap-1.5 items-center">
              <span className={`w-2.5 h-2.5 rounded-full ${isPlaying ? "bg-red-500 animate-ping" : "bg-emerald-500"}`} />
              <span className="text-[9px] font-mono tracking-widest text-slate-500 uppercase">
                {isPlaying ? "Broadcasting..." : "System Standby"}
              </span>
            </div>

            {/* Glowing LED Numbers */}
            <div className="text-center">
              <div className="text-xs font-bold text-red-500/80 tracking-widest uppercase mb-1">
                目前叫號
              </div>
              <div className="font-mono text-7xl font-black text-red-500 tracking-wider filter drop-shadow-[0_0_15px_rgba(239,68,68,0.7)] animate-pulse">
                {currentCall ? String(currentCall.number).padStart(3, "0") : "---"}
              </div>
              <div className="text-xl font-extrabold text-slate-300 mt-4 tracking-widest">
                {currentCall ? currentCall.name : "請選擇患者叫號"}
              </div>
            </div>

            {/* Simulated Audio Wave Animation */}
            {isPlaying && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-0.5 h-8 opacity-40">
                {[8, 12, 18, 10, 22, 14, 9, 20, 16, 11, 24, 13, 8, 19, 15, 10, 21, 12, 9, 18, 14, 11, 20, 8].map(
                  (height, i) => (
                    <div
                      key={i}
                      className="w-1.5 bg-amber-400 rounded-full animate-bounce"
                      style={{
                        animationDuration: `${0.45 + (i % 4) * 0.08}s`,
                        animationDelay: `${i * 0.05}s`,
                        height: `${height}px`,
                      }}
                    />
                  ),
                )}
              </div>
            )}
          </div>

          {/* Speech Settings Panel */}
          <div className="rounded-2xl border border-slate-800 bg-slate-850/40 p-5 shadow-lg flex flex-col gap-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2">
              🎙️ 廣播語音參數設定
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="flex justify-between text-slate-400 mb-1">
                  <span>語音速度 (Rate)：</span>
                  <span className="font-mono text-amber-400 font-bold">{speechRate.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  className="w-full accent-amber-500"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="flex justify-between text-slate-400 mb-1">
                  <span>音調頻率 (Pitch)：</span>
                  <span className="font-mono text-amber-400 font-bold">{speechPitch.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  className="w-full accent-amber-500"
                  value={speechPitch}
                  onChange={(e) => setSpeechPitch(parseFloat(e.target.value))}
                />
              </div>
            </div>

            {/* Quick Broadcast Presets */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  if ("speechSynthesis" in window) {
                    const text = "請各位病患注意，系統將於十分鐘後進行資料庫重整，請耐心等待。";
                    const u = new SpeechSynthesisUtterance(text);
                    u.lang = "zh-TW";
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(u);
                    setHistory((prev) => [{ time: new Date().toLocaleTimeString(), text: `【公告】${text}` }, ...prev]);
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 transition border border-slate-700"
              >
                📢 重整系統公告
              </button>
              <button
                onClick={() => {
                  if ("speechSynthesis" in window) {
                    const text = "門診即將結束，請尚未就診之病患至診前櫃檯辦理登記。";
                    const u = new SpeechSynthesisUtterance(text);
                    u.lang = "zh-TW";
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(u);
                    setHistory((prev) => [{ time: new Date().toLocaleTimeString(), text: `【公告】${text}` }, ...prev]);
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 transition border border-slate-700"
              >
                📢 門診結束公告
              </button>
            </div>
          </div>
        </section>

        {/* Right Queue List & Logs */}
        <section className="flex flex-col gap-6 overflow-hidden">
          {/* Waiting Patients List */}
          <div className="flex-1 rounded-2xl border border-slate-800 bg-slate-850/40 p-4 flex flex-col overflow-hidden shadow-lg">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2 mb-3 shrink-0">
              📋 待診患者清單 ({waitingPatients.length} 人)
            </h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
              {waitingPatients.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">當前無等待看診之病患</div>
              ) : (
                waitingPatients.map((patient) => (
                  <div
                    key={patient.encounterId}
                    className="p-3 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/20 flex items-center justify-between transition group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold font-mono text-amber-400">
                          #{String(patient.queueNumber).padStart(3, "0")}
                        </span>
                        <span className="text-xs font-bold text-slate-200">{patient.patientDisplay}</span>
                      </div>
                      <span className="text-[9px] text-slate-500 mt-1 block">
                        狀態: {patient.queueStatus === "in_progress" ? "診斷中" : "候診中"}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCallPatient(patient)}
                      className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold hover:bg-amber-500 hover:text-slate-950 transition active:scale-95"
                    >
                      🔊 叫號
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* History Log */}
          <div className="h-44 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col overflow-hidden shadow-lg">
            <h3 className="text-[10px] font-bold text-slate-500 tracking-widest uppercase border-b border-slate-800 pb-1 mb-2 shrink-0">
              📜 播報紀錄歷史
            </h3>
            <div className="flex-1 overflow-y-auto space-y-1.5 text-[10px] font-mono text-slate-400 scrollbar-thin">
              {history.length === 0 ? (
                <p className="text-slate-600 text-center py-4">無播放紀錄...</p>
              ) : (
                history.map((h, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-600">{h.time}</span>
                    <span className="text-slate-300">{h.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
