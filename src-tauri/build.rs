fn main() {
    build_allegro();
    tauri_build::build()
}

const SOURCES: [&str; 7] = [
    "main.cpp",
    "vendor/lib/parser/parser.cpp",
    "vendor/lib/structure/types.cpp",
    "vendor/lib/structure/utils.cpp",
    "vendor/lib/structure/cadence_fp.cpp",
    "vendor/lib/printing/printers.cpp",
    "vendor/lib/printing/utils.cpp",
];

fn build_allegro() {
    use std::{env, path::PathBuf, process::Command};
    let root = PathBuf::from("../tools/allegro-reader");
    println!("cargo:rerun-if-changed={}", root.display());
    let target = env::var("TARGET").expect("TARGET");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("avero-allegro-reader");
    if target.contains("windows-msvc") {
        build_allegro_msvc(&target, &root, &out);
        return;
    }
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
    for source in SOURCES {
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

/// Windows: the reader built with Visual Studio's cl.exe (found the way the
/// cc crate finds it), the C++ runtime linked in so it runs on its own.
/// Each source gets its own object name: two of them are called utils.cpp.
/// The defines stand in for what the sources expect from a Unix compiler
/// (M_PI) and keep windows.h, which winsock2.h brings in, from defining min
/// and max. All sources are compiled before a failure is reported.
fn build_allegro_msvc(target: &str, root: &std::path::Path, out: &std::path::Path) {
    use std::path::PathBuf;
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let root = manifest.join(root);
    let dir = out.parent().expect("OUT_DIR");
    let tool = cc::windows_registry::find_tool(target, "cl.exe")
        .expect("Visual Studio C++ build tools are required for the local Allegro reader");
    let run = |cmd: &mut std::process::Command| {
        cmd.current_dir(dir).arg("/nologo").status().expect("cl.exe").success()
    };
    let mut objects = Vec::new();
    let mut failed = Vec::new();
    for (i, source) in SOURCES.iter().enumerate() {
        let object = dir.join(format!("allegro-{i}.obj"));
        let ok = run(tool
            .to_command()
            .args(["/c", "/std:c++20", "/O2", "/EHsc", "/MT", "/utf-8"])
            .args(["/D_USE_MATH_DEFINES", "/DNOMINMAX", "/DWIN32_LEAN_AND_MEAN"])
            .arg("/I")
            .arg(root.join("vendor"))
            .arg(root.join(source))
            .arg(format!("/Fo{}", object.display())));
        if !ok {
            failed.push(*source);
        }
        objects.push(object);
    }
    assert!(failed.is_empty(), "Failed to build the local Allegro reader: {}", failed.join(", "));
    let exe = dir.join("avero-allegro-reader.exe");
    assert!(
        run(tool.to_command().arg("/MT").args(&objects).arg(format!("/Fe{}", exe.display()))),
        "Failed to link the local Allegro reader"
    );
    std::fs::copy(&exe, out).expect("Allegro reader");
}
