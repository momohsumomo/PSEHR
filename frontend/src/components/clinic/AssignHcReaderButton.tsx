import { useState } from "react";
import { assignHealthCardReader, DeskCardError, listLocalReaders, savedHealthCardReader } from "@/lib/localCard";

/** Picks which reader later health-card reads use. Does not read the card. */
export function AssignHcReaderButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [readers, setReaders] = useState<string[]>([]);

  const fail = (err: unknown) => {
    setNote(err instanceof DeskCardError || err instanceof Error ? err.message : "\u6307\u5b9a\u5931\u6557");
  };

  const load = async () => {
    setBusy(true);
    setNote("");
    setReaders([]);
    try {
      const names = await listLocalReaders();
      setReaders(names);
      if (names.length === 0) {
        setNote("\u9019\u53f0\u6c92\u6709\u770b\u5230\u8b80\u5361\u6a5f\u3002");
        return;
      }
      if (names.length === 1) {
        setNote(await assignHealthCardReader(names[0]));
        return;
      }
      const saved = savedHealthCardReader();
      setNote(
        saved
          ? "\u76ee\u524d\u6307\u5b9a\uff1a\u300c" + saved + "\u300d\u3002\u9ede\u4e0b\u9762\u63db\u4e00\u53f0\u3002"
          : "\u9019\u53f0\u6709\u591a\u53f0\u8b80\u5361\u6a5f\u3002\u9ede\u4e0b\u9762\u6307\u5b9a\u54ea\u4e00\u53f0\u8b80\u5065\u4fdd\u5361\u3002",
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (name: string) => {
    setBusy(true);
    try {
      setNote(await assignHealthCardReader(name));
    } catch (err) {
      fail(err);
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
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
      >
        {"\u6307\u5b9a\u5065\u4fdd\u5361"}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-72 space-y-1 rounded border border-sky-700 bg-white p-2 text-[12px] text-black shadow-lg">
          {note ? <p className="leading-snug">{note}</p> : null}
          {readers.length > 1
            ? readers.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={busy}
                  className="block w-full border bg-white px-2 py-0.5 text-left text-black disabled:opacity-60"
                  onClick={() => void pick(name)}
                >
                  {name}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
