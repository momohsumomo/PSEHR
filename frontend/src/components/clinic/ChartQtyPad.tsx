/** ?B?ธิ??????L?G??q???~?|?r???]????t vkb?^?X ?I???g?J?B??C??q */
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  onInsert: (token: string) => void;
};

const ROW1 = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "1/2", "1/3", "1/4"];
const ROW2 = [
  { t: "A", c: "#40A040" },
  { t: "B", c: "#40A040" },
  { t: "C", c: "#40A040" },
  { t: "D", c: "#C0A020" },
  { t: "E", c: "#C0A020" },
  { t: "F", c: "#C0A020" },
  { t: "G", c: "#C040A0" },
  { t: "H", c: "#C040A0" },
  { t: "I", c: "#C040A0" },
  { t: "J", c: "#6080C0" },
  { t: "K", c: "#6080C0" },
  { t: "L", c: "#6080C0" },
  { t: "M", c: "#6080C0" },
];

export function ChartQtyPad({ onInsert }: Props) {
  return (
    <div
      className="shrink-0 border-t p-0.5"
      style={{ background: "#D0D0D0", borderColor: "#808080", fontFamily: HIS_FONT }}
    >
      <div className="grid gap-px" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
        {ROW1.map((t) => (
          <button
            key={t}
            type="button"
            className="px-0 py-0.5 text-center text-[9px] font-bold text-white"
            style={{ background: "#6080C0", border: "1px solid #808080" }}
            onClick={() => onInsert(t)}
          >
            {t}
          </button>
        ))}
        {ROW2.map((b) => (
          <button
            key={b.t}
            type="button"
            className="px-0 py-0.5 text-center text-[9px] font-bold text-white"
            style={{ background: b.c, border: "1px solid #808080" }}
            onClick={() => onInsert(b.t)}
          >
            {b.t}
          </button>
        ))}
      </div>
    </div>
  );
}
