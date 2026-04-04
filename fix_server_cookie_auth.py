from pathlib import Path
import shutil
import sys

server = Path.home() / "BuildTrace" / "server.js"
backup = server.with_name("server.before_cookie_auth_real_fix.bak.js")

if not server.exists():
    print("ERROR: server.js not found")
    sys.exit(1)

shutil.copy2(server, backup)
text = server.read_text(encoding="utf-8")
original = text

# --------------------------------------------------
# 1) add cookie helpers after AUTH_COOKIE_NAME
# --------------------------------------------------
anchor1 = 'const AUTH_COOKIE_NAME = "buildtrace_auth";'
helpers = '''const AUTH_COOKIE_NAME = "buildtrace_auth";
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
if anchor1 in text and 'function setAccessTokenCookie(res, accessToken)' not in text:
    text = text.replace(anchor1, helpers, 1)

# --------------------------------------------------
# 2) make getSupabaseUserFromRequest read bearer OR cookie
# --------------------------------------------------
old_block = '''async function getSupabaseUserFromRequest(req) {
  try {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

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

new_block = '''async function getSupabaseUserFromRequest(req) {
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
      return { user: null, error: "Missing access token" };
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
if old_block in text:
    text = text.replace(old_block, new_block, 1)

# --------------------------------------------------
# 3) set cookie on /login success
# --------------------------------------------------
login_old = '''    return res.json({
      success: true,
      error: null,
      user: {
        id: data?.user?.id ?? data?.session?.user?.id ?? null,
        email: data?.user?.email ?? data?.session?.user?.email ?? null
      }
    });'''

login_new = '''    const accessToken =
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
    });'''
if login_old in text:
    text = text.replace(login_old, login_new, 1)

# --------------------------------------------------
# 4) set cookie on /signup success
# --------------------------------------------------
signup_old = '''    return res.json({
      success: true,
      error: null,
      user: {
        id: data?.user?.id ?? data?.session?.user?.id ?? null,
        email: data?.user?.email ?? data?.session?.user?.email ?? null
      }
    });'''

signup_new = '''    const accessToken =
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
    });'''
# replace only the SECOND occurrence
first_index = text.find(signup_old)
if first_index != -1:
    second_index = text.find(signup_old, first_index + 1)
    if second_index != -1:
        text = text[:second_index] + text[second_index:].replace(signup_old, signup_new, 1)

# --------------------------------------------------
# 5) clear cookie on logout
# --------------------------------------------------
logout_old = '''app.post("/logout", (req, res) => {
  clearAuthCookie(res);
  return res.json({ success: true });
});'''

logout_new = '''app.post("/logout", (req, res) => {
  clearAuthCookie(res);
  clearAccessTokenCookie(res);
  return res.json({ success: true });
});'''
if logout_old in text:
    text = text.replace(logout_old, logout_new, 1)

# --------------------------------------------------
# 6) verify
# --------------------------------------------------
checks = [
    'const ACCESS_TOKEN_COOKIE_NAME = "access_token";',
    'function setAccessTokenCookie(res, accessToken)',
    'function clearAccessTokenCookie(res)',
    'token = String(cookies[ACCESS_TOKEN_COOKIE_NAME] || "").trim();',
    'setAccessTokenCookie(res, accessToken);',
    'clearAccessTokenCookie(res);'
]

missing = [c for c in checks if c not in text]
if missing:
    print("ERROR: missing expected strings after patch:")
    for m in missing:
        print("-", m)
    print("Backup:", backup)
    sys.exit(1)

if text == original:
    print("Nothing changed")
    print("Backup:", backup)
    sys.exit(0)

server.write_text(text, encoding="utf-8")

print("DONE")
print("Backup:", backup)
print("Updated:", server)
print("")
print("Now run:")
print("node --check ~/BuildTrace/server.js")
print("git add server.js")
print('git commit -m "fix cookie auth for va dashboard"')
print("git push")
