import { useEffect, useState } from "react";

import { BodyMap, FaceZoom, LimbZoom, SITE_LABEL } from "@/components/kiosk/BodyMap";

const onCls = "kiosk-pick";

export function AnatomyPreviewPage() {
  const [face, setFace] = useState<"front" | "back">("front");
  const [sex, setSex] = useState<"F" | "M">("F");
  const [sites, setSites] = useState<string[]>([]);

  useEffect(() => {
    const prev = document.title;
    document.title = "\u90e8\u4f4d\u793a\u7bc4";
    return () => {
      document.title = prev;
    };
  }, []);

  const toggleSite = (id: string) => {
    setSites((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <div data-surface="kiosk" className="flex h-dvh min-h-0 flex-col bg-[#E8F1FA] p-4 text-[#102030]">
      <p className="shrink-0 text-center text-base font-bold">
        {"\u793a\u7bc4\u9801\u3002\u9ede\u4e86\u53ea\u5728\u9019\u53f0\u756b\u9762\u5708\u8d77\u4f86\uff0c\u4e0d\u6703\u67e5\u639b\u865f\uff0c\u4e5f\u4e0d\u6703\u9001\u51fa\u3002"}
      </p>
      <h1 className="shrink-0 text-center text-2xl font-bold">{"\u8acb\u9ede\u4e0d\u8212\u670d\u7684\u5730\u65b9\uff0c\u53ef\u4ee5\u9ede\u591a\u8655"}</h1>
      <p className="shrink-0 text-center text-base">
        {face === "back"
          ? "\u9019\u662f\u80cc\u9762\uff0c\u4eba\u7684\u5de6\u908a\u5c31\u662f\u60a8\u7684\u5de6\u624b\u908a\u3002\u9ede\u5230\u7684\u5730\u65b9\u624d\u6703\u5708\u8d77\u4f86\u3002\u540d\u7a31\u5217\u5728\u4e0b\u65b9\u3002\u81c9\u4e0a\u7d30\u4f4d\u8acb\u5207\u56de\u6b63\u9762\u3002"
          : "\u9762\u5c0d\u9019\u5f35\u5716\uff0c\u4eba\u7684\u5de6\u908a\u662f\u60a8\u7684\u53f3\u624b\u908a\u3002\u9ede\u5230\u7684\u5730\u65b9\u624d\u6703\u5708\u8d77\u4f86\u3002\u540d\u7a31\u5217\u5728\u4e0b\u65b9\u3002"}
      </p>
      <div className="mt-2 grid shrink-0 grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
        <button type="button" className={`min-h-10 rounded-xl border-4 border-[#2060A0] bg-white text-lg font-bold text-black ${face === "front" ? onCls : ""}`} onClick={() => setFace("front")}>
          {"\u6b63\u9762"}
        </button>
        <button type="button" className={`min-h-10 rounded-xl border-4 border-[#2060A0] bg-white text-lg font-bold text-black ${face === "back" ? onCls : ""}`} onClick={() => setFace("back")}>
          {"\u80cc\u9762"}
        </button>
        <button type="button" className={`min-h-10 rounded-xl border-4 border-[#2060A0] bg-white text-lg font-bold text-black ${sex === "F" ? onCls : ""}`} onClick={() => setSex("F")}>
          {"\u5973"}
        </button>
        <button type="button" className={`min-h-10 rounded-xl border-4 border-[#2060A0] bg-white text-lg font-bold text-black ${sex === "M" ? onCls : ""}`} onClick={() => setSex("M")}>
          {"\u7537"}
        </button>
        <button type="button" className="min-h-10 rounded-xl border-4 border-[#2060A0] bg-white px-4 text-lg font-bold text-black" onClick={() => setSites([])}>
          {"\u6e05\u9664"}
        </button>
      </div>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-[1.35fr_1fr_1fr] items-stretch gap-2">
        <div className="flex min-h-0 flex-col">
          {face === "front" ? (
            <FaceZoom selected={sites} onToggle={toggleSite} sex={sex} />
          ) : (
            <p className="m-auto text-center text-xl font-bold">{"\u81c9\u4e0a\u7d30\u4f4d\u8acb\u5207\u56de\u6b63\u9762"}</p>
          )}
        </div>
        <div className="min-h-0 min-w-0">
          <BodyMap face={face} selected={sites} onToggle={toggleSite} />
        </div>
        <div className="flex min-h-0 flex-col">
          <LimbZoom face={face} selected={sites} onToggle={toggleSite} />
        </div>
      </div>
      <div className="mt-2 flex min-h-16 flex-wrap content-start justify-center gap-2">
        {sites.length === 0 ? (
          <p className="text-xl">{"\u9084\u6c92\u9078"}</p>
        ) : (
          sites.map((id) => (
            <span key={id} className="rounded-full border-2 border-[#174E78] px-3 py-1 text-lg font-bold text-[#174E78]">
              {SITE_LABEL[id] || id}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
