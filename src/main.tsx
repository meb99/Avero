import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { platform } from "./platform";
import { isSchematicWindow } from "./schematic/link";
import { SchematicWindow } from "./schematic/SchematicWindow";
import "./styles.css";

// Windows draws its own title bar: the layout leaves out the room for the Mac's window buttons.
document.documentElement.dataset.platform = platform;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isSchematicWindow() ? <SchematicWindow /> : <App />}</StrictMode>,
);
