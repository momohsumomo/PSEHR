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
  body_shoulder_right: "\u53f3\u80a9",
  body_shoulder_left: "\u5de6\u80a9",
  body_upper_arm_right: "\u53f3\u4e0a\u81c2",
  body_upper_arm_left: "\u5de6\u4e0a\u81c2",
  body_forearm_right: "\u53f3\u4e0b\u81c2",
  body_forearm_left: "\u5de6\u4e0b\u81c2",
  body_chest_right: "\u53f3\u80f8",
  body_chest_left: "\u5de6\u80f8",
  body_abdomen_right: "\u53f3\u8179",
  body_abdomen_left: "\u5de6\u8179",
  body_back_upper_right: "\u53f3\u4e0a\u80cc",
  body_back_upper_left: "\u5de6\u4e0a\u80cc",
  body_back_lower_right: "\u53f3\u4e0b\u80cc",
  body_back_lower_left: "\u5de6\u4e0b\u80cc",
  body_buttock_right: "\u53f3\u81c0",
  body_buttock_left: "\u5de6\u81c0",
  body_thigh_right: "\u53f3\u5927\u817f",
  body_thigh_left: "\u5de6\u5927\u817f",
  body_calf_right: "\u53f3\u5c0f\u817f",
  body_calf_left: "\u5de6\u5c0f\u817f",
  face_forehead: "\u984d\u982d",
  face_forehead_right: "\u53f3\u984d",
  face_forehead_left: "\u5de6\u984d",
  face_nose_glabella: "\u5370\u5802\u9f3b\u90e8",
  face_glabella: "\u5370\u5802",
  face_nose: "\u9f3b",
  face_left_cheek: "\u5de6\u81c9\u9830",
  face_right_cheek: "\u53f3\u81c9\u9830",
  face_eye_right: "\u53f3\u773c",
  face_eye_left: "\u5de6\u773c",
  face_ear_right: "\u53f3\u8033",
  face_ear_left: "\u5de6\u8033",
  face_perioral: "\u53e3\u5468",
  face_upper_lip: "\u4e0a\u5507",
  face_lower_lip: "\u4e0b\u5507",
  face_chin: "\u4e0b\u5df4",
  face_chin_right: "\u53f3\u4e0b\u5df4",
  face_chin_left: "\u5de6\u4e0b\u5df4",
  hand_right_palmar_fingers: "\u53f3\u624b\u638c\u9762\u624b\u6307",
  hand_right_palmar_palm: "\u53f3\u624b\u638c",
  hand_right_dorsal_fingers: "\u53f3\u624b\u80cc\u9762\u624b\u6307",
  hand_right_dorsal_dorsum: "\u53f3\u624b\u80cc",
  hand_left_palmar_fingers: "\u5de6\u624b\u638c\u9762\u624b\u6307",
  hand_left_palmar_palm: "\u5de6\u624b\u638c",
  hand_left_dorsal_fingers: "\u5de6\u624b\u80cc\u9762\u624b\u6307",
  hand_left_dorsal_dorsum: "\u5de6\u624b\u80cc",
  hand_right_palmar_thumb: "\u53f3\u624b\u638c\u62c7\u6307",
  hand_right_palmar_index: "\u53f3\u624b\u638c\u98df\u6307",
  hand_right_palmar_middle: "\u53f3\u624b\u638c\u4e2d\u6307",
  hand_right_palmar_ring: "\u53f3\u624b\u638c\u7121\u540d\u6307",
  hand_right_palmar_little: "\u53f3\u624b\u638c\u5c0f\u6307",
  hand_right_dorsal_thumb: "\u53f3\u624b\u80cc\u62c7\u6307",
  hand_right_dorsal_index: "\u53f3\u624b\u80cc\u98df\u6307",
  hand_right_dorsal_middle: "\u53f3\u624b\u80cc\u4e2d\u6307",
  hand_right_dorsal_ring: "\u53f3\u624b\u80cc\u7121\u540d\u6307",
  hand_right_dorsal_little: "\u53f3\u624b\u80cc\u5c0f\u6307",
  hand_left_palmar_thumb: "\u5de6\u624b\u638c\u62c7\u6307",
  hand_left_palmar_index: "\u5de6\u624b\u638c\u98df\u6307",
  hand_left_palmar_middle: "\u5de6\u624b\u638c\u4e2d\u6307",
  hand_left_palmar_ring: "\u5de6\u624b\u638c\u7121\u540d\u6307",
  hand_left_palmar_little: "\u5de6\u624b\u638c\u5c0f\u6307",
  hand_left_dorsal_thumb: "\u5de6\u624b\u80cc\u62c7\u6307",
  hand_left_dorsal_index: "\u5de6\u624b\u80cc\u98df\u6307",
  hand_left_dorsal_middle: "\u5de6\u624b\u80cc\u4e2d\u6307",
  hand_left_dorsal_ring: "\u5de6\u624b\u80cc\u7121\u540d\u6307",
  hand_left_dorsal_little: "\u5de6\u624b\u80cc\u5c0f\u6307",
  foot_right_dorsal_hallux: "\u53f3\u8173\u80cc\u62c7\u8dbe",
  foot_right_dorsal_second: "\u53f3\u8173\u80cc\u4e8c\u8dbe",
  foot_right_dorsal_third: "\u53f3\u8173\u80cc\u4e09\u8dbe",
  foot_right_dorsal_fourth: "\u53f3\u8173\u80cc\u56db\u8dbe",
  foot_right_dorsal_little: "\u53f3\u8173\u80cc\u5c0f\u8dbe",
  foot_right_dorsal_dorsum: "\u53f3\u8173\u80cc",
  foot_right_posterior: "\u53f3\u8173\u5f8c",
  foot_right_plantar_hallux: "\u53f3\u8173\u638c\u62c7\u8dbe",
  foot_right_plantar_second: "\u53f3\u8173\u638c\u4e8c\u8dbe",
  foot_right_plantar_third: "\u53f3\u8173\u638c\u4e09\u8dbe",
  foot_right_plantar_fourth: "\u53f3\u8173\u638c\u56db\u8dbe",
  foot_right_plantar_little: "\u53f3\u8173\u638c\u5c0f\u8dbe",
  foot_right_plantar_sole: "\u53f3\u8173\u638c",
  foot_right_plantar_fore: "\u53f3\u8173\u638c\u4e0a",
  foot_right_plantar_mid: "\u53f3\u8173\u638c\u4e2d",
  foot_right_plantar_heel: "\u53f3\u8173\u638c\u4e0b",
  foot_left_dorsal_hallux: "\u5de6\u8173\u80cc\u62c7\u8dbe",
  foot_left_dorsal_second: "\u5de6\u8173\u80cc\u4e8c\u8dbe",
  foot_left_dorsal_third: "\u5de6\u8173\u80cc\u4e09\u8dbe",
  foot_left_dorsal_fourth: "\u5de6\u8173\u80cc\u56db\u8dbe",
  foot_left_dorsal_little: "\u5de6\u8173\u80cc\u5c0f\u8dbe",
  foot_left_dorsal_dorsum: "\u5de6\u8173\u80cc",
  foot_left_posterior: "\u5de6\u8173\u5f8c",
  foot_left_plantar_hallux: "\u5de6\u8173\u638c\u62c7\u8dbe",
  foot_left_plantar_second: "\u5de6\u8173\u638c\u4e8c\u8dbe",
  foot_left_plantar_third: "\u5de6\u8173\u638c\u4e09\u8dbe",
  foot_left_plantar_fourth: "\u5de6\u8173\u638c\u56db\u8dbe",
  foot_left_plantar_little: "\u5de6\u8173\u638c\u5c0f\u8dbe",
  foot_left_plantar_sole: "\u5de6\u8173\u638c",
  foot_left_plantar_fore: "\u5de6\u8173\u638c\u4e0a",
  foot_left_plantar_mid: "\u5de6\u8173\u638c\u4e2d",
  foot_left_plantar_heel: "\u5de6\u8173\u638c\u4e0b",
};

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

