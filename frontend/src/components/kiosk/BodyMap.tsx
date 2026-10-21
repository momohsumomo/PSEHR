import { useState, type ReactNode } from "react";

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

const SKIN = "#F6E7D8";
const LINE = "#C4A88C";
const DASH = "#174E78";

type Ellipse = { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number };
type Rect = { kind: "rect"; x: number; y: number; w: number; h: number; rx: number };
type Shape = Ellipse | Rect;
type Piece = { id: string; shape: Shape; side: "l" | "r" };

function center(shape: Shape): { x: number; y: number } {
  if (shape.kind === "ellipse") return { x: shape.cx, y: shape.cy };
  return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
}

function Hit({
  shape,
  onClick,
}: {
  shape: Shape;
  onClick: () => void;
}) {
  const common = {
    fill: "transparent",
    stroke: "transparent",
    style: { cursor: "pointer" } as const,
    onClick,
  };
  if (shape.kind === "ellipse") {
    return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />;
  }
  return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...common} />;
}

function Dash({ shape }: { shape: Shape }) {
  const mark = {
    fill: "none",
    stroke: DASH,
    strokeWidth: 2.4,
    strokeDasharray: "7 5",
    style: { pointerEvents: "none" } as const,
  };
  if (shape.kind === "ellipse") {
    return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...mark} />;
  }
  return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...mark} />;
}

function Draw({
  shape,
  on,
  onClick,
}: {
  shape: Shape;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <g>
      {shape.kind === "ellipse" ? (
        <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={SKIN} stroke={LINE} strokeWidth={1.6} style={{ cursor: "pointer" }} onClick={onClick} />
      ) : (
        <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} fill={SKIN} stroke={LINE} strokeWidth={1.6} style={{ cursor: "pointer" }} onClick={onClick} />
      )}
      {on ? <Dash shape={shape} /> : null}
    </g>
  );
}

type Box = { x: number; y: number; w: number; h: number };

function spread(pieces: Piece[], box: Box) {
  const rows = [...pieces].sort((a, b) => center(a.shape).y - center(b.shape).y);
  let last = -100;
  return rows.map((piece) => {
    const at = center(piece.shape);
    let top = ((at.y - box.y) / box.h) * 100;
    if (top < last + 5.5) top = last + 5.5;
    if (top > 97) top = 97;
    last = top;
    return { piece, at, top, edgeY: box.y + (top / 100) * box.h };
  });
}

function Marked({
  box,
  pieces,
  active,
  children,
}: {
  box: Box;
  pieces: Piece[];
  active: (id: string) => boolean;
  children: ReactNode;
}) {
  const picked = pieces.filter((piece) => active(piece.id));
  const left = spread(picked.filter((piece) => piece.side === "l"), box);
  const right = spread(picked.filter((piece) => piece.side === "r"), box);
  const label = (row: { piece: Piece; top: number }, align: "start" | "end") => (
    <span
      key={row.piece.id}
      className={`absolute whitespace-nowrap text-base font-bold text-[#102030] ${align === "end" ? "right-full mr-1" : "left-full ml-1"}`}
      style={{ top: `${row.top}%`, transform: "translateY(-50%)" }}
    >
      {SITE_LABEL[row.piece.id] || row.piece.id}
    </span>
  );
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center">
      <div className="relative h-full max-w-full" style={{ aspectRatio: `${box.w} / ${box.h}` }}>
        <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-full w-full">
          {children}
          <g style={{ pointerEvents: "none" }}>
            {left.map((row) => (
              <line key={row.piece.id} x1={row.at.x} y1={row.at.y} x2={box.x} y2={row.edgeY} stroke={DASH} strokeWidth={1.5} />
            ))}
            {right.map((row) => (
              <line key={row.piece.id} x1={row.at.x} y1={row.at.y} x2={box.x + box.w} y2={row.edgeY} stroke={DASH} strokeWidth={1.5} />
            ))}
          </g>
        </svg>
        {left.map((row) => label(row, "end"))}
        {right.map((row) => label(row, "start"))}
      </div>
    </div>
  );
}

