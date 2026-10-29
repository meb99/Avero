// Tests expect the Mac's key names. Node 21+ has a navigator that names the host ("Win32" on
// Windows), so platform.ts would pick Windows there; fixed to the Mac, the tests read the same
// on every system. Tests for Windows pass the platform explicitly.
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
}
