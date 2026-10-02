//! Bench multimeters on a USB serial port that speak SCPI (Owon XDM series,
//! many others): set the function, read the value. One meter at a time.

use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

/// The open port, shared by the commands.
#[derive(Default)]
pub struct Meter(pub Mutex<Option<Box<dyn serialport::SerialPort>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub name: String,
    /// "USB 1a86:7523 – USB Serial" for USB adapters.
    pub description: String,
}

pub fn ports() -> Result<Vec<PortInfo>, String> {
    let list = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(list
        .into_iter()
        // macOS lists each port twice; the call-out device (cu.*) is the one to open.
        .filter(|p| !p.port_name.starts_with("/dev/tty.") && !p.port_name.contains("Bluetooth"))
        .map(|p| {
            let description = match p.port_type {
                serialport::SerialPortType::UsbPort(u) => format!(
                    "USB {:04x}:{:04x}{}",
                    u.vid,
                    u.pid,
                    u.product.map(|s| format!(" – {s}")).unwrap_or_default()
                ),
                _ => String::new(),
            };
            PortInfo { name: p.port_name, description }
        })
        .collect())
}

pub fn connect(meter: &Meter, port: &str, baud: u32) -> Result<(), String> {
    let opened = serialport::new(port, baud)
        .timeout(Duration::from_millis(1500))
        .open()
        .map_err(|e| format!("{port}: {e}"))?;
    *meter.0.lock().map_err(|e| e.to_string())? = Some(opened);
    Ok(())
}

pub fn disconnect(meter: &Meter) {
    if let Ok(mut m) = meter.0.lock() {
        *m = None;
    }
}

/// Sends one command; for a query (ending in `?`) returns the answer line.
pub fn send(meter: &Meter, command: &str) -> Result<Option<String>, String> {
    let mut guard = meter.0.lock().map_err(|e| e.to_string())?;
    let port = guard.as_mut().ok_or("no meter connected")?;
    // Whatever an earlier, timed-out query left behind.
    let _ = port.clear(serialport::ClearBuffer::Input);
    port.write_all(format!("{command}\n").as_bytes()).map_err(|e| e.to_string())?;
    port.flush().map_err(|e| e.to_string())?;
    if !command.trim_end().ends_with('?') {
        // Function changes take a moment on most meters.
        std::thread::sleep(Duration::from_millis(150));
        return Ok(None);
    }
    let mut line = String::new();
    BufReader::new(port.as_mut()).read_line(&mut line).map_err(|e| format!("{command}: {e}"))?;
    Ok(Some(line.trim().to_string()))
}
