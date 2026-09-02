//! Desktop Google sign-in.
//!
//! Google forbids OAuth inside embedded webviews, so the flow runs in the
//! user's real browser and comes back to a one-shot loopback listener:
//!
//!   open browser -> Google consent -> 127.0.0.1:8419/callback?code=...&state=...
//!   -> exchange code (PKCE) -> access + refresh token -> stored on disk
//!
//! Using the SAME OAuth client as the web app matters: Drive's `drive.file`
//! scope grants access per app, so notes written here are visible to the web
//! app (and vice versa) instead of being invisible uploads from Drive Desktop.

use std::fs;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const REDIRECT_PORT: u16 = 8419;
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";

/// The loopback listener of the sign-in currently in progress, if any. A
/// consent tab closed by the user left the previous listener bound for the
/// full 180 s, and the next click failed with "cannot listen on 8419"; a new
/// attempt now evicts the old one first.
static LISTENER: Mutex<Option<Arc<tiny_http::Server>>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds at which `access_token` expires.
    pub expires_at: u64,
    pub email: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// One HTTP client with timeouts. ureq's defaults never time out; a stalled
/// connection to Google hung a token refresh — and the sync waiting on it —
/// indefinitely.
fn http() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(10))
        .timeout_write(Duration::from_secs(10))
        .build()
}

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = tauri::Manager::path(app)
        .app_local_data_dir()
        .map_err(|e| format!("no app local data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir.join("google-tokens.json"))
}

pub fn load_tokens(app: &tauri::AppHandle) -> Option<Tokens> {
    let txt = fs::read_to_string(token_path(app).ok()?).ok()?;
    serde_json::from_str(&txt).ok()
}

/// Atomic for the same reason notes are (see lib.rs): a torn token file
/// looks like "signed out" on the next launch.
fn save_tokens(app: &tauri::AppHandle, t: &Tokens) -> Result<(), String> {
    let txt = serde_json::to_string_pretty(t).map_err(|e| e.to_string())?;
    crate::write_atomic(&token_path(app)?, &txt)
}

pub fn clear_tokens(app: &tauri::AppHandle) -> Result<(), String> {
    match fs::remove_file(token_path(app)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot remove token file: {e}")),
    }
}

/// 32 random bytes, URL-safe base64 — used for the PKCE verifier and the
/// OAuth `state` alike.
fn random_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE verifier + its S256 challenge.
fn pkce_pair() -> (String, String) {
    let verifier = random_token();
    let digest = Sha256::digest(verifier.as_bytes());
    (verifier, URL_SAFE_NO_PAD.encode(digest))
}

/// Value of `key` in the query string of a request target, percent-decoded.
fn query_param(target: &str, key: &str) -> Option<String> {
    let (_, query) = target.split_once('?')?;
    query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| urlencoding::decode(v).unwrap_or_default().into_owned())
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    expires_in: u64,
}

fn exchange(params: Vec<(&str, &str)>) -> Result<TokenResponse, String> {
    http()
        .post(TOKEN_URL)
        .send_form(&params)
        .map_err(|e| format!("token exchange failed: {e}"))?
        .into_json::<TokenResponse>()
        .map_err(|e| format!("bad token response: {e}"))
}

/// Fetch the signed-in address so the UI can show which account is connected.
/// Failure is reported, not swallowed: an empty email used to make a
/// perfectly good sign-in look signed-out.
fn fetch_email(access_token: &str) -> Result<String, String> {
    let v = http()
        .get(USERINFO_URL)
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(|e| format!("userinfo request failed: {e}"))?
        .into_json::<serde_json::Value>()
        .map_err(|e| format!("bad userinfo response: {e}"))?;
    v.get("email")
        .and_then(|e| e.as_str())
        .filter(|e| !e.is_empty())
        .map(String::from)
        .ok_or_else(|| "userinfo response has no email".to_string())
}

/// Bind the loopback listener, evicting a listener left behind by an earlier
/// attempt (see `LISTENER`).
fn bind_listener() -> Result<Arc<tiny_http::Server>, String> {
    // Take the old handle out and RELEASE the lock before waiting: the
    // evicted sign_in needs this same lock to clean up, and holding it here
    // would keep its Arc alive — and the port bound — until the deadline.
    let old = LISTENER.lock().unwrap_or_else(|p| p.into_inner()).take();
    if let Some(old) = old {
        // Ends the old accept loop; its sign_in then sees the channel close
        // and returns. The socket is only released once every Arc is gone,
        // so wait (briefly) for that before rebinding the same port.
        old.unblock();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while Arc::strong_count(&old) > 1 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        drop(old);
    }
    // tiny_http closes its socket from a helper thread after the last Arc
    // drops, so the port can still be busy for a few ms after an eviction.
    let addr = format!("127.0.0.1:{REDIRECT_PORT}"); // loopback only, never 0.0.0.0
    let mut attempt = 0;
    let server = loop {
        match tiny_http::Server::http(&addr) {
            Ok(s) => break Arc::new(s),
            Err(_) if attempt < 20 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("cannot listen on {REDIRECT_PORT}: {e}")),
        }
    };
    *LISTENER.lock().unwrap_or_else(|p| p.into_inner()) = Some(server.clone());
    Ok(server)
}

