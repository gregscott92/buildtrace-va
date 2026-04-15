from pathlib import Path
import re
from datetime import datetime

f = Path("server.js")
code = f.read_text()

# Backup
stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = Path(f"server_backup_{stamp}.js")
backup.write_text(code)
print("Backup:", backup)

# Replace FIRST app.get("/") only
pattern = re.compile(r'app\.get\(\s*["\']/["\']\s*,.*?{.*?}\s*\);', re.DOTALL)

match = pattern.search(code)

if not match:
    print("No root route found")
    exit()

new = """app.get("/", (req, res) => {
  return res.redirect("/dashboard");
});"""

updated = code[:match.start()] + new + code[match.end():]

f.write_text(updated)

print("Done: root now redirects to /dashboard")
