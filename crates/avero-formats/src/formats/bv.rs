//! ATE BV: a local Microsoft Jet database containing Layout, Pin and Nail.
//! Read the actual database, without Microsoft Access/ODBC or a shell command.
use crate::{
    builder::{RawBoard, RawPart, RawPin, RawTestPoint},
    model::{Mount, Point, Side, TestPointKind},
    FormatId, ParseError,
};
use jetdb::{read_catalog, read_table_def, read_table_rows, PageReader, Value};
use std::{collections::HashMap, io::Write};
const F: FormatId = FormatId::Bv;
fn err(s: impl Into<String>) -> ParseError {
    ParseError::invalid(F, s)
}
pub fn detect(bytes: &[u8]) -> bool {
    bytes.get(4..20) == Some(b"Standard Jet DB\0") || bytes.get(4..20) == Some(b"Standard ACE DB\0")
}
fn cell(value: &Value) -> Result<String, ParseError> {
    let text = match value {
        Value::Null => String::new(),
        Value::Text(s) => s.clone(),
        Value::Byte(n) => n.to_string(),
        Value::Int(n) => n.to_string(),
        Value::Long(n) => n.to_string(),
        Value::BigInt(n) => n.to_string(),
        Value::Float(n) if n.is_finite() => n.to_string(),
        Value::Double(n) if n.is_finite() => n.to_string(),
        Value::Bool(b) => u8::from(*b).to_string(),
        _ => return Err(err("Unsupported BV column value")),
    };
    if text.chars().any(|c| matches!(c, '\t' | '\r' | '\n')) {
        return Err(err("BV text contains an ambiguous field separator"));
    }
    Ok(text)
}
pub fn parse(bytes: &[u8]) -> Result<RawBoard, ParseError> {
    let mut file = tempfile::NamedTempFile::new().map_err(|e| err(e.to_string()))?;
    file.write_all(bytes).map_err(|e| err(e.to_string()))?;
    let mut reader = PageReader::open(file.path()).map_err(|e| err(e.to_string()))?;
    let catalog = read_catalog(&mut reader).map_err(|e| err(e.to_string()))?;
    let mut raw = RawBoard::new(F);
    let mut parts: HashMap<(String, String), usize> = HashMap::new();
    for name in ["Layout", "Pin", "Nail"] {
        let entry = catalog.iter().find(|e| e.name.eq_ignore_ascii_case(name));
        let Some(entry) = entry else {
            if name == "Pin" {
                return Err(err("Not an ATE BV database: Pin table is missing"));
            }
            continue;
        };
        let table =
            read_table_def(&mut reader, &entry.name, entry.table_page).map_err(|e| err(e.to_string()))?;
        if (name == "Pin" && table.columns.len() < 8)
            || (name == "Layout" && table.columns.len() < 2)
            || (name == "Nail" && table.columns.len() < 8)
        {
            return Err(err(format!("Unexpected {name} table schema")));
        }
        let rows = read_table_rows(&mut reader, &table).map_err(|e| err(e.to_string()))?;
        if rows.skipped_rows > 0 {
            return Err(err(format!(
                "{name}: {} database rows could not be read; import stopped",
                rows.skipped_rows
            )));
        }
        if rows.rows.len() > 2_000_000 {
            return Err(err("Too many BV rows"));
        }
        for row in rows.rows {
            let fields = row.iter().map(cell).collect::<Result<Vec<_>, _>>()?;
            let get =
                |i: usize| fields.get(i).map(String::as_str).ok_or_else(|| err(format!("Short {name} row")));
            let number = |i: usize| -> Result<f64, ParseError> {
                get(i)?
                    .parse::<f64>()
                    .ok()
                    .filter(|v| v.is_finite() && v.abs() < 1e6)
                    .ok_or_else(|| err(format!("Invalid {name} coordinate")))
            };
            let side = |s: &str| -> Result<Side, ParseError> {
                match s.trim() {
                    "(T)" | "T" => Ok(Side::Top),
                    "(B)" | "B" => Ok(Side::Bottom),
                    _ => Err(err(format!("Unknown {name} side"))),
                }
            };
            match name {
                "Layout" => raw.outline_path.push(Point::new(number(0)? * 1000., number(1)? * 1000.)),
                "Pin" => {
                    let designator = get(0)?.trim();
                    let pin = get(3)?.trim();
                    if designator.is_empty() || pin.is_empty() {
                        return Err(err("Empty component/pin in BV database"));
                    }
                    let location = get(1)?;
                    let owner =
                        *parts.entry((designator.to_string(), location.to_string())).or_insert_with(|| {
                            let i = raw.parts.len();
                            raw.parts.push(RawPart::new(designator.to_string(), Side::Both, Mount::Smd));
                            i
                        });
                    raw.parts[owner].side = side(location)?;
                    raw.parts[owner].pins.push(RawPin {
                        pos: Point::new(number(4)? * 1000., number(5)? * 1000.),
                        number: Some(pin.to_string()),
                        net: get(7)?.to_string(),
                        ..Default::default()
                    });
                }
                "Nail" => raw.test_points.push(RawTestPoint {
                    kind: TestPointKind::Nail,
                    pos: Point::new(number(1)? * 1000., number(2)? * 1000.),
                    side: side(get(5)?)?,
                    net: get(7)?.to_string(),
                    name: (!get(0)?.is_empty()).then(|| fields[0].clone()),
                    radius: None,
                    probe: None,
                }),
                _ => unreachable!(),
            }
        }
    }
    if raw.pin_count() == 0 {
        return Err(err("No pins could be read from the BV tables"));
    }
    raw.warn("ATE BV uses the Layout/Pin/Nail table variant in inches; auxiliary database tables are not imported.");
    Ok(raw)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_jet_signature_does_not_match_arbitrary_bv_extension() {
        assert!(!detect(b"not a database"));
        let mut b = vec![0u8; 4096];
        b[4..20].copy_from_slice(b"Standard Jet DB\0");
        assert!(detect(&b));
        assert!(parse(&b).is_err());
    }
}
