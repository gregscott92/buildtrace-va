from pathlib import Path
import shutil
import sys
import re

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_require_api_user_fix.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

shutil.copy2(server, backup)
text = server.read_text(encoding="utf-8")

pattern = r'async function requireApiUser\(req, res, next\)[\s\S]*?\}'

replacement = '''async function requireApiUser(req, res, next) {
  try {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/access_token=([^;]+)/);

    if (!match) {
      return res.status(401).json({ error: "Login required" });
    }

    const accessToken = decodeURIComponent(match[1]);

    const { data, error } = await supabaseAuth.auth.getUser(accessToken);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid session" });
    }

    req.apiUser = data.user;
    next();
  } catch (err) {
    return res.status(500).json({
      error: "Auth failed",
      details: err.message
    });
  }
}'''

if not re.search(pattern, text):
    print("ERROR: requireApiUser function not found")
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
print('git commit -m "fix requireApiUser cookie parsing"')
print("git push")
