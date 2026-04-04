from pathlib import Path
import shutil
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_base64_claim_save_fix.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

shutil.copy2(server, backup)
text = server.read_text(encoding="utf-8")

if 'SAVE CLAIM ERROR BASE64' in text:
    print("Base64 save block already exists. Nothing changed.")
    print("Backup:", backup)
    sys.exit(0)

anchor = """    const structured = {
      condition: readSection("Condition"),
      diagnosticCode: readSection("Diagnostic Code"),
      estimatedRating: readSection("Estimated VA Rating"),
      confidence: readSection("Confidence"),
      reasoning: readSection("Reasoning"),
      evidenceNeeded: readSection("Evidence Still Needed"),
      nextSteps: readSection("Next Steps"),
      important: readSection("Important")
    };"""

insert = """    const structured = {
      condition: readSection("Condition"),
      diagnosticCode: readSection("Diagnostic Code"),
      estimatedRating: readSection("Estimated VA Rating"),
      confidence: readSection("Confidence"),
      reasoning: readSection("Reasoning"),
      evidenceNeeded: readSection("Evidence Still Needed"),
      nextSteps: readSection("Next Steps"),
      important: readSection("Important")
    };

    try {
      await supabase.from("va_claims").insert({
        user_id: req.apiUser.id,
        input_text: JSON.stringify({
          issue,
          serviceContext
        }),
        result_text: result || "",
        extracted_text: visionExtract || "",
        detected_condition: structured.condition !== "N/A" ? structured.condition : null,
        estimated_rating:
          structured.estimatedRating && structured.estimatedRating !== "N/A"
            ? parseInt(String(structured.estimatedRating).replace(/[^0-9]/g, ""), 10) || null
            : null,
        confidence_label: structured.confidence !== "N/A" ? structured.confidence : null,
        source_type: normalizedImageBase64 ? "image_upload" : "text_only",
        export_summary: result || ""
      });
    } catch (saveErr) {
      console.log("SAVE CLAIM ERROR BASE64:", saveErr?.message || saveErr);
    }"""

if anchor not in text:
    print("ERROR: structured anchor not found")
    print("Backup:", backup)
    sys.exit(1)

text = text.replace(anchor, insert, 1)
server.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", server)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "save va claims from base64 route"')
print("git push")
