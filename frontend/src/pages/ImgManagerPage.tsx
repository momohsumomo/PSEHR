import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClinicWorkspace } from "@/hooks/useClinicWorkspace";

interface LesionImage {
  id: string;
  patientId: string;
  date: string;
  location: string;
  url: string;
  notes: string;
}

export function ImgManagerPage() {
  const navigate = useNavigate();
  const { queue } = useClinicWorkspace();
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<LesionImage | null>(null);
  
  const [images, setImages] = useState<LesionImage[]>([]);

  const activePatientName = queue.find(p => p.patientId === selectedPatientId)?.patientDisplay || "未選擇病患";
  const patientImages = selectedPatientId ? images.filter(img => img.patientId === selectedPatientId) : images;

  const handleAddImage = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPatientId) {
      alert("請先在左側選擇病患再上傳照片！");
      return;
    }
    const formData = new FormData(e.currentTarget);
    const location = formData.get("location") as string;
    const notes = formData.get("notes") as string;
    const file = (formData.get("photo") as File | null) ?? null;
    if (!file || file.size === 0) {
      alert("請選擇實際照片檔。不使用網路圖冒充病灶影像，也不寫入 FHIR Media。");
      return;
    }

    const newImg: LesionImage = {
      id: `img-${Date.now()}`,
      patientId: selectedPatientId,
      date: new Date().toISOString().slice(0, 10),
      location: location || "—",
      url: URL.createObjectURL(file),
      notes: notes || "—",
    };

    setImages([newImg, ...images]);
    setSelectedImage(newImg);
    e.currentTarget.reset();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 flex flex-col font-sans relative">
      {/* Top Banner */}
      <header className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold transition shadow-sm"
          >
            <span>🏠</span> 回主選單
          </button>
          <div className="h-5 w-[1px] bg-slate-700" />
          <div>
            <h1 className="text-lg font-black tracking-wide text-indigo-400">
              📷 影像管理系統 (Img.exe)
            </h1>
            <p className="text-[10px] text-slate-400">
              本畫面暫存選檔預覽；尚未寫入 FHIR Media。空庫不放網路圖冒充病患照片
            </p>
          </div>
        </div>
      </header>

      {/* Grid Container */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0 z-10">
        
        {/* Left Column: Patient selector and quick upload */}
        <section className="w-80 flex flex-col gap-4 shrink-0 overflow-y-auto pr-1">
          {/* Patient Selector */}
          <div className="bg-slate-850/50 rounded-xl border border-slate-850 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              1. 選擇看診患者
            </h3>
            <select
              value={selectedPatientId}
              onChange={(e) => {
                setSelectedPatientId(e.target.value);
                setSelectedImage(null);
              }}
              className="w-full rounded-lg border border-slate-750 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">全部就醫病患影像</option>
              {queue.map((pat) => (
                <option key={pat.encounterId} value={pat.patientId}>
                  {pat.patientDisplay} (Seq #{pat.queueNumber})
                </option>
              ))}
            </select>
          </div>

          {/* Upload Form */}
          <div className="bg-slate-850/50 rounded-xl border border-slate-850 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              2. 拍攝/匯入病灶影像
            </h3>
            <form onSubmit={handleAddImage} className="space-y-3">
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">對象患者</label>
                <input
                  type="text"
                  disabled
                  value={activePatientName}
                  className="w-full rounded-lg border border-slate-750 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-400 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">病灶解剖部位</label>
                <input
                  name="location"
                  type="text"
                  placeholder="如：左側前臂、後頸部"
                  required
                  className="w-full rounded-lg border border-slate-750 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">臨床觀察特徵 (Notes)</label>
                <textarea
                  name="notes"
                  rows={3}
                  placeholder="輸入病灶外觀特徵或切片、冷凍治療紀錄..."
                  className="w-full rounded-lg border border-slate-750 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">照片檔</label>
                <input
                  name="photo"
                  type="file"
                  accept="image/*"
                  required
                  className="w-full rounded-lg border border-slate-750 bg-slate-800 px-3 py-1.5 text-xs text-slate-200"
                />
              </div>
              <button
                type="submit"
                disabled={!selectedPatientId}
                className={`w-full py-2 rounded-lg font-bold text-xs transition text-center ${
                  selectedPatientId
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                    : "bg-slate-800 text-slate-650 cursor-not-allowed border border-slate-850"
                }`}
              >
                本機暫存預覽（未寫 Media）
              </button>
            </form>
          </div>
        </section>

        {/* Center: Image Gallery Grid */}
        <section className="flex-1 bg-slate-850/30 rounded-xl border border-slate-850 p-4 flex flex-col overflow-hidden shadow-inner">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-3 shrink-0">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {selectedPatientId ? `「${activePatientName}」的歷史病灶照片` : "全診所影像資料庫快照"}
            </h3>
            <span className="text-[10px] font-mono text-slate-500">
              共計 {patientImages.length} 張相片
            </span>
          </div>

          {patientImages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-xs text-slate-600">
              <span className="text-3xl mb-2">🖼️</span>
              此病患目前尚無病灶記錄相片
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-3 pr-1 scrollbar-thin">
              {patientImages.map((img) => (
                <div
                  key={img.id}
                  onClick={() => setSelectedImage(img)}
                  className={`group relative rounded-lg overflow-hidden border cursor-pointer transition ${
                    selectedImage?.id === img.id
                      ? "border-indigo-500 ring-2 ring-indigo-500/20"
                      : "border-slate-850 hover:border-indigo-500/50"
                  }`}
                >
                  <img src={img.url} alt={img.location} className="w-full h-32 object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex flex-col justify-end p-2 opacity-90 group-hover:opacity-100 transition">
                    <span className="text-[9px] font-bold text-indigo-400">{img.date}</span>
                    <span className="text-[11px] font-bold text-slate-200 truncate">{img.location}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right Panel: Detail view & comparison */}
        <section className="w-96 bg-slate-850/50 rounded-xl border border-slate-850 p-5 flex flex-col shadow-sm overflow-y-auto shrink-0">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 mb-4 shrink-0">
            🔎 影像檢視與分析儀表板
          </h3>
          {selectedImage ? (
            <div className="space-y-4 flex-1">
              <div className="rounded-lg overflow-hidden border border-slate-750 bg-slate-950 relative">
                <img src={selectedImage.url} alt={selectedImage.location} className="w-full h-48 object-contain" />
                <span className="absolute bottom-2 right-2 bg-slate-900/80 px-2 py-0.5 rounded text-[8px] font-mono text-indigo-400">
                  PACS ID: {selectedImage.id}
                </span>
              </div>
              <div className="text-xs space-y-2 text-slate-350">
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span>拍攝日期：</span>
                  <span className="font-bold text-slate-200">{selectedImage.date}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span>部位部位：</span>
                  <span className="font-bold text-indigo-300">{selectedImage.location}</span>
                </div>
                <div>
                  <span className="block mb-1 text-slate-500 font-bold">特徵描述：</span>
                  <p className="p-3 bg-slate-800 rounded-lg text-slate-300 leading-relaxed font-sans text-[11px]">
                    {selectedImage.notes}
                  </p>
                </div>
              </div>

              {/* Compare functionality mockup */}
              <div className="border-t border-slate-800 pt-4">
                <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">
                  對照排版工具
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => alert("雙圖對照尚未接歷史影像，不載入假照片。")}
                    className="py-1.5 rounded bg-slate-850 hover:bg-slate-800 text-[10px] text-slate-300 font-semibold border border-slate-700 transition"
                  >
                    🌓 雙圖分割對比
                  </button>
                  <button
                    onClick={() => alert("量測尺規尚未實作，不假裝已啟用。")}
                    className="py-1.5 rounded bg-slate-850 hover:bg-slate-800 text-[10px] text-slate-300 font-semibold border border-slate-700 transition"
                  >
                    📏 測量長度/面積
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-xs text-slate-650 text-center py-20">
              <span className="text-4xl mb-3">🔍</span>
              請點擊中間任一張病灶相片<br/>以啟用高畫質分析儀表板
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