fn html_response(status: u16, body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(format!(
        "<html><body style='font-family:sans-serif;text-align:center;padding:3rem'>{body}</body></html>"
    ))
    .with_status_code(status)
    .with_header(
        "Content-Type: text/html; charset=utf-8"
            .parse::<tiny_http::Header>()
            .unwrap(),
    )
}

/// Run the full interactive sign-in. Blocks until the browser round-trip
/// completes (call from a background thread), max ~3 minutes.
///
/// On success the tokens are stored. If only the account-email lookup fails
/// the tokens are STILL stored (the sign-in itself worked) and the error
/// says so — the frontend re-checks `google_account` before calling it a
/// failed sign-in.
pub fn sign_in(app: &tauri::AppHandle, client_id: &str, client_secret: &str) -> Result<Tokens, String> {
    let (verifier, challenge) = pkce_pair();
    // `state` ties the callback to THIS attempt. Without it the listener
    // accepted the first request to hit the port — any local page or a
    // stray browser prefetch could hand it an attacker-chosen code.
    let state = random_token();
    let redirect = format!("http://127.0.0.1:{REDIRECT_PORT}/callback");
    let scope = "https://www.googleapis.com/auth/drive.file openid email";

    let server = bind_listener()?;
    let server_thread = server.clone();

    let url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}\
         &code_challenge_method=S256&access_type=offline&prompt=consent&state={}",
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect),
        urlencoding::encode(scope),
        challenge,
        state
    );
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("cannot open browser: {e}"))?;

    // Wait for Google to redirect back with ?code=...&state=...
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    std::thread::spawn(move || {
        for request in server_thread.incoming_requests() {
            let target = request.url().to_string();
            if query_param(&target, "state").as_deref() != Some(state.as_str()) {
                // Not our callback (favicon probe, stale tab, forged request):
                // reject it and keep listening for the real one.
                let _ = request.respond(html_response(400, "<h2>Unexpected request.</h2>"));
                continue;
            }
            let (body, result) = match query_param(&target, "code") {
                Some(c) if !c.is_empty() => (
                    "<h2>NotezZz is connected.</h2><p>You can close this tab.</p>",
                    Ok(c),
                ),
                _ => (
                    "<h2>Sign-in was cancelled.</h2><p>You can close this tab.</p>",
                    Err(match query_param(&target, "error") {
                        Some(e) => format!("Google returned: {e}"),
                        None => "no authorization code returned".to_string(),
                    }),
                ),
            };
            let _ = request.respond(html_response(200, body));
            let _ = tx.send(result);
            break; // one-shot listener
        }
        // `tx` drops here: a listener evicted by a newer attempt (or the
        // timeout below) wakes the recv with Disconnected instead of
        // sitting out the full 180 s.
    });

    let code = rx.recv_timeout(Duration::from_secs(180));
    // Always release port 8419 — a listener left running from an abandoned
    // attempt makes every retry fail to bind ("sign-in loop").
    server.unblock();
    {
        let mut slot = LISTENER.lock().unwrap_or_else(|p| p.into_inner());
        if slot.as_ref().is_some_and(|s| Arc::ptr_eq(s, &server)) {
            *slot = None;
        }
    }
    drop(server);
    let code = code.map_err(|e| match e {
        mpsc::RecvTimeoutError::Timeout => "sign-in timed out".to_string(),
        mpsc::RecvTimeoutError::Disconnected => "sign-in cancelled".to_string(),
    })??;

    let tr = exchange(vec![
        ("code", &code),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", &redirect),
        ("grant_type", "authorization_code"),
        ("code_verifier", &verifier),
    ])?;

    let email = fetch_email(&tr.access_token);
    let tokens = Tokens {
        email: email.clone().unwrap_or_default(),
        expires_at: now() + tr.expires_in.max(60) - 60,
        access_token: tr.access_token,
        refresh_token: tr.refresh_token,
    };
    save_tokens(app, &tokens)?;
    match email {
        Ok(_) => Ok(tokens),
        Err(e) => Err(format!("couldn't read the account email: {e}")),
    }
}

/// Return a valid access token, refreshing with the stored refresh token when
/// the current one has expired. No user interaction — refresh tokens persist
/// until revoked, so the desktop app stays signed in indefinitely.
pub fn valid_access_token(
    app: &tauri::AppHandle,
    client_id: &str,
    client_secret: &str,
) -> Result<String, String> {
    let mut tokens = load_tokens(app).ok_or("not signed in")?;
    if now() < tokens.expires_at && !tokens.access_token.is_empty() {
        return Ok(tokens.access_token);
    }
    if tokens.refresh_token.is_empty() {
        return Err("session expired — sign in again".into());
    }
    let tr = exchange(vec![
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", &tokens.refresh_token),
        ("grant_type", "refresh_token"),
    ])?;
    tokens.access_token = tr.access_token;
    tokens.expires_at = now() + tr.expires_in.max(60) - 60;
    // The refreshed token is good even if it could not be persisted; the
    // worst case is another refresh on next launch. Log rather than fail.
    if let Err(e) = save_tokens(app, &tokens) {
        eprintln!("[notezzz] google_token: {e}");
    }
    Ok(tokens.access_token)
}
