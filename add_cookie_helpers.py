from pathlib import Path
import shutil
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_cookie_helpers.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

shutil.copy2(server, backup)
text = server.read_text(encoding="utf-8")

if 'function setAccessTokenCookie(res, accessToken)' in text:
    print("Cookie helpers already exist. Nothing changed.")
    print("Backup:", backup)
    sys.exit(0)

anchor = 'function escapeHtml(str) {'
insert = '''
function setAccessTokenCookie(res, accessToken) {
  if (!accessToken) return;
  const isProd = process.env.NODE_ENV === "production";
  res.append("Set-Cookie",
    "access_token=" +
      encodeURIComponent(accessToken) +
      "; Path=/; HttpOnly; SameSite=Lax" +
      (isProd ? "; Secure" : "")
  );
}

function clearAccessTokenCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.append("Set-Cookie",
    "access_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax" +
      (isProd ? "; Secure" : "")
  );
}

'''

if anchor not in text:
    print("ERROR: escapeHtml anchor not found")
    print("Backup:", backup)
    sys.exit(1)

text = text.replace(anchor, insert + anchor, 1)
server.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", server)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "add access token cookie helpers"')
print("git push")
