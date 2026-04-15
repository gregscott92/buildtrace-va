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
        print(f"Skipping missing file: {file}")
        continue

    text = file.read_text(encoding="utf-8")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = file.with_name(f"{file.stem}.stripe_button_backup_{stamp}{file.suffix}")
    shutil.copy2(file, backup)
    print(f"Backup created: {backup}")

    updated = re.sub(
        r"""onclick="window\.location\.href='[^']*'" """,
        f"""onclick="window.location.href='{STRIPE_LINK}'" """,
        text
    )

    file.write_text(updated, encoding="utf-8")
    print(f"Updated Stripe button in: {file}")

print("Done.")
