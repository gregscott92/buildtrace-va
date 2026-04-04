from pathlib import Path
import shutil
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_fix_double_async.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

text = server.read_text(encoding="utf-8")
shutil.copy2(server, backup)

changed = False

if "async async function getSupabaseUserFromRequest(req) {" in text:
    text = text.replace(
        "async async function getSupabaseUserFromRequest(req) {",
        "async function getSupabaseUserFromRequest(req) {",
        1,
    )
    changed = True

if "async async function requireApiUser(req, res, next) {" in text:
    text = text.replace(
        "async async function requireApiUser(req, res, next) {",
        "async function requireApiUser(req, res, next) {",
        1,
    )
    changed = True

if not changed:
    print("ERROR: no double-async pattern found")
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
print('git commit -m "fix double async auth helpers"')
print("git push")
