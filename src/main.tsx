import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isSchematicWindow } from "./schematic/link";
import { SchematicWindow } from "./schematic/SchematicWindow";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isSchematicWindow() ? <SchematicWindow /> : <App />}</StrictMode>,
);
