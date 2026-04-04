from pathlib import Path
import shutil
import sys
import re

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_logout_clear_token.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

shutil.copy2(server, backup)
text = server.read_text(encoding="utf-8")

pattern = r'app\.post\("/logout",\s*\(req,\s*res\)\s*=>\s*\{[\s\S]*?\}\);'

replacement = '''app.post("/logout", (req, res) => {
  clearAccessTokenCookie(res);
  return res.redirect("/login");
});'''

if not re.search(pattern, text):
    print("ERROR: logout route not found")
    print("Backup:", backup)
    sys.exit(1)

text = re.sub(pattern, replacement, text, count=1)
server.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", server)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "clear token on logout"')
print("git push")
