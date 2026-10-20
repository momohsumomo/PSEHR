import { useEffect, useState } from "react";

const KEY = "psehr-desk";
const HIDE = "psehr-desk-hide";

export function DeskExeNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("desk") === "1") {
      sessionStorage.setItem(KEY, "1");
      params.delete("desk");
      const next = params.toString();
      const path = window.location.pathname + (next ? `?${next}` : "") + window.location.hash;
      window.history.replaceState(null, "", path);
    }
    const fromExe = sessionStorage.getItem(KEY) === "1";
    const hidden = sessionStorage.getItem(HIDE) === "1";
    setShow(!fromExe && !hidden);
  }, []);

  if (!show) return null;

  return (
    <div className="sticky top-0 z-[80] flex items-center gap-3 border-b border-amber-700 bg-amber-300 px-3 py-1.5 text-[15px] font-bold text-black">
      <div className="flex-1 text-center">工作站必須用「開啟門診.exe」或「開啟掛號.exe」開啟，才能讀這台的卡。用 Chrome 或直接貼網址進來，讀不到這台電腦的讀卡機。</div>
      <button
        type="button"
        className="shrink-0 border border-black bg-amber-100 px-3 py-0.5 text-[14px]"
        onClick={() => {
          sessionStorage.setItem(HIDE, "1");
          setShow(false);
        }}
      >
        關掉
      </button>
    </div>
  );
}
