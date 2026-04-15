from pathlib import Path
from datetime import datetime
import shutil
import re
import sys

server_file = Path("server.js")

if not server_file.exists():
    print("ERROR: server.js not found in current folder.")
    sys.exit(1)

text = server_file.read_text(encoding="utf-8")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = server_file.with_name(f"{server_file.stem}.public_route_backup_{stamp}{server_file.suffix}")
shutil.copy2(server_file, backup)
print(f"Backup created: {backup}")

route_to_add = '"/api/stripe/verify-session"'

if route_to_add in text:
    print("Stripe verify route is already in publicRoutes. Nothing to change.")
    sys.exit(0)

# Try to find an existing publicRoutes array
pattern = re.compile(
    r'(const\s+publicRoutes\s*=\s*\[)(.*?)(\];)',
    re.DOTALL
)

match = pattern.search(text)

if match:
    before = match.group(1)
    body = match.group(2)
    after = match.group(3)

    new_body = body.rstrip()

    # keep formatting simple
    if new_body and not new_body.strip().endswith(","):
        new_body = new_body + ","

    new_body = new_body + f'\n    {route_to_add}\n  '

    updated_block = before + new_body + after
    text = text[:match.start()] + updated_block + text[match.end():]

    server_file.write_text(text, encoding="utf-8")
    print("Added /api/stripe/verify-session to existing publicRoutes array.")
    sys.exit(0)

# Fallback: try to inject a publicRoutes array near auth middleware
middleware_pattern = re.compile(
    r'app\.use\s*\(\s*async\s*\(req,\s*res,\s*next\)\s*=>\s*\{',
    re.DOTALL
)

mw = middleware_pattern.search(text)

if mw:
    insert_at = mw.end()
    injection = """

  const publicRoutes = [
    "/signup",
    "/login",
    "/health",
    "/api/stripe/verify-session"
  ];

  if (publicRoutes.includes(req.path)) {
    return next();
  }
"""
    text = text[:insert_at] + injection + text[insert_at:]
    server_file.write_text(text, encoding="utf-8")
    print("Inserted publicRoutes block into auth middleware.")
    sys.exit(0)

print("ERROR: Could not find publicRoutes array or auth middleware automatically.")
print("Run this to inspect:")
print('grep -n -C 20 "publicRoutes\\|app.use(async (req, res, next)" server.js')
sys.exit(1)
