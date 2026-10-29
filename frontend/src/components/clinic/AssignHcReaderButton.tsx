import { useState } from "react";
import { assignHealthCardReader, DeskCardError } from "@/lib/localCard";
import { useFlashNote } from "@/components/clinic/useFlashNote";

/** Designates this computer's one reader. Does not read the card. */
export function AssignHcReaderButton() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useFlashNote();

  const assign = async () => {
    setBusy(true);
    setNote("");
    try {
      setNote(await assignHealthCardReader());
    } catch (err) {
      setNote(err instanceof DeskCardError || err instanceof Error ? err.message : "\u6307\u5b9a\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        disabled={busy}
        className="rounded border border-sky-700 bg-white px-2 py-0.5 text-[12px] font-bold text-sky-950 disabled:opacity-60"
        onClick={() => {
          void assign();
        }}
      >
        {"\u6307\u5b9a\u5065\u4fdd\u5361\u8b80\u5361\u6a5f"}
      </button>
      {note ? (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded border border-sky-700 bg-white p-2 text-[12px] leading-snug text-black shadow-lg">
          {note}
        </div>
      ) : null}
    </div>
  );
}
