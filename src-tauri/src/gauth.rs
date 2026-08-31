//! Desktop Google sign-in.
//!
//! Google forbids OAuth inside embedded webviews, so the flow runs in the
//! user's real browser and comes back to a one-shot loopback listener:
//!
//!   open browser -> Google consent -> 127.0.0.1:8419/callback?code=...
//!   -> exchange code (PKCE) -> access + refresh token -> stored on disk
//!
//! Using the SAME OAuth client as the web app matters: Drive's `drive.file`
//! scope grants access per app, so notes written here are visible to the web
//! app (and vice versa) instead of being invisible uploads from Drive Desktop.

use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const REDIRECT_PORT: u16 = 8419;
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

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

fn token_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = tauri::Manager::path(app)
        .app_local_data_dir()
        .expect("no app local data dir");
    let _ = fs::create_dir_all(&dir);
    dir.join("google-tokens.json")
}

pub fn load_tokens(app: &tauri::AppHandle) -> Option<Tokens> {
    let txt = fs::read_to_string(token_path(app)).ok()?;
    serde_json::from_str(&txt).ok()
}

fn save_tokens(app: &tauri::AppHandle, t: &Tokens) {
    if let Ok(txt) = serde_json::to_string_pretty(t) {
        let _ = fs::write(token_path(app), txt);
    }
}

pub fn clear_tokens(app: &tauri::AppHandle) {
    let _ = fs::remove_file(token_path(app));
}

/// PKCE verifier + its S256 challenge.
fn pkce_pair() -> (String, String) {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let digest = Sha256::digest(verifier.as_bytes());
    (verifier, URL_SAFE_NO_PAD.encode(digest))
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
    ureq::post(TOKEN_URL)
        .send_form(&params)
        .map_err(|e| format!("token exchange failed: {e}"))?
        .into_json::<TokenResponse>()
        .map_err(|e| format!("bad token response: {e}"))
}

/// Fetch the signed-in address so the UI can show which account is connected.
fn fetch_email(access_token: &str) -> String {
    ureq::get("https://openidconnect.googleapis.com/v1/userinfo")
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .and_then(|v| v.get("email").and_then(|e| e.as_str().map(String::from)))
        .unwrap_or_default()
}

/// Run the full interactive sign-in. Blocks until the browser round-trip
/// completes (call from a background thread), max ~3 minutes.
pub fn sign_in(app: &tauri::AppHandle, client_id: &str, client_secret: &str) -> Result<Tokens, String> {
    let (verifier, challenge) = pkce_pair();
    let redirect = format!("http://127.0.0.1:{REDIRECT_PORT}/callback");
    let scope = "https://www.googleapis.com/auth/drive.file openid email";

    let server = tiny_http::Server::http(format!("127.0.0.1:{REDIRECT_PORT}"))
        .map_err(|e| format!("cannot listen on {REDIRECT_PORT}: {e}"))?;

    let url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}\
         &code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect),
        urlencoding::encode(scope),
        challenge
    );
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("cannot open browser: {e}"))?;

    // Wait for Google to redirect back with ?code=...
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let target = request.url().to_string();
            let code = target
                .split_once("code=")
                .map(|(_, rest)| rest.split('&').next().unwrap_or("").to_string());
            let (body, result) = match code {
                Some(c) if !c.is_empty() => (
                    "<h2>NotezZz is connected.</h2><p>You can close this tab.</p>",
                    Ok(urlencoding::decode(&c).unwrap_or_default().to_string()),
                ),
                _ => (
                    "<h2>Sign-in was cancelled.</h2><p>You can close this tab.</p>",
                    Err("no authorization code returned".to_string()),
                ),
            };
            let resp = tiny_http::Response::from_string(format!(
                "<html><body style='font-family:sans-serif;text-align:center;padding:3rem'>{body}</body></html>"
            ))
            .with_header(
                "Content-Type: text/html; charset=utf-8"
                    .parse::<tiny_http::Header>()
                    .unwrap(),
            );
            let _ = request.respond(resp);
            let _ = tx.send(result);
            break; // one-shot listener
        }
    });

    let code = rx
        .recv_timeout(Duration::from_secs(180))
        .map_err(|_| "sign-in timed out".to_string())??;

    let tr = exchange(vec![
        ("code", &code),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", &redirect),
        ("grant_type", "authorization_code"),
        ("code_verifier", &verifier),
    ])?;

    let tokens = Tokens {
        email: fetch_email(&tr.access_token),
        expires_at: now() + tr.expires_in.max(60) - 60,
        access_token: tr.access_token,
        refresh_token: tr.refresh_token,
    };
    save_tokens(app, &tokens);
    Ok(tokens)
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
    save_tokens(app, &tokens);
    Ok(tokens.access_token)
}
