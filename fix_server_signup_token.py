from pathlib import Path
import shutil
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_signup_token_fix.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

shutil.copy2(server, backup)
text = server.read_text(encoding="utf-8")

target = """app.post("/signup", async (req, res) => {"""
start = text.find(target)
if start == -1:
    print("ERROR: signup route not found")
    print("Backup:", backup)
    sys.exit(1)

old = """    return res.json({
      success: true,
      error: null,
      user: {
        id: data?.user?.id ?? data?.session?.user?.id ?? null,
        email: data?.user?.email ?? data?.session?.user?.email ?? null
      }
    });"""

new = """    return res.json({
      success: true,
      error: null,
      access_token: data?.session?.access_token ?? null,
      refresh_token: data?.session?.refresh_token ?? null,
      user: {
        id: data?.user?.id ?? data?.session?.user?.id ?? null,
        email: data?.user?.email ?? data?.session?.user?.email ?? null
      }
    });"""

segment = text[start:]
if old not in segment:
    print("ERROR: signup return block not found")
    print("Backup:", backup)
    sys.exit(1)

segment = segment.replace(old, new, 1)
text = text[:start] + segment
server.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", server)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "return access token from signup"')
print("git push")
