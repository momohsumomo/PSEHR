import { useState } from "react";

import { ANATOMY } from "./anatomyPaths";

export const SITE_LABEL: Record<string, string> = {
  scalp: "\u982d\u76ae",
  forehead: "\u984d\u982d",
  "forehead-r": "\u53f3\u984d",
  "forehead-l": "\u5de6\u984d",
  glabella: "\u7709\u5fc3",
  "temple-r": "\u53f3\u592a\u967d\u7a74",
  "temple-l": "\u5de6\u592a\u967d\u7a74",
  "face-r": "\u53f3\u9830",
  "face-l": "\u5de6\u9830",
  nose: "\u9f3b\u5b50",
  chin: "\u4e0b\u5df4",
  "undereye-r": "\u53f3\u773c\u4e0b",
  "undereye-l": "\u5de6\u773c\u4e0b",
  "jaw-r": "\u53f3\u4e0b\u984e",
  "jaw-l": "\u5de6\u4e0b\u984e",
  "ear-r": "\u53f3\u8033",
  "ear-l": "\u5de6\u8033",
  neck: "\u8116\u5b50",
  "chest-r": "\u53f3\u80f8",
  "chest-l": "\u5de6\u80f8",
  "abdomen-r": "\u53f3\u8179",
  "abdomen-l": "\u5de6\u8179",
  "groin-r": "\u53f3\u9f20\u8c6c",
  "groin-l": "\u5de6\u9f20\u8c6c",
  "eyelid-r": "\u53f3\u773c\u76ae",
  "eyelid-l": "\u5de6\u773c\u76ae",
  lip: "\u5634\u5507",
  "arm-r": "\u53f3\u4e0a\u81c2",
  "arm-l": "\u5de6\u4e0a\u81c2",
  "forearm-r": "\u53f3\u524d\u81c2",
  "forearm-l": "\u5de6\u524d\u81c2",
  "hand-r": "\u53f3\u624b",
  "hand-l": "\u5de6\u624b",
  "thigh-r": "\u53f3\u5927\u817f",
  "thigh-l": "\u5de6\u5927\u817f",
  "knee-r": "\u53f3\u819d\u84cb",
  "knee-l": "\u5de6\u819d\u84cb",
  "shin-r": "\u53f3\u5c0f\u817f",
  "shin-l": "\u5de6\u5c0f\u817f",
  "foot-r": "\u53f3\u8173",
  "foot-l": "\u5de6\u8173",
  occiput: "\u5f8c\u8166",
  nape: "\u5f8c\u9838",
  "back-upper-r": "\u53f3\u4e0a\u80cc",
  "back-upper-l": "\u5de6\u4e0a\u80cc",
  "back-lower-r": "\u53f3\u4e0b\u80cc",
  "back-lower-l": "\u5de6\u4e0b\u80cc",
  "buttock-r": "\u53f3\u81c0",
  "buttock-l": "\u5de6\u81c0",
  "arm-r-back": "\u53f3\u4e0a\u81c2\u5f8c\u9762",
  "arm-l-back": "\u5de6\u4e0a\u81c2\u5f8c\u9762",
  "forearm-r-back": "\u53f3\u524d\u81c2\u5f8c\u9762",
  "forearm-l-back": "\u5de6\u524d\u81c2\u5f8c\u9762",
  "hand-r-back": "\u53f3\u624b\u80cc",
  "hand-l-back": "\u5de6\u624b\u80cc",
  "thigh-r-back": "\u53f3\u5927\u817f\u5f8c",
  "thigh-l-back": "\u5de6\u5927\u817f\u5f8c",
  "knee-r-back": "\u53f3\u819d\u7aa9",
  "knee-l-back": "\u5de6\u819d\u7aa9",
  "calf-r": "\u53f3\u5c0f\u817f\u5f8c",
  "calf-l": "\u5de6\u5c0f\u817f\u5f8c",
  "foot-r-back": "\u53f3\u8173\u5f8c",
  "foot-l-back": "\u5de6\u8173\u5f8c",
  "ear-r-back": "\u53f3\u8033\u5f8c",
  "ear-l-back": "\u5de6\u8033\u5f8c",
  "finger-r-thumb": "\u53f3\u62c7\u6307",
  "finger-r-index": "\u53f3\u98df\u6307",
  "finger-r-middle": "\u53f3\u4e2d\u6307",
  "finger-r-ring": "\u53f3\u7121\u540d\u6307",
  "finger-r-little": "\u53f3\u5c0f\u6307",
  "nail-r": "\u53f3\u624b\u6307\u7532",
  "finger-l-thumb": "\u5de6\u62c7\u6307",
  "finger-l-index": "\u5de6\u98df\u6307",
  "finger-l-middle": "\u5de6\u4e2d\u6307",
  "finger-l-ring": "\u5de6\u7121\u540d\u6307",
  "finger-l-little": "\u5de6\u5c0f\u6307",
  "nail-l": "\u5de6\u624b\u6307\u7532",
  body_head: "\u982d\u9838",
  body_chest_abdomen: "\u80f8\u8179",
  body_back: "\u80cc\u90e8",
  body_arm_right: "\u53f3\u4e0a\u80a2",
  body_arm_left: "\u5de6\u4e0a\u80a2",
  body_leg_right: "\u53f3\u4e0b\u80a2",
  body_leg_left: "\u5de6\u4e0b\u80a2",
  body_genital_buttock: "\u751f\u6b96\u81c0\u90e8",
  face_forehead: "\u984d\u982d",
  face_nose_glabella: "\u5370\u5802\u9f3b\u90e8",
  face_left_cheek: "\u5de6\u81c9\u9830",
  face_right_cheek: "\u53f3\u81c9\u9830",
  face_perioral: "\u53e3\u5468",
  face_chin: "\u4e0b\u5df4",
  hand_right_palmar_fingers: "\u53f3\u624b\u638c\u9762\u624b\u6307",
  hand_right_palmar_palm: "\u53f3\u624b\u638c",
  hand_right_dorsal_fingers: "\u53f3\u624b\u80cc\u9762\u624b\u6307",
  hand_right_dorsal_dorsum: "\u53f3\u624b\u80cc",
  hand_left_palmar_fingers: "\u5de6\u624b\u638c\u9762\u624b\u6307",
  hand_left_palmar_palm: "\u5de6\u624b\u638c",
  hand_left_dorsal_fingers: "\u5de6\u624b\u80cc\u9762\u624b\u6307",
  hand_left_dorsal_dorsum: "\u5de6\u624b\u80cc",
};