const ell = (cx: number, cy: number, rx: number, ry: number): Ellipse => ({ kind: "ellipse", cx, cy, rx, ry });
const box = (x: number, y: number, w: number, h: number, rx: number): Rect => ({ kind: "rect", x, y, w, h, rx });

const BODY: Array<{ front: string; back: string; shape: Shape; backShape?: Shape; side: "l" | "r" }> = [
  { front: "scalp", back: "occiput", shape: ell(180, 42, 34, 22), backShape: ell(180, 64, 36, 46), side: "l" },
  { front: "ear-r", back: "ear-r-back", shape: ell(140, 76, 9, 13), side: "l" },
  { front: "ear-l", back: "ear-l-back", shape: ell(220, 76, 9, 13), side: "r" },
  { front: "neck", back: "nape", shape: box(164, 108, 32, 22, 8), side: "l" },
  { front: "chest-r", back: "back-upper-r", shape: box(128, 134, 50, 64, 16), side: "l" },
  { front: "chest-l", back: "back-upper-l", shape: box(182, 134, 50, 64, 16), side: "r" },
  { front: "abdomen-r", back: "back-lower-r", shape: box(132, 202, 46, 58, 12), side: "l" },
  { front: "abdomen-l", back: "back-lower-l", shape: box(182, 202, 46, 58, 12), side: "r" },
  { front: "groin-r", back: "buttock-r", shape: box(138, 264, 38, 40, 12), side: "l" },
  { front: "groin-l", back: "buttock-l", shape: box(184, 264, 38, 40, 12), side: "r" },
  { front: "arm-r", back: "arm-r-back", shape: box(72, 136, 50, 62, 22), side: "l" },
  { front: "forearm-r", back: "forearm-r-back", shape: box(64, 202, 44, 68, 20), side: "l" },
  { front: "hand-r", back: "hand-r-back", shape: ell(82, 286, 20, 16), side: "l" },
  { front: "arm-l", back: "arm-l-back", shape: box(238, 136, 50, 62, 22), side: "r" },
  { front: "forearm-l", back: "forearm-l-back", shape: box(252, 202, 44, 68, 20), side: "r" },
  { front: "hand-l", back: "hand-l-back", shape: ell(278, 286, 20, 16), side: "r" },
  { front: "thigh-r", back: "thigh-r-back", shape: box(124, 310, 44, 86, 20), side: "l" },
  { front: "thigh-l", back: "thigh-l-back", shape: box(192, 310, 44, 86, 20), side: "r" },
  { front: "knee-r", back: "knee-r-back", shape: ell(146, 408, 20, 14), side: "l" },
  { front: "knee-l", back: "knee-l-back", shape: ell(214, 408, 20, 14), side: "r" },
  { front: "shin-r", back: "calf-r", shape: box(132, 424, 30, 96, 14), side: "l" },
  { front: "shin-l", back: "calf-l", shape: box(198, 424, 30, 96, 14), side: "r" },
  { front: "foot-r", back: "foot-r-back", shape: ell(140, 536, 28, 14), side: "l" },
  { front: "foot-l", back: "foot-l-back", shape: ell(214, 536, 28, 14), side: "r" },
];

type MapProps = {
  face: "front" | "back";
  selected: string[];
  onToggle: (id: string) => void;
};

export function BodyMap({ face, selected, onToggle }: MapProps) {
  const back = face === "back";
  const pieces: Piece[] = BODY.flatMap((part) => {
    const id = back ? part.back : part.front;
    if (!id) return [];
    return [{ id, shape: back && part.backShape ? part.backShape : part.shape, side: part.side }];
  });
  const on = (id: string) => selected.includes(id);
  return (
    <Marked box={{ x: 48, y: 8, w: 264, h: 560 }} pieces={pieces} active={on}>
      {!back ? (
        <ellipse cx={180} cy={78} rx={32} ry={28} fill={SKIN} stroke={LINE} strokeWidth={1.6} style={{ pointerEvents: "none" }} />
      ) : null}
      {pieces.map((piece) => (
        <Draw key={piece.id} shape={piece.shape} on={on(piece.id)} onClick={() => onToggle(piece.id)} />
      ))}
    </Marked>
  );
}

