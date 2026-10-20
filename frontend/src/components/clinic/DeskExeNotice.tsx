import { useEffect, useState } from "react";

const KEY = "psehr-desk";

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
    setShow(sessionStorage.getItem(KEY) !== "1");
  }, []);

  if (!show) return null;

  return (
    <div className="sticky top-0 z-[80] border-b border-amber-700 bg-amber-300 px-4 py-2 text-center text-[15px] font-bold text-black">
      工作站必須用「開啟門診.exe」開啟才能讀這台的卡。用 Chrome 或直接貼網址進來，讀不到這台電腦的讀卡機。
    </div>
  );
}