const SHORT_LABEL: Record<string, string> = {
  hand_right_palmar_fingers: "\u624b\u6307",
  hand_right_palmar_palm: "\u624b\u638c",
  hand_right_dorsal_fingers: "\u624b\u6307",
  hand_right_dorsal_dorsum: "\u624b\u80cc",
  hand_left_palmar_fingers: "\u624b\u6307",
  hand_left_palmar_palm: "\u624b\u638c",
  hand_left_dorsal_fingers: "\u624b\u6307",
  hand_left_dorsal_dorsum: "\u624b\u80cc",
};

const SKIN = "#F3D7C4";
const ON = "#F7C6DC";
const LINE = "#8D6B52";
const DASH = "#174E78";

type Region = { readonly id: string; readonly paths: readonly string[]; readonly cx: number; readonly cy: number };
type Chart = {
  readonly viewBox: string;
  readonly plate?: string;
  readonly plateBox?: string;
  readonly regions: readonly Region[];
  readonly decor?: readonly string[];
};

function frame(viewBox: string) {
  const [x, y, w, h] = viewBox.split(" ").map(Number);
  return { x, y, w, h };
}

function figureName(id: string) {
  return SHORT_LABEL[id] || SITE_LABEL[id] || id;
}

function Figure({
  chart,
  decor = [],
  selected,
  onToggle,
}: {
  chart: Chart;
  decor?: readonly string[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const box = frame(chart.viewBox);
  const plate = frame(chart.plateBox || chart.viewBox);
  const mesh = !chart.plate && chart.regions.some((region) => region.paths.length > 40);
  const hit = Math.max(box.w, box.h) * (mesh ? 0.012 : 0.028);
  const ink = Math.max(box.w, box.h) * (mesh ? 0.004 : 0.0035);
  const font = Math.max(box.w, box.h) * 0.042;
  const mid = box.x + box.w / 2;
  const picked = chart.regions.filter((region) => selected.includes(region.id));
  const gap = box.h * 0.08;
  const place = (rows: Region[], side: "left" | "right") => {
    let last = box.y;
    return [...rows].sort((a, b) => a.cy - b.cy).map((region) => {
      let ly = Math.max(region.cy, last + gap);
      const floor = box.y + box.h - font;
      if (ly > floor) ly = floor;
      last = ly;
      return {
        region,
        lx: side === "left" ? box.x + font * 0.2 : box.x + box.w - font * 0.2,
        ly,
        anchor: side === "left" ? "start" : "end",
      };
    });
  };
  const labels = [
    ...place(picked.filter((region) => region.cx < mid), "left"),
    ...place(picked.filter((region) => region.cx >= mid), "right"),
  ];
  return (
    <svg viewBox={chart.viewBox} className="h-full w-full touch-manipulation" role="group">
      {chart.plate ? (
        <image
          href={chart.plate}
          x={plate.x}
          y={plate.y}
          width={plate.w}
          height={plate.h}
          preserveAspectRatio="none"
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {chart.regions.map((region) => {
        const on = selected.includes(region.id);
        const fill = chart.plate ? (on ? "rgba(23,78,120,0.38)" : "transparent") : on ? ON : SKIN;
        const stroke = chart.plate ? (on ? DASH : "transparent") : mesh ? fill : on ? DASH : LINE;
        return (
          <g
            key={region.id}
            id={region.id}
            role="button"
            aria-pressed={on}
            aria-label={SITE_LABEL[region.id] || region.id}
            style={{ cursor: "pointer", touchAction: "manipulation" }}
            onClick={() => onToggle(region.id)}
          >
            {region.paths.map((d, index) => (
              <path
                key={index}
                d={d}
                fill={fill}
                fillRule="evenodd"
                stroke={stroke}
                strokeWidth={mesh ? ink : on ? ink * 2.2 : ink}
                strokeDasharray={mesh || !on ? undefined : `${ink * 5} ${ink * 3.5}`}
                strokeLinejoin="round"
              />
            ))}
            {region.paths.map((d, index) => (
              <path key={`hit-${index}`} d={d} fill="none" stroke="transparent" strokeWidth={hit} strokeLinejoin="round" />
            ))}
          </g>
        );
      })}
      {decor.map((d, index) => (
        <path key={`decor-${index}`} d={d} fill="none" stroke="#5C4030" strokeWidth={ink * 1.6} strokeLinejoin="round" style={{ pointerEvents: "none" }} />
      ))}
      {labels.map((row) => (
        <g key={`label-${row.region.id}`} style={{ pointerEvents: "none" }}>
          <line x1={row.region.cx} y1={row.region.cy} x2={row.lx} y2={row.ly} stroke={DASH} strokeWidth={ink} />
          <text x={row.lx} y={row.ly} textAnchor={row.anchor} dominantBaseline="middle" fill={DASH} fontSize={font} fontWeight={700}>
            {figureName(row.region.id)}
          </text>
        </g>
      ))}
    </svg>
  );
}

type MapProps = {
  face: "front" | "back";
  selected: string[];
  onToggle: (id: string) => void;
};

export function BodyMap({ face, selected, onToggle }: MapProps) {
  const chart = face === "back" ? ANATOMY.body.back : ANATOMY.body.front;
  return <Figure chart={chart} selected={selected} onToggle={onToggle} />;
}

export function FaceZoom({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  return <Figure chart={ANATOMY.face} decor={ANATOMY.face.decor} selected={selected} onToggle={onToggle} />;
}

export function HandsZoom({
  face,
  selected,
  onToggle,
}: {
  face: "front" | "back";
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [side, setSide] = useState<"right" | "left">("right");
  const chart = ANATOMY.hands[side];
  const views = face === "back"
    ? [["\u624b\u80cc\u9762", chart.dorsal], ["\u624b\u638c\u9762", chart.palmar]]
    : [["\u624b\u638c\u9762", chart.palmar], ["\u624b\u80cc\u9762", chart.dorsal]];
  const tab = (on: boolean) =>
    `rounded-xl border-4 border-[#2060A0] py-2 text-xl font-bold ${on ? "bg-[#2060A0] text-white" : "bg-white text-black"}`;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="grid shrink-0 grid-cols-2 gap-1">
        <button type="button" className={tab(side === "right")} onClick={() => setSide("right")}>{"\u53f3\u624b"}</button>
        <button type="button" className={tab(side === "left")} onClick={() => setSide("left")}>{"\u5de6\u624b"}</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-1">
        {views.map(([title, view]) => (
          <div key={title} className="flex min-h-0 flex-col">
            <p className="shrink-0 text-center text-base font-bold">{title}</p>
            <div className="min-h-0 flex-1">
              <Figure chart={view} selected={selected} onToggle={onToggle} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
