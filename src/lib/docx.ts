import mammoth from "mammoth";

export async function extractDocxText(buffer: Buffer): Promise<string | null> {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim() ? value : null;
  } catch {
    return null;
  }
}
