/**
 * Read a provider's JSON answer without holding more than `maxBytes` of it.
 * A declared or streamed size over the bound, a missing body, invalid UTF-8,
 * or invalid JSON throws; the body is cancelled on the way out.
 */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes) || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Response is too large or empty.");
  }
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Response is too large.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}
