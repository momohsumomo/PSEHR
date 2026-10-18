import type { ReactNode } from "react";

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
};

const ON = "rgba(47,111,168,0.42)";

type Frame = { x: number; y: number; w: number; h: number; view: string };
type Part = { id: string; fx: number; fy: number; fw: number; fh: number };

const SHEET_W = 446.4267;
const SHEET_H = 917.72388;

function OneFigure({ view, children }: { view: string; children: ReactNode }) {
  const [x, y, w, h] = view.split(" ").map(Number);
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative h-full max-h-full max-w-full overflow-hidden" style={{ aspectRatio: `${w} / ${h}` }}>
        <img
          src="/body-mf.svg"
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{
            width: `${(SHEET_W / w) * 100}%`,
            height: `${(SHEET_H / h) * 100}%`,
            left: `${(-x / w) * 100}%`,
            top: `${(-y / h) * 100}%`,
          }}
        />
        <svg viewBox={view} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {children}
        </svg>
      </div>
    </div>
  );
}

const FRAMES: Record<"F" | "M", Record<"front" | "back", Frame>> = {
  F: {
    front: { x: 8, y: 32, w: 180, h: 400, view: "0 24 200 420" },
    back: { x: 6, y: 508, w: 180, h: 400, view: "-2 498 196 424" },
  },
  M: {
    front: { x: 272, y: 24, w: 164, h: 408, view: "258 16 192 428" },
    back: { x: 274, y: 490, w: 162, h: 418, view: "262 480 186 440" },
  },
};

const FACE_VIEW: Record<"F" | "M", string> = {
  F: "64 32 76 74",
  M: "320 18 72 72",
};

const PARTS: Part[] = [
  { id: "scalp", fx: 0.34, fy: 0.0, fw: 0.32, fh: 0.06 },
  { id: "face", fx: 0.34, fy: 0.055, fw: 0.32, fh: 0.09 },
  { id: "ear-r", fx: 0.28, fy: 0.06, fw: 0.08, fh: 0.05 },
  { id: "ear-l", fx: 0.64, fy: 0.06, fw: 0.08, fh: 0.05 },
  { id: "neck", fx: 0.42, fy: 0.15, fw: 0.16, fh: 0.04 },
  { id: "chest-r", fx: 0.36, fy: 0.2, fw: 0.14, fh: 0.1 },
  { id: "chest-l", fx: 0.5, fy: 0.2, fw: 0.14, fh: 0.1 },
  { id: "abdomen-r", fx: 0.37, fy: 0.31, fw: 0.13, fh: 0.1 },
  { id: "abdomen-l", fx: 0.5, fy: 0.31, fw: 0.13, fh: 0.1 },
  { id: "groin-r", fx: 0.41, fy: 0.42, fw: 0.09, fh: 0.07 },
  { id: "groin-l", fx: 0.5, fy: 0.42, fw: 0.09, fh: 0.07 },
  { id: "arm-r", fx: 0.16, fy: 0.19, fw: 0.16, fh: 0.12 },
  { id: "forearm-r", fx: 0.06, fy: 0.31, fw: 0.15, fh: 0.11 },
  { id: "hand-r", fx: 0.0, fy: 0.41, fw: 0.2, fh: 0.1 },
  { id: "arm-l", fx: 0.68, fy: 0.19, fw: 0.16, fh: 0.12 },
  { id: "forearm-l", fx: 0.79, fy: 0.31, fw: 0.15, fh: 0.11 },
  { id: "hand-l", fx: 0.8, fy: 0.41, fw: 0.2, fh: 0.1 },
  { id: "thigh-r", fx: 0.3, fy: 0.5, fw: 0.16, fh: 0.13 },
  { id: "thigh-l", fx: 0.54, fy: 0.5, fw: 0.16, fh: 0.13 },
  { id: "knee-r", fx: 0.31, fy: 0.63, fw: 0.14, fh: 0.07 },
  { id: "knee-l", fx: 0.55, fy: 0.63, fw: 0.14, fh: 0.07 },
  { id: "shin-r", fx: 0.33, fy: 0.7, fw: 0.11, fh: 0.16 },
  { id: "shin-l", fx: 0.56, fy: 0.7, fw: 0.11, fh: 0.16 },
  { id: "foot-r", fx: 0.28, fy: 0.88, fw: 0.16, fh: 0.09 },
  { id: "foot-l", fx: 0.56, fy: 0.88, fw: 0.16, fh: 0.09 },
];

