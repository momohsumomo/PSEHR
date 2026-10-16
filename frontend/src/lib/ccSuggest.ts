/** First phrase in count order that continues this fragment. */
export function ccSuffix(phrases: string[], fragment: string): string {
  const frag = fragment.trim();
  if (frag.length < 2) return "";
  const low = frag.toLowerCase();
  for (const text of phrases) {
    if (text.length > frag.length && text.toLowerCase().startsWith(low)) {
      return text.slice(frag.length);
    }
  }
  return "";
}
