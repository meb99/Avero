fn main() {
    build_allegro();
    tauri_build::build()
}

fn build_allegro() {
    use std::{env, path::PathBuf, process::Command};
    let root = PathBuf::from("../tools/allegro-reader");
    println!("cargo:rerun-if-changed={}", root.display());
    let target = env::var("TARGET").expect("TARGET");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("avero-allegro-reader");
    let compiler = env::var("CXX").unwrap_or_else(|_| "c++".into());
    let mut cmd = Command::new(compiler);
    cmd.args(["-std=c++20", "-O2"]);
    if target.contains("apple-darwin") {
        cmd.args([
            "-arch",
            if target.starts_with("aarch64") { "arm64" } else { "x86_64" },
            "-mmacosx-version-min=13.0",
        ]);
    }
    cmd.arg("-I").arg(root.join("vendor"));
    for source in [
        "main.cpp",
        "vendor/lib/parser/parser.cpp",
        "vendor/lib/structure/types.cpp",
        "vendor/lib/structure/utils.cpp",
        "vendor/lib/structure/cadence_fp.cpp",
        "vendor/lib/printing/printers.cpp",
        "vendor/lib/printing/utils.cpp",
    ] {
        cmd.arg(root.join(source));
    }
    let result =
        cmd.arg("-o").arg(&out).status().expect("C++20 compiler is required for the local Allegro reader");
    assert!(result.success(), "Failed to build the local Allegro reader");
    if target.contains("apple-darwin") {
        assert!(
            Command::new("codesign")
                .args(["--force", "--sign", "-"])
                .arg(&out)
                .status()
                .expect("codesign")
                .success(),
            "Could not sign Allegro reader"
        );
    }
}
