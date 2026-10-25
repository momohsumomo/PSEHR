/** XML 1.0 forbids these. A card name can carry a trailing null. */
export function plainText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}
