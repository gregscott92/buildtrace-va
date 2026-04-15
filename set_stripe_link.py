from pathlib import Path
from datetime import datetime
import shutil
import re

STRIPE_LINK = "https://buy.stripe.com/eVq9AV2u26MGcSn7959EI00"

files = [
    Path("views/dashboard.html"),
    Path("public/dashboard.html"),
]

for file in files:
    if not file.exists():
        print(f"Skipping (not found): {file}")
        continue

    text = file.read_text(encoding="utf-8")

    # backup
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = file.with_name(f"{file.stem}.stripe_backup_{stamp}{file.suffix}")
    shutil.copy2(file, backup)
    print(f"Backup created: {backup}")

    # replace ANY stripe link or placeholder
    new_text = re.sub(
        r"https://[^\"]*stripe\.com[^\"]*|https://YOUR-STRIPE-LINK",
        STRIPE_LINK,
        text
    )

    file.write_text(new_text, encoding="utf-8")
    print(f"Updated Stripe link in: {file}")

print("Done.")
