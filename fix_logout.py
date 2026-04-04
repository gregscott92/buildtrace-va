from pathlib import Path
import re
import shutil
import sys

server_path = Path.home() / "BuildTrace" / "server.js"

if not server_path.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

backup_path = server_path.with_name("server.logout_fix.bak.js")
shutil.copy(server_path, backup_path)

text = server_path.read_text(encoding="utf-8")

# -----------------------------
# FIND logout route
# -----------------------------
pattern = r'app\.post\("/logout",[\s\S]*?\}\);'

new_logout = '''app.post("/logout", (req, res) => {
  clearAccessTokenCookie(res);
  return res.redirect("/login");
});'''

if not re.search(pattern, text):
    print("ERROR: logout route not found")
    print("Backup:", backup_path)
    sys.exit(1)

# -----------------------------
# REPLACE
# -----------------------------
updated = re.sub(pattern, new_logout, text, count=1)

if updated == text:
    print("Nothing changed")
    print("Backup:", backup_path)
    sys.exit(0)

server_path.write_text(updated, encoding="utf-8")

print("DONE")
print("Backup:", backup_path)
print("Updated:", server_path)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "fix logout route"')
print("git push")