const FACE: Piece[] = [
  { id: "forehead-r", side: "l", shape: ell(112, 108, 40, 30) },
  { id: "forehead-l", side: "r", shape: ell(188, 108, 40, 30) },
  { id: "temple-r", side: "l", shape: ell(62, 168, 22, 28) },
  { id: "temple-l", side: "r", shape: ell(238, 168, 22, 28) },
  { id: "face-r", side: "l", shape: ell(92, 214, 30, 28) },
  { id: "face-l", side: "r", shape: ell(208, 214, 30, 28) },
  { id: "jaw-r", side: "l", shape: ell(98, 262, 28, 20) },
  { id: "jaw-l", side: "r", shape: ell(202, 262, 28, 20) },
  { id: "eyelid-r", side: "l", shape: ell(112, 168, 26, 13) },
  { id: "eyelid-l", side: "r", shape: ell(188, 168, 26, 13) },
  { id: "undereye-r", side: "l", shape: ell(112, 192, 24, 11) },
  { id: "undereye-l", side: "r", shape: ell(188, 192, 24, 11) },
  { id: "glabella", side: "r", shape: ell(150, 142, 16, 12) },
  { id: "nose", side: "r", shape: ell(150, 202, 14, 26) },
  { id: "lip", side: "l", shape: ell(150, 242, 30, 12) },
  { id: "chin", side: "r", shape: ell(150, 292, 22, 16) },
];

type ZoomProps = {
  selected: string[];
  onToggle: (id: string) => void;
};

export function FaceZoom({ selected, onToggle }: ZoomProps) {
  const on = (id: string) => selected.includes(id);
  return (
    <Marked box={{ x: 28, y: 28, w: 244, h: 320 }} pieces={FACE} active={on}>
      <ellipse cx={150} cy={185} rx={108} ry={145} fill="#F3D7C4" stroke={LINE} strokeWidth={2} style={{ pointerEvents: "none" }} />
      {FACE.map((piece) => (
        <Hit key={piece.id} shape={piece.shape} onClick={() => onToggle(piece.id)} />
      ))}
      <g fill="none" stroke="#8D6B52" strokeWidth={2.2} strokeLinecap="round" style={{ pointerEvents: "none" }}>
        <path d="M86 150 Q112 136 138 152" />
        <path d="M162 152 Q188 136 214 150" />
        <path d="M92 168 Q112 160 132 168 Q112 178 92 168" />
        <path d="M168 168 Q188 160 208 168 Q188 178 168 168" />
        <path d="M150 166 L144 214 Q150 222 156 214 Z" />
        <path d="M124 240 Q150 232 176 240" />
        <path d="M128 246 Q150 258 172 246" />
      </g>
      {FACE.filter((piece) => on(piece.id)).map((piece) => (
        <Dash key={`d-${piece.id}`} shape={piece.shape} />
      ))}
    </Marked>
  );
}

type Finger = { name: "thumb" | "index" | "middle" | "ring" | "little"; d: string; nail: Ellipse };

const FINGERS: Finger[] = [
  { name: "thumb", d: "M74 175 C50 162 26 134 20 106 C14 82 34 68 48 82 C66 98 84 142 90 176 Z", nail: ell(32, 98, 8, 5) },
  { name: "index", d: "M78 188 C74 140 70 72 78 40 C84 22 104 20 110 38 C118 70 114 142 106 188 Z", nail: ell(94, 32, 9, 6) },
  { name: "middle", d: "M102 186 C100 128 96 52 106 20 C114 4 136 4 142 22 C150 54 146 132 138 186 Z", nail: ell(124, 14, 10, 6) },
  { name: "ring", d: "M134 188 C138 136 144 64 154 36 C162 18 182 20 186 38 C192 70 184 140 172 188 Z", nail: ell(170, 30, 9, 6) },
  { name: "little", d: "M166 190 C174 156 184 118 194 96 C204 76 220 80 218 98 C214 128 198 168 184 192 Z", nail: ell(206, 90, 8, 5) },
];

