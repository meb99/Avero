//! One-click updates on macOS.
//!
//! Every release carries `Avero_universal.app.tar.gz` (built by the release
//! workflow). The update downloads it over HTTPS from this repository's
//! releases (the same source as the DMG on the releases page), checks that
//! the unpacked bundle is Avero in the expected version, swaps it for the
//! running app bundle and starts the new version. Only macOS' own tools
//! are used: curl, tar, plutil, ditto and open.

use std::path::{Path, PathBuf};
use std::process::Command;

const REPO: &str = "meb99/Avero";
const BUNDLE_ID: &str = "dev.meb99.avero";

fn run(cmd: &mut Command, what: &str) -> Result<String, String> {
    let out = cmd.output().map_err(|e| format!("{what}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(format!("{what}: {}", err.lines().last().unwrap_or("failed").trim()))
    }
}

/// `1.2.3`, nothing else (the version ends up in a URL and a comparison).
pub fn valid_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// The `.app` bundle the running executable lives in.
fn running_bundle() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Avero.app/Contents/MacOS/avero
    let bundle = exe.ancestors().nth(3).ok_or("not running from an app bundle")?;
    if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
        return Err("not running from an app bundle (development build?)".into());
    }
    Ok(bundle.to_path_buf())
}

fn find_app(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().and_then(|e| e.to_str()) == Some("app") && p.is_dir())
}

fn plist_value(app: &Path, key: &str) -> Result<String, String> {
    let plist = app.join("Contents/Info.plist");
    run(Command::new("/usr/bin/plutil").args(["-extract", key, "raw", "-o", "-"]).arg(&plist), "Info.plist")
}

/// Downloads and installs `version`, then restarts into it.
pub fn install(app: &tauri::AppHandle, version: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("updates are only installed on macOS".into());
    }
    if !valid_version(version) {
        return Err(format!("invalid version {version}"));
    }
    let target = running_bundle()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let work = std::env::temp_dir().join(format!("avero-update-{stamp}"));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = download_and_swap(version, &target, &work);
    let _ = std::fs::remove_dir_all(&work);
    result?;

    // Start the new version once this one has quit.
    Command::new("/bin/sh")
        .arg("-c")
        .arg("sleep 1; /usr/bin/open -n \"$0\"")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("restart: {e}"))?;
    app.exit(0);
    Ok(())
}

fn download_and_swap(version: &str, target: &Path, work: &Path) -> Result<(), String> {
    let url = format!("https://github.com/{REPO}/releases/download/v{version}/Avero_universal.app.tar.gz");
    let archive = work.join("update.tar.gz");
    run(
        Command::new("/usr/bin/curl")
            .args(["-fsSL", "--proto", "=https", "--max-time", "900", "-o"])
            .arg(&archive)
            .arg(&url),
        "download",
    )?;
    let unpacked = work.join("unpacked");
    std::fs::create_dir_all(&unpacked).map_err(|e| e.to_string())?;
    run(Command::new("/usr/bin/tar").arg("-xzf").arg(&archive).arg("-C").arg(&unpacked), "unpack")?;
    let new_app = find_app(&unpacked).ok_or("the download contains no app")?;

    // Only ever replace Avero with Avero, in the version that was offered.
    let id = plist_value(&new_app, "CFBundleIdentifier")?;
    let got = plist_value(&new_app, "CFBundleShortVersionString")?;
    if id != BUNDLE_ID || got != version {
        return Err(format!("unexpected download ({id} {got})"));
    }

    // Swap: old bundle aside, new one in, old one away; restore on failure.
    let backup = work.join("previous.app");
    std::fs::rename(target, &backup).map_err(|e| format!("{}: {e}", target.display()))?;
    if let Err(e) = run(Command::new("/usr/bin/ditto").arg(&new_app).arg(target), "install") {
        let _ = std::fs::remove_dir_all(target);
        let _ = std::fs::rename(&backup, target);
        return Err(e);
    }
    let _ = Command::new("/usr/bin/xattr").args(["-dr", "com.apple.quarantine"]).arg(target).status();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_plain_versions() {
        assert!(valid_version("0.5.2"));
        assert!(valid_version("10.0.12"));
        for bad in ["0.5", "v0.5.2", "0.5.2-beta", "0.5.2/../../x", "", "1..2", "0.5.2 "] {
            assert!(!valid_version(bad), "{bad}");
        }
    }
}
