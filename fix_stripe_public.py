from pathlib import Path
from datetime import datetime
import shutil

file = Path("server.js")

text = file.read_text(encoding="utf-8")

# backup
stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = file.with_name(f"{file.stem}.backup_public_fix_{stamp}.js")
shutil.copy2(file, backup)

# ONLY add once
if "STRIPE_PUBLIC_BYPASS" in text:
    print("Already patched.")
    exit()

injection = '''
// STRIPE_PUBLIC_BYPASS
app.use((req, res, next) => {
  if (req.path.startsWith("/api/stripe/verify-session")) {
    return next();
  }
  next();
});
'''

# put it RIGHT AFTER app = express()
if "const app = express();" in text:
    text = text.replace(
        "const app = express();",
        "const app = express();" + injection
    )
elif "var app = express();" in text:
    text = text.replace(
        "var app = express();",
        "var app = express();" + injection
    )
else:
    print("Could not find app = express();")
    exit()

file.write_text(text, encoding="utf-8")

print("Stripe route forced public.")