const PALM = "M72 168 C64 180 58 210 68 238 C80 266 108 278 132 276 C158 274 180 254 184 226 C188 196 178 172 164 164 L78 164 C76 164 74 166 72 168 Z";
const HAND_MIRROR = 230;
const HAND_BOX: Box = { x: 0, y: 0, w: 230, h: 310 };

export function HandsZoom({
  face,
  selected,
  onToggle,
}: {
  face: "front" | "back";
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [side, setSide] = useState<"r" | "l">("r");
  const palmId = face === "back" ? `hand-${side}-back` : `hand-${side}`;
  const mirror = side === "l";
  const xOf = (x: number) => (mirror ? HAND_MIRROR - x : x);
  const pieces: Piece[] = [
    { id: palmId, side: "l", shape: ell(xOf(126), 220, 8, 8) },
    ...FINGERS.map((finger) => ({
      id: `finger-${side}-${finger.name}`,
      side: "l" as const,
      shape: ell(xOf(finger.nail.cx), finger.nail.cy, 4, 4),
    })),
    { id: `nail-${side}`, side: "l", shape: ell(xOf(124), 14, 4, 4) },
  ];
  const tab = (on: boolean) =>
    `rounded-xl border-4 border-[#2060A0] py-2 text-xl font-bold ${on ? "bg-[#2060A0] text-white" : "bg-white text-black"}`;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="grid shrink-0 grid-cols-2 gap-1">
        <button type="button" className={tab(side === "r")} onClick={() => setSide("r")}>{"\u53f3\u624b"}</button>
        <button type="button" className={tab(side === "l")} onClick={() => setSide("l")}>{"\u5de6\u624b"}</button>
      </div>
      <div className="min-h-0 flex-1">
        <Marked box={HAND_BOX} pieces={pieces} active={(id) => selected.includes(id)}>
          <g transform={mirror ? `translate(${HAND_MIRROR} 0) scale(-1 1)` : undefined}>
            {FINGERS.map((finger) => {
              const id = `finger-${side}-${finger.name}`;
              const on = selected.includes(id);
              return (
                <g key={id}>
                  <path d={finger.d} fill={SKIN} stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" style={{ cursor: "pointer" }} onClick={() => onToggle(id)} />
                  {on ? <path d={finger.d} fill="none" stroke={DASH} strokeWidth={2.4} strokeDasharray="7 5" style={{ pointerEvents: "none" }} /> : null}
                </g>
              );
            })}
            <path d={PALM} fill={SKIN} stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" style={{ cursor: "pointer" }} onClick={() => onToggle(palmId)} />
            {selected.includes(palmId) ? <path d={PALM} fill="none" stroke={DASH} strokeWidth={2.4} strokeDasharray="7 5" style={{ pointerEvents: "none" }} /> : null}
            <g fill="none" stroke={LINE} strokeWidth={1.2} strokeLinecap="round" style={{ pointerEvents: "none" }}>
              <path d="M96 176 C110 184 128 184 146 174" />
              <path d="M90 200 C112 210 140 208 160 196" />
            </g>
            {FINGERS.map((finger) => (
              <ellipse
                key={`nail-${finger.name}`}
                cx={finger.nail.cx}
                cy={finger.nail.cy}
                rx={finger.nail.rx}
                ry={finger.nail.ry}
                fill="#F8F1EA"
                stroke={selected.includes(`nail-${side}`) ? DASH : LINE}
                strokeWidth={selected.includes(`nail-${side}`) ? 2.4 : 1.3}
                strokeDasharray={selected.includes(`nail-${side}`) ? "4 3" : undefined}
                style={{ cursor: "pointer" }}
                onClick={() => onToggle(`nail-${side}`)}
              />
            ))}
          </g>
        </Marked>
      </div>
    </div>
  );
}
