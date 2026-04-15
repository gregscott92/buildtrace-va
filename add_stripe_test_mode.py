from pathlib import Path
from datetime import datetime
import shutil

server_file = Path("server.js")

text = server_file.read_text(encoding="utf-8")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = server_file.with_name(f"{server_file.stem}.testmode_backup_{stamp}.js")
shutil.copy2(server_file, backup)

old = 'const { session_id } = req.query || {};'

if old not in text:
    print("Could not find session_id line")
    exit()

new = '''const { session_id, test } = req.query || {};

// TEMP TEST MODE (remove later)
if (test === "true") {
  return res.json({
    ok: true,
    unlocked: true,
    test: true
  });
}
'''

text = text.replace(old, new, 1)

server_file.write_text(text, encoding="utf-8")

print("Test mode added.")
