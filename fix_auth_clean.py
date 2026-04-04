from pathlib import Path
import shutil
import re
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_clean_auth_fix.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

text = server.read_text(encoding="utf-8")
shutil.copy2(server, backup)

cookie_anchor = 'const AUTH_COOKIE_NAME = "buildtrace_auth";'
cookie_block = '''const AUTH_COOKIE_NAME = "buildtrace_auth";
const ACCESS_TOKEN_COOKIE_NAME = "access_token";

function setAccessTokenCookie(res, accessToken) {
  const isProd = process.env.NODE_ENV === "production";
  res.append(
    "Set-Cookie",
    ACCESS_TOKEN_COOKIE_NAME +
      "=" +
      encodeURIComponent(String(accessToken || "")) +
      "; Path=/; Max-Age=604800; SameSite=Lax" +
      (isProd ? "; Secure" : "")
  );
}

function clearAccessTokenCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.append(
    "Set-Cookie",
    ACCESS_TOKEN_COOKIE_NAME +
      "=; Path=/; Max-Age=0; SameSite=Lax" +
      (isProd ? "; Secure" : "")
  );
}'''

if cookie_anchor in text and 'const ACCESS_TOKEN_COOKIE_NAME = "access_token";' not in text:
    text = text.replace(cookie_anchor, cookie_block, 1)

# Fix getSupabaseUserFromRequest token loading
pattern_get_user = re.compile(
    r'async function getSupabaseUserFromRequest\(req\) \{[\s\S]*?^\}',
    re.M
)

replacement_get_user = '''async function getSupabaseUserFromRequest(req) {
  try {
    const authHeader = String(req.headers.authorization || "");
    const cookies = parseCookies(req);

    let token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      token = String(cookies[ACCESS_TOKEN_COOKIE_NAME] || "").trim();
    }

    if (!token) {
      return { user: null, error: "Missing bearer token" };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { user: null, error: "Invalid token" };
    }

    const user = await response.json();
    return { user, error: null };
  } catch (err) {
    return { user: null, error: err.message };
  }
}'''

if pattern_get_user.search(text):
    text = pattern_get_user.sub(replacement_get_user, text, count=1)
else:
    print("ERROR: getSupabaseUserFromRequest function not found")
    print("Backup:", backup)
    sys.exit(1)

# Replace /login route cleanly
pattern_login = re.compile(
    r'app\.post\("/login", async \(req, res\) => \{[\s\S]*?^\}\);',
    re.M
)

replacement_login = '''app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
        user: null
      });
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
        user: null
      });
    }

    const accessToken =
      data?.session?.access_token ||
      data?.access_token ||
      null;

    if (accessToken) {
      setAccessTokenCookie(res, accessToken);
    }

    return res.json({
      success: true,
      error: null,
      user: {
        id: data?.user?.id ?? data?.session?.user?.id ?? null,
        email: data?.user?.email ?? data?.session?.user?.email ?? null
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
      user: null
    });
  }
});'''

if pattern_login.search(text):
    text = pattern_login.sub(replacement_login, text, count=1)
else:
    print("ERROR: /login route not found")
    print("Backup:", backup)
    sys.exit(1)

# Replace /logout route cleanly
pattern_logout = re.compile(
    r'app\.post\("/logout",[\s\S]*?^\}\);',
    re.M
)

replacement_logout = '''app.post("/logout", (req, res) => {
  clearAuthCookie(res);
  clearAccessTokenCookie(res);
  return res.json({ success: true });
});'''

if pattern_logout.search(text):
    text = pattern_logout.sub(replacement_logout, text, count=1)
else:
    print("ERROR: /logout route not found")
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
print('git commit -m "clean auth cookie flow"')
print("git push")
