/** 看診右上 vitals（體重／體溫／血壓／LMP）；主訴改左側手動輸入，不再放「主訴搜尋」 */
import { HIS, HIS_FONT } from "@/lib/hisTheme";

export type ChartVitals = {
  weight: string;
  temperature: string;
  bpSys: string;
  bpDia: string;
  lmp: string;
  /** @deprecated 主訴為手動輸入，不再使用 */
  ccSearch?: boolean;
};

type Props = {
  value: ChartVitals;
  onChange: (patch: Partial<ChartVitals>) => void;
};

const fieldCls =
  "w-full border bg-white px-0.5 py-0 font-mono outline-none focus:border-[#00A000]";

export function ChartVitalsColumn({ value, onChange }: Props) {
  return (
    <div
      className="flex w-[5.75rem] shrink-0 flex-col gap-0.5 border-l px-1 py-0.5"
      style={{
        borderColor: HIS.chromeDark,
        background: HIS.chrome,
        fontFamily: HIS_FONT,
        fontSize: HIS.fs.tertiary,
      }}
    >
      <label className="font-bold text-black">
        {"\u9ad4\u91cd"}
        <input
          className={fieldCls}
          style={{ height: HIS.row.formField, borderColor: HIS.chromeDark, fontSize: HIS.fs.secondary }}
          value={value.weight}
          onChange={(e) => onChange({ weight: e.target.value })}
          placeholder="0.0 KG"
        />
      </label>
      <label className="font-bold text-black">
        {"\u9ad4\u6eab"}
        <input
          className={fieldCls}
          style={{
            height: HIS.row.formField,
            borderColor: "#00A000",
            borderWidth: 2,
            fontSize: HIS.fs.secondary,
          }}
          value={value.temperature}
          onChange={(e) => onChange({ temperature: e.target.value })}
          placeholder={"0.0 \u00b0C"}
        />
      </label>
      <label className="font-bold text-black">
        {"\u8840\u58d3"}
        <div className="flex items-center gap-0.5">
          <input
            className={fieldCls}
            style={{ height: HIS.row.formField, borderColor: HIS.chromeDark, fontSize: HIS.fs.secondary }}
            value={value.bpSys}
            onChange={(e) => onChange({ bpSys: e.target.value })}
            placeholder="0"
          />
          <span>/</span>
          <input
            className={fieldCls}
            style={{ height: HIS.row.formField, borderColor: HIS.chromeDark, fontSize: HIS.fs.secondary }}
            value={value.bpDia}
            onChange={(e) => onChange({ bpDia: e.target.value })}
            placeholder="0"
          />
        </div>
      </label>
      <label className="font-bold text-black">
        LMP
        <input
          className={fieldCls}
          style={{ height: HIS.row.formField, borderColor: HIS.chromeDark, fontSize: HIS.fs.secondary }}
          value={value.lmp}
          onChange={(e) => onChange({ lmp: e.target.value })}
        />
      </label>
    </div>
  );
}

export const EMPTY_VITALS: ChartVitals = {
  weight: "0.0",
  temperature: "0.0",
  bpSys: "0",
  bpDia: "0",
  lmp: "",
};