const BACK_ID: Record<string, string> = {
  scalp: "occiput",
  neck: "nape",
  "ear-r": "ear-r-back",
  "ear-l": "ear-l-back",
  "chest-r": "back-upper-r",
  "chest-l": "back-upper-l",
  "abdomen-r": "back-lower-r",
  "abdomen-l": "back-lower-l",
  "groin-r": "buttock-r",
  "groin-l": "buttock-l",
  "arm-r": "arm-r-back",
  "arm-l": "arm-l-back",
  "forearm-r": "forearm-r-back",
  "forearm-l": "forearm-l-back",
  "hand-r": "hand-r-back",
  "hand-l": "hand-l-back",
  "thigh-r": "thigh-r-back",
  "thigh-l": "thigh-l-back",
  "knee-r": "knee-r-back",
  "knee-l": "knee-l-back",
  "shin-r": "calf-r",
  "shin-l": "calf-l",
  "foot-r": "foot-r-back",
  "foot-l": "foot-l-back",
};

const FACE_PARTS: Array<Part & { label: string }> = [
  { id: "face-r", label: "\u53f3\u9830", fx: 0.04, fy: 0.46, fw: 0.32, fh: 0.2 },
  { id: "face-l", label: "\u5de6\u9830", fx: 0.64, fy: 0.46, fw: 0.32, fh: 0.2 },
  { id: "jaw-r", label: "\u4e0b\u984e", fx: 0.04, fy: 0.68, fw: 0.26, fh: 0.16 },
  { id: "jaw-l", label: "\u4e0b\u984e", fx: 0.7, fy: 0.68, fw: 0.26, fh: 0.16 },
  { id: "forehead-r", label: "\u984d", fx: 0.16, fy: 0.02, fw: 0.3, fh: 0.16 },
  { id: "forehead-l", label: "\u984d", fx: 0.54, fy: 0.02, fw: 0.3, fh: 0.16 },
  { id: "temple-r", label: "\u592a\u967d", fx: 0.0, fy: 0.16, fw: 0.18, fh: 0.16 },
  { id: "temple-l", label: "\u592a\u967d", fx: 0.82, fy: 0.16, fw: 0.18, fh: 0.16 },
  { id: "chin", label: "\u4e0b\u5df4", fx: 0.32, fy: 0.8, fw: 0.36, fh: 0.16 },
  { id: "eyelid-r", label: "\u773c\u76ae", fx: 0.12, fy: 0.26, fw: 0.26, fh: 0.1 },
  { id: "eyelid-l", label: "\u773c\u76ae", fx: 0.62, fy: 0.26, fw: 0.26, fh: 0.1 },
  { id: "undereye-r", label: "\u773c\u4e0b", fx: 0.12, fy: 0.37, fw: 0.26, fh: 0.09 },
  { id: "undereye-l", label: "\u773c\u4e0b", fx: 0.62, fy: 0.37, fw: 0.26, fh: 0.09 },
  { id: "nose", label: "\u9f3b", fx: 0.4, fy: 0.3, fw: 0.2, fh: 0.24 },
  { id: "lip", label: "\u5507", fx: 0.34, fy: 0.62, fw: 0.32, fh: 0.1 },
  { id: "glabella", label: "\u7709\u5fc3", fx: 0.38, fy: 0.18, fw: 0.24, fh: 0.1 },
];

function placed(frame: Frame, part: Part, back: boolean) {
  const fx = back ? 1 - part.fx - part.fw : part.fx;
  return {
    id: back ? BACK_ID[part.id] || "" : part.id,
    x: frame.x + fx * frame.w,
    y: frame.y + part.fy * frame.h,
    w: part.fw * frame.w,
    h: part.fh * frame.h,
  };
}

type MapProps = {
  face: "front" | "back";
  sex: "F" | "M";
  selected: string[];
  faceOpen?: boolean;
  onToggle: (id: string) => void;
};

export function BodyMap({ face, sex, selected, faceOpen, onToggle }: MapProps) {
  const back = face === "back";
  const frame = FRAMES[sex][face];
  const boxes = PARTS.map((part) => placed(frame, part, back)).filter((box) => box.id);
  return (
    <OneFigure view={frame.view}>
      {boxes.map((box) => {
        const on = box.id === "face" ? !!faceOpen : selected.includes(box.id);
        return (
          <rect
            key={box.id}
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx={6}
            fill={on ? ON : "transparent"}
            style={{ cursor: "pointer" }}
            onClick={() => onToggle(box.id)}
          />
        );
      })}
    </OneFigure>
  );
}

