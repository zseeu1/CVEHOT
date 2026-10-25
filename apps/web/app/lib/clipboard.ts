/**
 * Copies text; in-app browsers without the async clipboard (WeChat and the like) fall back to a selection
 * copy. Rejects when neither copies.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const copied = document.execCommand("copy");
    ta.remove();
    if (!copied) throw new Error("copy failed");
  }
}
