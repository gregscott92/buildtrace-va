from pathlib import Path
import shutil
import sys

file = Path.home() / "BuildTrace" / "views" / "dashboard.html"
backup = file.with_name("dashboard.before_add_credentials_include.bak.html")

if not file.exists():
    print("ERROR: dashboard.html not found")
    sys.exit(1)

shutil.copy2(file, backup)

text = file.read_text(encoding="utf-8")
original = text

# SIMPLE replace (safer than exact block matching)
text = text.replace(
    'fetch("/claims", {',
    'fetch("/claims", {\n          credentials: "include",'
)

text = text.replace(
    'fetch("/va/analyze-base64", {',
    'fetch("/va/analyze-base64", {\n          credentials: "include",'
)

if text == original:
    print("Nothing changed — already patched?")
    print("Backup:", backup)
    sys.exit(0)

file.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", file)
