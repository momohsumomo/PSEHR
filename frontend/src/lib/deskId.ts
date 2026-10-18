/** Same rules as src/core/nhi_validators.screen_desk_id. */

const LETTER: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34,
  J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25,
  S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};

function nationalOk(text: string): boolean {
  const letter = LETTER[text[0]];
  if (letter == null) return false;
  const nums = [Math.floor(letter / 10), letter % 10, ...text.slice(1).split("").map(Number)];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  const total = nums.reduce((sum, n, i) => sum + n * weights[i], 0);
  return total % 10 === 0;
}

export function screenDeskId(raw: string): string {
  const text = raw.trim().toUpperCase().replace(/ /g, "");
  if (!text) return "";
  if (/^[A-Z][0-9]{9}$/.test(text)) {
    if (!nationalOk(text)) throw new Error("\u8eab\u5206\u8b49\u6aa2\u67e5\u78bc\u4e0d\u7b26");
    return text;
  }
  if (/^[A-Z0-9]{4,20}$/.test(text)) return text;
  throw new Error("\u8b49\u865f\u53ea\u80fd\u586b\u82f1\u6578\u3002\u6c92\u6709\u8b49\u865f\u7684\u81ea\u8cbb\u53ef\u4ee5\u7559\u7a7a\u3002");
}
