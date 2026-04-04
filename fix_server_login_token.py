from pathlib import Path
import shutil
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_login_token_fix.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

shutil.copy2(server, backup)
text = server.read_text(encoding="utf-8")

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

if old not in text:
    print("ERROR: login return block not found")
    print("Backup:", backup)
    sys.exit(1)

text = text.replace(old, new, 1)
server.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", server)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "return access token from login"')
print("git push")
