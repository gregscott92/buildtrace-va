from pathlib import Path
from datetime import datetime
import shutil
import sys

files = [
    Path("views/dashboard.html"),
    Path("public/dashboard.html"),
]

upsell_block = """
        const upsellHtml = `
          <div class="mini-card" style="margin-top:18px; background:#081d4f; border:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:18px;font-weight:800;margin-bottom:8px;">Want a deeper claim review?</div>
            <div class="muted" style="margin-bottom:12px;">
              Get a tighter read using your actual records, evidence gaps, and stronger next-step guidance.
            </div>

            <ul style="margin-top:8px; margin-bottom:14px; padding-left:20px;">
              <li>Stronger estimate using more detail</li>
              <li>Help spotting missing evidence</li>
              <li>Clearer next steps before filing</li>
            </ul>

            <button
              type="button"
              class="btn-access"
              style="margin-top:6px;"
              onclick="window.location.href='mailto:greg.scott92@icloud.com?subject=VA%20Claim%20Full%20Review%20Request'"
            >
              Request Full Review
            </button>
          </div>
        `;
"""

needle = 'el.innerHTML = `'
insert_after = 'el.innerHTML = `'

for file in files:
    if not file.exists():
        print(f"Skipping missing file: {file}")
        continue

    text = file.read_text(encoding="utf-8")

    if "Want a deeper claim review?" in text:
        print(f"Upsell already present in: {file}")
        continue

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = file.with_name(f"{file.stem}.light_upsell_backup_{stamp}{file.suffix}")
    shutil.copy2(file, backup)
    print(f"Backup created: {backup}")

    # safest placement: define upsellHtml right before the render block
    if insert_after not in text:
        print(f"Could not find render block in: {file}")
        continue

    render_start = text.find(insert_after)
    text = text[:render_start] + upsell_block + "\n" + text[render_start:]

    # append upsell block before the closing template literal if save card exists
    save_marker = '<div style="font-weight:700; margin-bottom:6px;">Save this estimate</div>'
    if save_marker in text:
        idx = text.find(save_marker)
        card_start = text.rfind('<div class="mini-card"', 0, idx)
        if card_start != -1:
            text = text[:card_start] + '${upsellHtml}\n\n          ' + text[card_start:]
            file.write_text(text, encoding="utf-8")
            print(f"Inserted upsell into: {file}")
            continue

    # fallback: place before end of template
    end_template = text.find('`;', render_start)
    if end_template == -1:
        print(f"Could not find end of template in: {file}")
        continue

    text = text[:end_template] + '\n\n          ${upsellHtml}' + text[end_template:]
    file.write_text(text, encoding="utf-8")
    print(f"Inserted upsell using fallback in: {file}")

print("Done.")
