from pathlib import Path
import shutil
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_fix_async_supabase_user.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

text = server.read_text(encoding="utf-8")
shutil.copy2(server, backup)

old1 = "function getSupabaseUserFromRequest(req) {"
new1 = "async function getSupabaseUserFromRequest(req) {"

old2 = "function requireApiUser(req, res, next) {"
new2 = "async function requireApiUser(req, res, next) {"

changed = False

if old1 in text:
    text = text.replace(old1, new1, 1)
    changed = True

if old2 in text:
    text = text.replace(old2, new2, 1)
    changed = True

if not changed:
    print("ERROR: target function headers not found")
    print("Backup:", backup)
    sys.exit(1)

server.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", server)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "fix async auth helpers"')
print("git push")