function Figure({
  chart,
  selected,
  onToggle,
}: {
  chart: Chart;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const box = frame(chart.viewBox);
  const plate = frame(chart.plateBox || chart.viewBox);
  const ink = Math.max(box.w, box.h) * 0.004;
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
              <path key={index} d={d} fill="transparent" fillRule="evenodd" />
            ))}
            {on
              ? region.paths.map((d, index) => (
                  <path
                    key={`frame-${index}`}
                    d={d}
                    fill="none"
                    stroke={DASH}
                    strokeWidth={ink * 2.4}
                    strokeDasharray={`${ink * 5} ${ink * 3.5}`}
                    strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                ))
              : null}
          </g>
        );
      })}
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

export function FaceZoom({
  selected,
  onToggle,
  sex,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  sex?: string;
}) {
  const male = sex === "M" || sex === "\u7537";
  return <Figure chart={male ? ANATOMY.face.male : ANATOMY.face.female} selected={selected} onToggle={onToggle} />;
}

export function LimbZoom({
  face,
  selected,
  onToggle,
}: {
  face: "front" | "back";
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [limb, setLimb] = useState<"hand" | "foot">("hand");
  const [side, setSide] = useState<"right" | "left">("right");
  const hand = ANATOMY.hands[side];
  const foot = ANATOMY.feet[side];
  const views: [string, Chart][] =
    limb === "hand"
      ? face === "back"
        ? [
            ["\u624b\u80cc\u9762", hand.dorsal],
            ["\u624b\u638c\u9762", hand.palmar],
          ]
        : [
            ["\u624b\u638c\u9762", hand.palmar],
            ["\u624b\u80cc\u9762", hand.dorsal],
          ]
      : [
            ["\u8173\u80cc", foot.dorsal],
            ["\u8173\u638c", foot.plantar],
          ];
  const sideName = limb === "hand" ? { right: "\u53f3\u624b", left: "\u5de6\u624b" } : { right: "\u53f3\u8173", left: "\u5de6\u8173" };
  const tab = (on: boolean) =>
    `rounded-xl border-4 border-[#2060A0] py-2 text-xl font-bold ${on ? "bg-[#2060A0] text-white" : "bg-white text-black"}`;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="grid shrink-0 grid-cols-2 gap-1">
        <button type="button" className={tab(limb === "hand")} onClick={() => setLimb("hand")}>{"\u624b"}</button>
        <button type="button" className={tab(limb === "foot")} onClick={() => setLimb("foot")}>{"\u8173"}</button>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-1">
        <button type="button" className={tab(side === "right")} onClick={() => setSide("right")}>{sideName.right}</button>
        <button type="button" className={tab(side === "left")} onClick={() => setSide("left")}>{sideName.left}</button>
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
