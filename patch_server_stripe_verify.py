from pathlib import Path
from datetime import datetime
import shutil
import sys

server_file = Path("server.js")

if not server_file.exists():
    print("ERROR: server.js not found in current folder.")
    sys.exit(1)

text = server_file.read_text(encoding="utf-8")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = server_file.with_name(f"{server_file.stem}.stripe_verify_backup_{stamp}{server_file.suffix}")
shutil.copy2(server_file, backup)
print(f"Backup created: {backup}")

# 1) Add Stripe require if missing
stripe_require = 'const Stripe = require("stripe");\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY);\n'

if 'const Stripe = require("stripe");' not in text:
    marker = 'const app = express();'
    if marker in text:
        text = text.replace(marker, stripe_require + "\n" + marker, 1)
        print("Added Stripe require.")
    else:
        print("ERROR: Could not find app init marker.")
        sys.exit(1)
else:
    print("Stripe require already present.")

# 2) Add verify route if missing
route_block = r'''
app.get("/api/stripe/verify-session", async (req, res) => {
  try {
    const { session_id } = req.query || {};

    if (!session_id) {
      return res.status(400).json({
        ok: false,
        unlocked: false,
        error: "Missing session_id",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    const unlocked =
      session &&
      session.status === "complete" &&
      session.payment_status === "paid";

    return res.json({
      ok: true,
      unlocked,
      session_id: session.id,
      payment_status: session.payment_status,
      status: session.status,
      customer_email: session.customer_details?.email || null,
    });
  } catch (err) {
    console.error("verify-session error:", err);
    return res.status(500).json({
      ok: false,
      unlocked: false,
      error: "Verification failed",
    });
  }
});
'''.strip()

if '/api/stripe/verify-session' not in text:
    listen_markers = ['app.listen(', 'const PORT =', 'server.listen(']
    inserted = False
    for marker in listen_markers:
        idx = text.find(marker)
        if idx != -1:
            text = text[:idx] + route_block + "\n\n" + text[idx:]
            inserted = True
            print("Added verify-session route.")
            break
    if not inserted:
        print("ERROR: Could not find place to insert verify route.")
        sys.exit(1)
else:
    print("Verify-session route already present.")

server_file.write_text(text, encoding="utf-8")
print("server.js updated.")
