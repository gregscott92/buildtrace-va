from pathlib import Path
import shutil
import sys

file = Path.home() / "BuildTrace" / "views" / "login.html"
backup = file.with_name("login.before_cookie_fix.bak.html")

if not file.exists():
    print("ERROR: login.html not found")
    sys.exit(1)

shutil.copy2(file, backup)
text = file.read_text(encoding="utf-8")

old = """        try {
          localStorage.setItem("user", JSON.stringify(data.user || {}));
          if (data.user && data.user.email) {
            localStorage.setItem("userEmail", data.user.email);
          }
        } catch {}

        window.location.href = "/dashboard";"""

new = """        try {
          localStorage.setItem("user", JSON.stringify(data.user || {}));
          if (data.user && data.user.email) {
            localStorage.setItem("userEmail", data.user.email);
          }
          if (data.access_token) {
            document.cookie =
              "access_token=" + encodeURIComponent(data.access_token) +
              "; Path=/; SameSite=Lax";
          }
        } catch {}

        window.location.href = "/dashboard";"""

if old not in text:
    print("ERROR: target block not found in login.html")
    print("Backup:", backup)
    sys.exit(1)

text = text.replace(old, new, 1)
file.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", file)
print("")
print("Now run:")
print("git add views/login.html")
print('git commit -m "save access token in login page"')
print("git push")