type ZoomProps = {
  sex: "F" | "M";
  selected: string[];
  onToggle: (id: string) => void;
};

export function FaceZoom({ sex, selected, onToggle }: ZoomProps) {
  const [vx, vy, vw, vh] = FACE_VIEW[sex].split(" ").map(Number);
  return (
    <OneFigure view={FACE_VIEW[sex]}>
      {FACE_PARTS.map((part) => {
        const on = selected.includes(part.id);
        const x = vx + part.fx * vw;
        const y = vy + part.fy * vh;
        const w = part.fw * vw;
        const h = part.fh * vh;
        return (
          <g key={part.id} style={{ cursor: "pointer" }} onClick={() => onToggle(part.id)}>
            <rect x={x} y={y} width={w} height={h} rx={3} fill={on ? "#174E78" : "transparent"} stroke={on ? "#174E78" : "transparent"} strokeWidth={0.8} />
            {on ? (
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(vw, vh) * 0.07} fill="#ffffff" style={{ pointerEvents: "none" }}>
                {part.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </OneFigure>
  );
}

const HAND_FINGERS: Array<{ name: string; x: number; y: number; w: number; h: number; label: string }> = [
  { name: "thumb", x: 2, y: 58, w: 24, h: 42, label: "\u62c7" },
  { name: "index", x: 30, y: 6, w: 15, h: 54, label: "\u98df" },
  { name: "middle", x: 47, y: 0, w: 15, h: 60, label: "\u4e2d" },
  { name: "ring", x: 64, y: 8, w: 15, h: 50, label: "\u7121" },
  { name: "little", x: 81, y: 18, w: 15, h: 40, label: "\u5c0f" },
];

function handFingers(side: "r" | "l") {
  if (side === "r") return HAND_FINGERS;
  return HAND_FINGERS.map((box) => ({ ...box, x: 100 - box.x - box.w }));
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
  return (
    <div className="grid h-full grid-cols-2 gap-1">
      {(["r", "l"] as const).map((side) => {
        const palmId = face === "back" ? `hand-${side}-back` : `hand-${side}`;
        const palmOn = selected.includes(palmId);
        const palm = side === "r" ? { x: 28, y: 64, w: 68, h: 78 } : { x: 4, y: 64, w: 68, h: 78 };
        return (
          <div key={side} className="flex min-h-0 flex-col">
            <p className="text-center text-base font-bold">{side === "r" ? "\u53f3\u624b" : "\u5de6\u624b"}</p>
            <svg viewBox="0 0 100 150" className="min-h-0 w-full flex-1">
              <rect
                x={palm.x}
                y={palm.y}
                width={palm.w}
                height={palm.h}
                rx={16}
                fill={palmOn ? "#174E78" : "#F6E6D4"}
                stroke={palmOn ? "#174E78" : "transparent"}
                strokeWidth={1.4}
                style={{ cursor: "pointer" }}
                onClick={() => onToggle(palmId)}
              />
              {palmOn ? (
                <text x={palm.x + palm.w / 2} y={palm.y + palm.h / 2} textAnchor="middle" fill="#ffffff" fontSize={12} style={{ pointerEvents: "none" }}>
                  {"\u624b\u638c"}
                </text>
              ) : null}
              {handFingers(side).map((box) => {
                const id = `finger-${side}-${box.name}`;
                const on = selected.includes(id);
                return (
                  <g key={id} style={{ cursor: "pointer" }} onClick={() => onToggle(id)}>
                    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={7} fill={on ? "#174E78" : "#F6E6D4"} stroke={on ? "#174E78" : "transparent"} strokeWidth={1.4} />
                    {on ? (
                      <text x={box.x + box.w / 2} y={box.y + box.h / 2} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={11} style={{ pointerEvents: "none" }}>
                        {box.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <button type="button" className={`rounded-xl border-2 border-[#2060A0] py-1 text-base font-bold ${selected.includes(`nail-${side}`) ? "kiosk-pick" : "bg-white text-black"}`} onClick={() => onToggle(`nail-${side}`)}>
              {"\u6307\u7532"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
