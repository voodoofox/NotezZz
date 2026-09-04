//! Hide sticky windows while a fullscreen app owns the screen.
//!
//! Always-on-top stickies sit above everything — including a fullscreen video
//! or game, which is the one place nobody wants a note. Windows only yields
//! always-on-top windows to *exclusive* fullscreen (old DirectX); borderless
//! fullscreen (every modern game, browsers' F11, video players) keeps them
//! floating on top. So we watch the foreground window ourselves: when it
//! covers its whole monitor and isn't ours or the desktop shell, stickies go
//! away; when it stops, they come back.

use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
fn foreground_is_fullscreen() -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        // The desktop and the taskbar are monitor-sized too; they aren't apps.
        let mut class = [0u16; 64];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
            return false;
        }
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return false;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT { left: 0, top: 0, right: 0, bottom: 0 },
            rcWork: RECT { left: 0, top: 0, right: 0, bottom: 0 },
            dwFlags: 0,
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

#[cfg(not(windows))]
fn foreground_is_fullscreen() -> bool {
    false
}

/// True when the foreground window is one of ours (stickies included).
#[cfg(windows)]
fn foreground_is_ours(app: &AppHandle) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let fg = unsafe { GetForegroundWindow() } as isize;
    app.webview_windows()
        .values()
        .any(|w| w.hwnd().map(|h| h.0 as isize == fg).unwrap_or(false))
}

#[cfg(not(windows))]
fn foreground_is_ours(_app: &AppHandle) -> bool {
    false
}

pub fn watch(app: AppHandle) {
    thread::spawn(move || {
        let mut hidden = false;
        loop {
            thread::sleep(Duration::from_millis(700));
            let fullscreen = !foreground_is_ours(&app) && foreground_is_fullscreen();
            if fullscreen == hidden {
                continue;
            }
            hidden = fullscreen;
            for (label, win) in app.webview_windows() {
                if !label.starts_with("sticky-") {
                    continue;
                }
                let _ = if hidden { win.hide() } else { win.show() };
            }
        }
    });
}
