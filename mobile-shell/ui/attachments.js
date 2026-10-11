// An attachment of the chat (#35): a photo, a PDF, a text file or a DOCX the
// person brings as their plan, turned into content parts of a message. A photo
// is scaled down to keep the thread and the Закладка small.

export const ATTACHMENT_ACCEPT = "image/*,application/pdf,text/plain,.txt,.md,.csv,.docx";
const MAX_SIDE = 1600;
const MAX_TEXT = 40_000;

function readAs(file, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader[method](file);
  });
}

async function scaledPhoto(file) {
  const url = await readAs(file, "readAsDataURL");
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Не удалось открыть изображение."));
    element.src = url;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

// The text of a DOCX: word/document.xml from the zip, paragraphs as lines.
async function docxText(file) {
  const bytes = new Uint8Array(await readAs(file, "readAsArrayBuffer"));
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Это не документ Word.");
  let offset = view.getUint32(end + 16, true);
  for (let index = view.getUint16(end + 10, true); index > 0; index -= 1) {
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const local = view.getUint32(offset + 42, true);
    if (name === "word/document.xml") {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      const raw = method === 8
        ? await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()
        : data;
      const xml = new TextDecoder().decode(raw);
      return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
        .replace(/\n{3,}/g, "\n\n").trim();
    }
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  throw new Error("В документе Word нет текста.");
}

function textPart(name, text) {
  const body = String(text || "").trim();
  if (!body) throw new Error("В файле нет текста.");
  return { type: "text", text: `Вложение «${name}»:\n${body.slice(0, MAX_TEXT)}` };
}

// { kind: "фото" | "документ" | "текст", name, parts } for the assistant.
export async function readAttachment(file) {
  const name = String(file?.name || "файл");
  const type = String(file?.type || "");
  if (type.startsWith("image/")) return { kind: "фото", name, parts: [{ type: "image_url", image_url: { url: await scaledPhoto(file) } }] };
  if (type === "application/pdf" || /\.pdf$/i.test(name)) {
    const url = String(await readAs(file, "readAsDataURL")).replace(/^data:[^;]*;/, "data:application/pdf;");
    return { kind: "документ", name, parts: [{ type: "file", file: { filename: name, file_data: url } }] };
  }
  if (/\.docx$/i.test(name)) return { kind: "документ", name, parts: [textPart(name, await docxText(file))] };
  if (type.startsWith("text/") || /\.(txt|md|csv)$/i.test(name)) return { kind: "текст", name, parts: [textPart(name, await readAs(file, "readAsText"))] };
  throw new Error("Можно приложить фото, PDF, документ Word или текстовый файл.");
}
