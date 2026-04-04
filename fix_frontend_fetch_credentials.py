from pathlib import Path
import shutil
import sys

file = Path.home() / "BuildTrace" / "public" / "dashboard.html"
backup = file.with_name("dashboard.before_credentials_fix.bak.html")

if not file.exists():
    print("ERROR: dashboard.html not found")
    sys.exit(1)

shutil.copy2(file, backup)
text = file.read_text(encoding="utf-8")

# add credentials: include to all fetch calls
text = text.replace(
    'fetch(',
    'fetch('
)

# safe targeted replace
text = text.replace(
    'headers: { "Content-Type": "application/json" },',
    'headers: { "Content-Type": "application/json" },\n        credentials: "include",'
)

file.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", file)
print("")
print("Now run:")
print("git add public/dashboard.html")
print('git commit -m "send cookies with requests"')
print("git push")
