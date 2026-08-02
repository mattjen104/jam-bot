import { configureImageExtractor, IMAGE_OCR_PROMPT } from "./image-llm.js";

/**
 * Lazy provider wiring: an unavailable managed AI integration must not prevent
 * the API server from booting or serving the rest of Lore.
 */
let wired = false;

export async function wireImageExtractor(): Promise<boolean> {
  if (wired) return true;
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    configureImageExtractor(async ({ data, mediaType }) => {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: IMAGE_OCR_PROMPT },
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
          ],
        }],
      });
      const block = message.content[0];
      return block?.type === "text" ? block.text : "[]";
    });
    wired = true;
    return true;
  } catch (err) {
    console.warn("[image-ocr] Anthropic AI integration unavailable", err);
    return false;
  }
}