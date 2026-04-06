from pathlib import Path

file = Path("server.js")
code = file.read_text()

# --- 1. Add multi-image variables ---
code = code.replace(
    'const imageBase64 = String(req.body?.imageBase64 || "").trim();',
    '''const imageBase64 = String(req.body?.imageBase64 || "").trim();
const imageBase64List = Array.isArray(req.body?.imageBase64List)
  ? req.body.imageBase64List.map(x => String(x || "").trim()).filter(Boolean)
  : [];

const allImages = [
  ...(imageBase64 ? [imageBase64] : []),
  ...imageBase64List,
];'''
)

# --- 2. Replace missing input check ---
code = code.replace(
    '!issue && !serviceContext && !imageBase64',
    '!issue && !serviceContext && allImages.length === 0'
)

# --- 3. Replace OCR block ---
code = code.replace(
    'let visionExtract = "";',
    '''let visionExtract = "";

if (allImages.length > 0 && typeof extractVisionTextFromBase64 === "function") {
  const extractedPages = [];

  for (let i = 0; i < allImages.length; i++) {
    try {
      const pageText = String(
        (await extractVisionTextFromBase64(allImages[i])) || ""
      ).trim();

      if (pageText) {
        extractedPages.push(`Page ${i + 1}:\\n${pageText}`);
      }
    } catch (visionErr) {
      console.log(`BASE64 OCR ERROR PAGE ${i + 1}:`, visionErr.message);
    }
  }

  visionExtract = extractedPages.join("\\n\\n");
}'''
)

# --- 4. Replace source_type ---
code = code.replace(
    'source_type: imageBase64 ? "image_upload" : "text_only"',
    'source_type: allImages.length > 0 ? "image_upload" : "text_only"'
)

file.write_text(code)
print("✅ server.js patched successfully")
