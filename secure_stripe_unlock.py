from pathlib import Path
from datetime import datetime
import shutil

files = [
    Path("views/dashboard.html"),
    Path("public/dashboard.html"),
]

old = 'const isPaid = new URLSearchParams(window.location.search).get("paid") === "true";'

new = """const params = new URLSearchParams(window.location.search);
        const sessionId = params.get("session_id");

        let isPaid = false;

        if (sessionId) {
          try {
            const verifyRes = await fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`);
            const verifyData = await verifyRes.json();

            if (verifyData && verifyData.unlocked === true) {
              isPaid = true;
              localStorage.setItem("paid_session_id", sessionId);
            }
          } catch (e) {
            console.error("Stripe verify failed", e);
          }
        } else {
          const savedPaidSession = localStorage.getItem("paid_session_id");
          if (savedPaidSession) {
            try {
              const verifyRes = await fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(savedPaidSession)}`);
              const verifyData = await verifyRes.json();

              if (verifyData && verifyData.unlocked === true) {
                isPaid = true;
              }
            } catch (e) {
              console.error("Saved Stripe session verify failed", e);
            }
          }
        }"""

for file in files:
    if not file.exists():
        print(f"Skipping missing file: {file}")
        continue

    text = file.read_text(encoding="utf-8")

    if old not in text:
        print(f"Old isPaid line not found in: {file}")
        continue

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = file.with_name(f"{file.stem}.secure_unlock_backup_{stamp}{file.suffix}")
    shutil.copy2(file, backup)
    print(f"Backup created: {backup}")

    updated = text.replace(old, new, 1)
    file.write_text(updated, encoding="utf-8")
    print(f"Updated secure unlock in: {file}")

print("Done.")
