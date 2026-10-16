
import { useEffect, useState } from "react";
import { HisXpDialog } from "@/components/clinic/HisPageFrame";
import {
  fetchOpenDeposits,
  readCardProfile,
  refundDeposit,
  type OpenDeposit,
} from "@/api/clinicApi";

type Props = {
  open: boolean;
  onClose: () => void;
  initialIdNo?: string;
  onDone?: () => void;
};

function roc(iso: string): string {
  const [y, m, d] = (iso || "").slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return String(Number(y) - 1911) + "." + m + "." + d;
}

export function RefundDepositDialog({ open, onClose, initialIdNo = "", onDone }: Props) {
  const [items, setItems] = useState<OpenDeposit[]>([]);
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems([]);
    setPicked("");
    setNote("");
    const id = initialIdNo.trim().toUpperCase();
    if (id.length !== 10) return;
    void load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIdNo]);

  async function load(idNo: string) {
    setBusy(true);
    setNote("");
    try {
      const res = await fetchOpenDeposits(idNo);
      setItems(res.items);
      setPicked(res.items.length === 1 ? res.items[0].encounterId : "");
      if (!res.items.length) {
        setNote("這張身分證沒有還沒退的押單。");
      }
    } catch (e) {
      setItems([]);
      setNote(e instanceof Error ? e.message : "查不到押單");
    } finally {
      setBusy(false);
    }
  }

  const onRead = async () => {
    setBusy(true);
    setNote("");
    try {
      const card = await readCardProfile();
      const id = (card.profile?.idNo || "").trim().toUpperCase();
      if (id.length !== 10) {
        setNote(card.note || "讀不到健保卡身分證");
        return;
      }
      await load(id);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "讀卡失敗");
    } finally {
      setBusy(false);
    }
  };

  const onRefund = async () => {
    if (!picked) {
      setNote("請先選一筆押單");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const res = await refundDeposit(picked);
      setNote(res.reason || "已退押");
      setItems((rows) => rows.filter((row) => row.encounterId !== picked));
      setPicked("");
      onDone?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "沒有退押");
    } finally {
      setBusy(false);
    }
  };

  return (
    <HisXpDialog open={open} title="退押" onClose={onClose} width={560}>
      <div className="flex flex-col gap-2 text-[13px] text-black">
        <p>
          插入這位的健保卡。這個月的申報還沒送出之前，押金都可以退。取到就醫序號後，押金用現金退回。這筆跟退押那天一起上傳。
        </p>
        <div className="flex gap-2">
          <button type="button" className="border px-3 py-1" disabled={busy} onClick={() => void onRead()}>
            讀卡
          </button>
          <button type="button" className="border px-3 py-1 font-bold" disabled={busy || !picked} onClick={() => void onRefund()}>
            退押
          </button>
          <button type="button" className="border px-3 py-1" onClick={onClose}>
            離開
          </button>
        </div>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="border px-1">看診日</th>
              <th className="border px-1">序</th>
              <th className="border px-1">病歷號</th>
              <th className="border px-1">姓名</th>
              <th className="border px-1">押金</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.encounterId}
                className={picked === row.encounterId ? "bg-white" : undefined}
                onClick={() => setPicked(row.encounterId)}
              >
                <td className="border px-1">{roc(row.encounterDate)}</td>
                <td className="border px-1">{row.queueNumber}</td>
                <td className="border px-1">{row.chartNo}</td>
                <td className="border px-1">{row.name}</td>
                <td className="border px-1">{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {note ? <p>{note}</p> : null}
      </div>
    </HisXpDialog>
  );
}
